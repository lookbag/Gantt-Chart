/**
 * Gantt Application Logic with Supabase Integration
 */

class GanttApp {
    constructor() {
        if (window.sbClient) {
            this.supabase = window.sbClient;
        } else {
            console.error("GanttApp: Supabase client not found.");
            return;
        }

        this.tasks = [];
        this.activeProject = localStorage.getItem('lastProject') || null;

        // 초기 날짜 설정: 오늘 기준 7일 전 시작, 4개월 후 종료
        const today = new Date();
        this.viewStart = new Date(today);
        this.viewStart.setDate(today.getDate() - 7);

        this.viewEnd = new Date(this.viewStart);
        this.viewEnd.setMonth(this.viewStart.getMonth() + 4);
        this.pxPerDay = 30;
        this.editingTaskId = null;
        this.searchQuery = '';

        window.app = this;
        this.init();
    }

    async init() {
        this.bindEvents();
        this.setupRealtime();

        if (Auth.isLoggedIn) {
            if (this.activeProject) {
                this.loadTasks();
            } else {
                this.renderInitialState();
            }
        }

        lucide.createIcons();
    }

    setupRealtime() {
        this.supabase
            .channel('schema-db-changes')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'tasks' },
                (payload) => {
                    console.log('Realtime change detected:', payload);
                    // 자신의 변경으로 인한 재로딩은 최소화하고 싶다면 payload.new.user_id 체크 가능
                    this.loadTasks();
                }
            )
            .subscribe();
    }

    // --- Supabase Data Sync ---

    async loadTasks() {
        if (!Auth.isLoggedIn) return;

        try {
            const projectName = this.activeProject;
            if (!projectName) {
                this.renderInitialState();
                return;
            }

            // UI 업데이트
            if (document.getElementById('activeProjectName')) {
                document.getElementById('activeProjectName').innerText = projectName;
            }
            document.getElementById('appTitle').innerText = projectName;

            // [추가] 멤버 이니셜 아이콘 표시 실행
            this.renderProjectMemberIcons(projectName);

            // [추가] 프로젝트 멤버 목록 가져오기 (Owner 선택용)
            await this.fetchProjectMembers(projectName);

            // 관리자가 아니고, 해당 프로젝트 권한이 없는 경우 체크
            if (!Auth.isAdmin) {
                const hasPermission = await this.checkPermission(Auth.user.id, projectName);
                if (!hasPermission) {
                    // [수정됨] 단순 경고창 대신 -> 확인 누르면 이메일 발송
                    if (confirm(`'${projectName}' 프로젝트에 접근 권한이 없습니다.\n관리자(csyoon)에게 접근 권한 요청 메일을 보내시겠습니까?`)) {
                        const subject = `[Gantt] 권한 요청: ${projectName}`;
                        const body = `안녕하세요,\n\n다음 프로젝트에 대한 접근 권한을 요청합니다.\n\n- 프로젝트명: ${projectName}\n- 요청자: ${Auth.user.email}\n\n확인 부탁드립니다.`;
                        window.location.href = `mailto:csyoon@kbautosys.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                    }

                    this.tasks = [];
                    this.renderAll();
                    return;
                }
            }

            // (이하 기존 로직 동일)
            const { data, error } = await this.supabase
                .from('tasks')
                .select('*')
                .eq('project_name', projectName)
                .order('sort_order', { ascending: true }); // <-- 여기를 'created_at'에서 'sort_order'로 변경

            if (error) throw error;

            this.tasks = data || [];
            this.renderAll();
        } catch (err) {
            console.error('Error loading tasks:', err.message);
        }
    }

    renderInitialState() {
        this.tasks = [];
        if (document.getElementById('activeProjectName')) {
            document.getElementById('activeProjectName').innerText = 'No Authorized Projects';
        }
        document.getElementById('appTitle').innerText = 'Project Planner';
        const body = document.getElementById('ganttBody');
        if (body) {
            body.innerHTML = '<div style="padding: 100px; text-align: center; color: #676879; font-size: 16px;">' +
                '<i data-lucide="shield-alert" style="margin-bottom: 16px;"></i><br>' +
                'You have no active projects yet.<br>Please contact the administrator to request project access.' +
                '</div>';
            lucide.createIcons();
        }
    }

    async checkPermission(userId, projectName) {
        try {
            const { data, error } = await this.supabase
                .from('user_permissions')
                .select('*')
                .eq('user_id', userId)
                .eq('project_name', projectName)
                .eq('is_approved', true)
                .single();

            return !!data;
        } catch (err) {
            return false;
        }
    }

    // [신규 함수] 프로젝트 멤버 페치
    async fetchProjectMembers(projectName) {
        try {
            // 1. 권한 테이블에서 user_id 조회
            const { data: perms } = await this.supabase
                .from('user_permissions')
                .select('user_id')
                .eq('project_name', projectName)
                .eq('is_approved', true);

            if (!perms || perms.length === 0) {
                this.currentProjectMembers = [];
                return;
            }
            const userIds = perms.map(p => p.user_id);

            // 2. 프로필 테이블에서 이름 조회
            const { data: profiles } = await this.supabase
                .from('profiles')
                .select('id, display_name, email')
                .in('id', userIds);

            this.currentProjectMembers = profiles || [];
        } catch (e) {
            console.error("멤버 로드 실패", e);
            this.currentProjectMembers = [];
        }
    }

    async syncTask(task) {
        if (!Auth.isLoggedIn) return;

        try {
            const projectName = document.getElementById('appTitle').innerText.trim();

            // 권한 체크
            if (!Auth.isAdmin) {
                const hasPermission = await this.checkPermission(Auth.user.id, projectName);
                if (!hasPermission) {
                    alert("데이터 수정 권한이 없습니다.");
                    return;
                }
            }

            // 데이터에 프로젝트 이름 및 사용자 ID 추가
            const taskWithMeta = {
                ...task,
                project_name: projectName,
                user_id: Auth.user.id
            };

            // 깔끔한 upsert 로직 (description fallback 포함)
            const performUpsert = async (dataToSync) => {
                const { error: upsertError } = await this.supabase
                    .from('tasks')
                    .upsert(dataToSync);

                if (upsertError && upsertError.message.includes('description')) {
                    const { description, ...dataWithoutDesc } = dataToSync;
                    return await this.supabase.from('tasks').upsert(dataWithoutDesc);
                }
                return { error: upsertError };
            };

            const { error: finalError } = await performUpsert(taskWithMeta);
            if (finalError) throw finalError;
        } catch (err) {
            console.error('Error syncing task:', err.message);
        }
    }


    async deleteFromSupabase(id) {
        try {
            // 1. 내가 부모라면 나를 참조하는 자식들도 다 지워야 함 (Recursive or Cascade logic)
            // 2. 내가 Row 주인이라면 나한테 붙은 same row item들도 지워야 함
            // Supabase API로 한 번에 처리
            const { error } = await this.supabase
                .from('tasks')
                .delete()
                .or(`id.eq.${id},parentId.eq.${id},rowTaskId.eq.${id}`); // 나, 내 자식, 내 옆방 친구 모두 삭제

            if (error) {
                console.error("Supabase Delete Error:", error);
                throw error;
            }
        } catch (err) {
            console.error('Error deleting task:', err.message);
            alert("삭제 중 오류가 발생했습니다: " + err.message);
        }
    }

    // --- Core Logic ---

    isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    calculateEndDate(startDate, weekdays) {
        let date = new Date(startDate);
        let count = 0;
        while (count < weekdays) {
            date.setDate(date.getDate() + 1);
            if (!this.isWeekend(date)) {
                count++;
            }
        }
        return date.toISOString().split('T')[0];
    }

    calculateWeekdays(startDate, endDate) {
        let start = new Date(startDate);
        let end = new Date(endDate);
        let count = 0;
        let cur = new Date(start);
        while (cur < end) {
            cur.setDate(cur.getDate() + 1);
            if (!this.isWeekend(cur)) {
                count++;
            }
        }
        return count;
    }

    formatDate(date) {
        return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
    }

    updateDateDisplay() {
        document.getElementById('viewStartDateText').innerText = this.formatDate(this.viewStart);
        document.getElementById('viewEndDateText').innerText = this.formatDate(this.viewEnd);
    }

    // --- Project List Management ---

    async fetchProjectList() {
        try {
            const { data, error } = await this.supabase
                .from('tasks')
                .select('project_name');

            if (error) throw error;

            const uniqueProjects = [...new Set(data.map(item => item.project_name))].filter(Boolean).sort();
            this.renderProjectDropdown(uniqueProjects);
        } catch (err) {
            console.error('Project list fetch failed:', err.message);
        }
    }

    renderProjectDropdown(projects) {
        const listContainer = document.getElementById('projectListItems');
        if (!listContainer) return;
        listContainer.innerHTML = '';

        if (projects.length === 0) {
            listContainer.innerHTML = '<li style="padding:10px; font-size:12px; color:#999;">No projects yet</li>';
            return;
        }

        projects.forEach(name => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '4px 8px';
            li.className = this.activeProject === name ? 'active-project-item' : '';

            li.innerHTML = `
                <span class="project-name-link" style="flex-grow: 1; cursor: pointer; padding: 4px; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="layout" style="width:14px;"></i> ${name}
                </span>
                ${Auth.isAdmin ? `
                <button class="project-delete-btn" style="background:none; border:none; color:var(--danger-color); cursor:pointer; padding:4px;">
                    <i data-lucide="trash-2" style="width:14px;"></i>
                </button>` : ''}
            `;

            li.querySelector('.project-name-link').onclick = (e) => {
                e.stopPropagation();
                this.switchProject(name);
                document.getElementById('projectDropdown').classList.add('hidden');
            };

            const deleteBtn = li.querySelector('.project-delete-btn');
            if (deleteBtn) {
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.deleteProject(name);
                };
            }

            listContainer.appendChild(li);
        });
        lucide.createIcons();
    }

    async switchProject(name) {
        this.activeProject = name;
        localStorage.setItem('lastProject', name);
        await this.loadTasks();
    }

    async createNewProject() {
        const name = prompt('새 프로젝트 이름을 입력하세요:');
        if (!name || name.trim() === '') return;

        const projectName = name.trim();

        const newTask = {
            label: 'New Task',
            start: new Date().toISOString().split('T')[0],
            end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            progress: 0,
            color: '#0073ea',
            type: 'Task',
            expanded: true,
            parentId: null,
            weekdays: 5,
            state: 'none',
            project_name: projectName,
            user_id: Auth.user.id,
            description: ''
        };

        try {
            const { error } = await this.supabase.from('tasks').insert([newTask]);
            if (error) throw error;

            this.switchProject(projectName);
            this.fetchProjectList();
        } catch (err) {
            alert('프로젝트 생성 실패: ' + err.message);
        }
    }

    async deleteProject(projectName) {
        if (!Auth.isAdmin) {
            alert("관리자만 프로젝트를 삭제할 수 있습니다.");
            return;
        }

        if (!confirm(`'${projectName}' 프로젝트의 모든 데이터가 영구 삭제됩니다. 계속하시겠습니까?`)) {
            return;
        }

        try {
            const { error } = await this.supabase
                .from('tasks')
                .delete()
                .eq('project_name', projectName);

            if (error) throw error;

            alert(`'${projectName}' 프로젝트가 삭제되었습니다.`);

            if (this.activeProject === projectName) {
                this.activeProject = null;
                localStorage.removeItem('lastProject');
                this.renderInitialState();
            }

            this.fetchProjectList();
        } catch (err) {
            console.error('Project deletion failed:', err.message);
            alert('삭제 중 오류가 발생했습니다.');
        }
    }

    // --- Rendering ---

    renderAll() {
        this.updateDateDisplay();
        this.renderTreeGrid();
        this.renderGanttTimeline();
        this.renderGanttBars();
        this.updateTodayIndicator();
    }

    renderTreeGrid() {
        const container = document.getElementById('treeGrid');
        container.innerHTML = '';
        const filter = this.searchQuery.toLowerCase();

        // 헬퍼: 날짜 계산
        const getDuration = (s, e) => {
            if (!s || !e) return '-';
            const diff = Math.ceil((new Date(e) - new Date(s)) / (1000 * 60 * 60 * 24));
            return (diff + 1) + 'd';
        };

        // [소유자 옵션 HTML 생성]
        const members = this.currentProjectMembers || [];
        const createOwnerSelect = (taskId, currentUserId) => {
            let options = `<option value="">-</option>`;
            members.forEach(m => {
                const selected = String(m.id) === String(currentUserId) ? 'selected' : '';
                const name = m.display_name || m.email.split('@')[0];
                options += `<option value="${m.id}" ${selected}>${name}</option>`;
            });
            // onchange 이벤트로 즉시 업데이트
            return `<select class="owner-select" onchange="app.updateTaskOwner('${taskId}', this.value)" onclick="event.stopPropagation()">${options}</select>`;
        };

        const renderItem = (task, depth = 0) => {
            if (task.rowTaskId) return; // Same Row Item은 트리에서 제외

            // 필터 로직
            const matches = task.label.toLowerCase().includes(filter);
            const hasVisibleChild = this.tasks.some(t => t.parentId === task.id && (t.label.toLowerCase().includes(filter) || filter === ''));
            if (filter !== '' && !matches && !hasVisibleChild) return;

            const row = document.createElement('div');
            // 'project-row' 클래스: 최상위(parentId가 없는) 항목에만 적용
            row.className = `tree-row ${!task.parentId ? 'project-row' : ''}`;
            row.dataset.id = task.id;

            const hasChildren = this.tasks.some(t => t.parentId === task.id);
            const indent = depth * 20 + 8;

            row.innerHTML = `
                <div class="tree-cell name-cell" style="padding-left: ${indent}px;">
                    <span class="tree-expander">
                        ${hasChildren ? `<i data-lucide="${task.expanded ? 'chevron-down' : 'chevron-right'}"></i>` : ''}
                    </span>
                    <span class="tree-label-text">${task.label}</span>
                    <button class="icon-btn more-btn" style="margin-left:auto; opacity:0;"><i data-lucide="more-vertical" style="width:14px;"></i></button>
                </div>
                <div class="tree-cell">${createOwnerSelect(task.id, task.user_id)}</div>
                <div class="tree-cell">${task.start ? task.start.substring(5).replace('-', '/') : '-'}</div>
                <div class="tree-cell">${task.end ? task.end.substring(5).replace('-', '/') : '-'}</div>
                <div class="tree-cell">${getDuration(task.start, task.end)}</div>
                <div class="tree-cell" style="flex-direction:column; justify-content:center; align-items: flex-start;">
                    <span style="font-size:10px;">${task.progress}%</span>
                    <div class="cell-progress-bar"><div class="cell-progress-value" style="width: ${task.progress}%;"></div></div>
                </div>
            `;
            container.appendChild(row);

            // 이벤트 리스너 (더보기 버튼 등)
            row.addEventListener('mouseenter', () => { const b = row.querySelector('.more-btn'); if (b) b.style.opacity = '1'; });
            row.addEventListener('mouseleave', () => { const b = row.querySelector('.more-btn'); if (b) b.style.opacity = '0'; });

            if (task.expanded || filter !== '') {
                this.tasks.filter(t => t.parentId === task.id).forEach(c => renderItem(c, depth + 1));
            }
        };

        this.tasks.filter(t => t.parentId === null).forEach(t => renderItem(t));
        lucide.createIcons();
    }

    // [신규 함수] 소유자 변경 시 DB 저장
    async updateTaskOwner(taskId, newUserId) {
        const task = this.tasks.find(t => String(t.id) === String(taskId));
        if (task) {
            task.user_id = newUserId || null;
            await this.syncTask(task); // Supabase 저장
            // 화면 깜빡임 없이 유지하기 위해 renderAll 호출 안 함 (이미 값은 변경됨)
        }
    }

    // [수정] 헤더 높이 및 정렬 완벽 대응
    renderGanttTimeline() {
        const header = document.getElementById('ganttHeader');
        header.innerHTML = '';

        // 1. 상단 행 (Month)
        const monthRow = document.createElement('div');
        monthRow.className = 'gantt-header-months';

        // 2. 하단 행 (Week)
        const weekRow = document.createElement('div');
        weekRow.className = 'gantt-header-weeks';

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        let cur = new Date(this.viewStart);
        cur.setDate(1); // 월의 1일부터 시작

        const adjustedEnd = new Date(this.viewEnd);
        adjustedEnd.setMonth(adjustedEnd.getMonth() + 1);
        adjustedEnd.setDate(0);

        // --- 월(Month) 그리기 ---
        while (cur <= adjustedEnd) {
            const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
            const width = daysInMonth * this.pxPerDay;

            const cell = document.createElement('div');
            cell.className = 'month-cell';
            cell.style.width = `${width}px`;
            // flex-shrink: 0 을 JS에서도 명시
            cell.style.flexShrink = '0';
            cell.innerText = `${months[cur.getMonth()]} ${cur.getFullYear()}`;
            monthRow.appendChild(cell);

            cur.setMonth(cur.getMonth() + 1);
        }

        // --- 주(Week) 그리기 ---
        let weekStart = new Date(this.viewStart);
        // 일요일로 맞춤
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        let weekCur = new Date(weekStart);
        const loopEnd = new Date(adjustedEnd);
        loopEnd.setDate(loopEnd.getDate() + 7);

        while (weekCur <= loopEnd) {
            const weekWidth = 7 * this.pxPerDay;

            // 주차 계산
            const d = new Date(weekCur);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 4 - (d.getDay() || 7));
            const yearStart = new Date(d.getFullYear(), 0, 1);
            const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

            const cell = document.createElement('div');
            cell.className = 'week-cell';
            cell.style.width = `${weekWidth}px`;
            cell.style.flexShrink = '0';
            cell.innerText = `W${weekNo}`;
            weekRow.appendChild(cell);

            weekCur.setDate(weekCur.getDate() + 7);
        }

        header.appendChild(monthRow);
        header.appendChild(weekRow);

        // 배경 그리드 업데이트
        const body = document.getElementById('ganttBody');
        if (body) {
            const weekPx = 7 * this.pxPerDay;
            body.style.backgroundSize = `${weekPx}px 100%`;
            body.style.backgroundImage = `linear-gradient(to right, transparent ${weekPx - 1}px, #f0f0f0 ${weekPx}px)`;
        }
    }

    renderGanttBars() {
        const body = document.getElementById('ganttBody');
        body.innerHTML = ''; // 초기화

        const filter = this.searchQuery.toLowerCase();
        const mainVisibleTasks = [];

        // 트리 리스트와 똑같은 순서로 태스크 수집
        const collectVisible = (parentId = null) => {
            this.tasks.filter(t => t.parentId === parentId && !t.rowTaskId).forEach(t => {
                const matches = t.label.toLowerCase().includes(filter);
                const hasVisibleChild = this.tasks.some(child => child.parentId === t.id && (child.label.toLowerCase().includes(filter) || filter === ''));
                if (filter === '' || matches || hasVisibleChild) {
                    mainVisibleTasks.push(t);
                    if (t.expanded || filter !== '') collectVisible(t.id);
                }
            });
        };
        collectVisible();

        const ROW_HEIGHT = 40; // CSS와 동일하게 40px 고정

        mainVisibleTasks.forEach((mainTask) => {
            // 1. 줄 생성
            const row = document.createElement('div');
            row.className = 'gantt-row';
            row.style.height = `${ROW_HEIGHT}px`;

            // [수정] 메인 프로젝트 행이면 배경색 파랗게 (트리와 통일)
            if (mainTask.parentId === null) {
                row.classList.add('project-row-bg');
            }
            body.appendChild(row);

            // [핵심 해결] 메인 프로젝트(최상위)는 바를 그리지 않고 여기서 종료 (return)
            if (mainTask.parentId === null) return;

            // 2. 바(Bar) 그리기 (Main Task가 아닐 때만)
            const rowTasks = [mainTask, ...this.tasks.filter(t => t.rowTaskId === mainTask.id)];

            rowTasks.forEach(task => {
                const start = new Date(task.start);
                const end = new Date(task.end);
                const left = (start - this.viewStart) / (1000 * 60 * 60 * 24) * this.pxPerDay;
                const width = (end - start) / (1000 * 60 * 60 * 24) * this.pxPerDay;

                if (width <= 0) return;

                const bar = document.createElement('div');
                bar.className = 'gantt-bar';
                bar.style.left = `${left}px`;
                bar.style.width = `${width}px`;
                bar.style.top = '8px'; // 40px 높이 중앙 정렬
                bar.dataset.id = task.id;

                let barColor = task.color;
                if (parseInt(task.progress) === 100) barColor = '#000000';
                bar.style.backgroundColor = barColor;

                bar.innerHTML = `
                    <div class="resizer resizer-l"></div>
                    <div class="progress-fill" style="width: ${task.progress}%; background-color: rgba(0,0,0,0.3);"></div>
                    <span class="bar-label">${task.label}</span>
                    <div class="resizer resizer-r"></div>
                `;

                // 이벤트 연결
                bar.addEventListener('contextmenu', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    this.showContextMenu(e, task.id);
                });

                // 줄 안에 바 넣기
                row.appendChild(bar);
            });
        });

        body.style.height = `${mainVisibleTasks.length * ROW_HEIGHT + 50}px`;
        this.updateTodayIndicator();
    }

    updateTodayIndicator() {
        const today = new Date();
        const indicator = document.querySelector('.today-indicator');
        if (today >= this.viewStart && today <= this.viewEnd) {
            const left = (today - this.viewStart) / (1000 * 60 * 60 * 24) * this.pxPerDay;
            indicator.style.left = `${left}px`;
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }

    // --- Interaction ---

    bindEvents() {
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.renderAll();
        });

        document.getElementById('zoomIn').onclick = () => {
            this.pxPerDay = Math.min(100, this.pxPerDay + 5);
            this.renderAll();
        };
        document.getElementById('zoomOut').onclick = () => {
            this.pxPerDay = Math.max(5, this.pxPerDay - 5);
            this.renderAll();
        };

        document.getElementById('prevStart').onclick = () => this.shiftView('start', -7);
        document.getElementById('nextStart').onclick = () => this.shiftView('start', 7);
        document.getElementById('prevEnd').onclick = () => this.shiftView('end', -7);
        document.getElementById('nextEnd').onclick = () => this.shiftView('end', 7);

        document.getElementById('globalAddTask').onclick = () => this.addNewTask(null);
        document.getElementById('headerNewProjectBtn').onclick = () => this.createNewProject();

        // 프로젝트 목록 드롭다운 관련
        const projectBtn = document.getElementById('showProjectList');
        const projectDropdown = document.getElementById('projectDropdown');
        const appTitle = document.getElementById('appTitle');

        const toggleDropdown = (e) => {
            e.stopPropagation();
            const isHidden = projectDropdown.classList.contains('hidden');
            if (isHidden) {
                projectDropdown.classList.remove('hidden');
                this.fetchProjectList();
            } else {
                projectDropdown.classList.add('hidden');
            }
        };

        projectBtn.onclick = toggleDropdown;

        // 제목 클릭 시에도 드롭다운 (편집 중이 아닐 때)
        appTitle.onclick = (e) => {
            if (document.activeElement !== appTitle) {
                toggleDropdown(e);
            }
        };

        // 제목 편집 가능하게 유지
        appTitle.addEventListener('blur', () => {
            const newName = document.getElementById('appTitle').innerText.trim();
            if (this.activeProject !== newName && newName !== '') {
                this.switchProject(newName);
            }
        });

        // 엔터 키를 눌렀을 때도 저장 및 로드
        document.getElementById('appTitle').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        });

        // 외부(전역) 클릭 시 닫기
        window.addEventListener('click', (e) => {
            if (document.getElementById('projectDropdown')) {
                document.getElementById('projectDropdown').classList.add('hidden');
            }
            if (!document.getElementById('contextMenu').contains(e.target)) {
                this.hideContextMenu();
            }
        });

        // Drag & Resize logic
        let isInteracting = false;
        let interactionType = null;
        let targetTaskId = null;
        let startX = 0;
        let initialLeft = 0;
        let initialWidth = 0;

        document.getElementById('ganttBody').addEventListener('mousedown', (e) => {
            const resizer = e.target.closest('.resizer');
            const bar = e.target.closest('.gantt-bar');
            if (!bar) return;

            isInteracting = true;
            targetTaskId = bar.dataset.id;
            startX = e.clientX;
            initialLeft = parseFloat(bar.style.left);
            initialWidth = parseFloat(bar.style.width);

            interactionType = resizer ? (resizer.classList.contains('resizer-l') ? 'resize-l' : 'resize-r') : 'drag';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isInteracting) return;
            const deltaX = e.clientX - startX;
            const bar = document.querySelector(`.gantt-bar[data-id="${targetTaskId}"]`);
            if (!bar) return;

            if (interactionType === 'drag') {
                bar.style.left = `${initialLeft + deltaX}px`;
            } else if (interactionType === 'resize-l') {
                const newLeft = initialLeft + deltaX;
                const newWidth = initialWidth - deltaX;
                if (newWidth > 10) { bar.style.left = `${newLeft}px`; bar.style.width = `${newWidth}px`; }
            } else if (interactionType === 'resize-r') {
                const newWidth = initialWidth + deltaX;
                if (newWidth > 10) bar.style.width = `${newWidth}px`;
            }
        });

        window.addEventListener('mouseup', async () => {
            if (!isInteracting) return;
            const bar = document.querySelector(`.gantt-bar[data-id="${targetTaskId}"]`);
            const task = this.tasks.find(t => t.id === targetTaskId);

            if (bar && task) {
                const left = parseFloat(bar.style.left);
                const width = parseFloat(bar.style.width);
                const startMs = this.viewStart.getTime() + (left / this.pxPerDay) * (1000 * 60 * 60 * 24);
                const endMs = startMs + (width / this.pxPerDay) * (1000 * 60 * 60 * 24);

                task.start = new Date(startMs).toISOString().split('T')[0];
                task.end = new Date(endMs).toISOString().split('T')[0];
                task.weekdays = this.calculateWeekdays(task.start, task.end);

                await this.syncTask(task); // Supabase 동기화
            }

            isInteracting = false;
            targetTaskId = null;
            this.renderAll();
        });

        document.getElementById('treeGrid').addEventListener('click', (e) => {
            const row = e.target.closest('.tree-row');
            if (!row) return;
            const id = row.dataset.id;
            const task = this.tasks.find(t => String(t.id) === String(id));

            if (e.target.closest('.tree-expander')) {
                if (task) {
                    task.expanded = !task.expanded;
                    this.renderAll();
                    this.syncTask(task);
                }
                return;
            }

            // 수정: more-btn 클릭 감지 강화
            const moreBtn = e.target.closest('.more-btn');
            if (moreBtn) {
                e.stopPropagation();
                this.showContextMenu(e, id);
                return;
            }

            document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
        });

        document.getElementById('treeGrid').addEventListener('dblclick', (e) => {
            const row = e.target.closest('.tree-row');
            if (row) this.openEditModal(row.dataset.id);
        });
        document.getElementById('ganttBody').addEventListener('dblclick', (e) => {
            const bar = e.target.closest('.gantt-bar');
            if (bar) this.openEditModal(bar.dataset.id);
        });

        document.getElementById('contextMenu').addEventListener('click', (e) => {
            const action = e.target.closest('li')?.dataset.action;
            if (!action || e.target.closest('li').classList.contains('disabled')) return;
            const taskId = document.getElementById('contextMenu').dataset.taskId;
            this.handleMenuAction(action, taskId);
            this.hideContextMenu();
        });

        window.addEventListener('click', (e) => {
            if (!e.target.closest('#contextMenu') && !e.target.closest('.more-btn')) this.hideContextMenu();
        });

        document.getElementById('cancelEdit').onclick = () => this.closeEditModal();
        document.getElementById('saveTask').onclick = () => this.saveTask();
        document.getElementById('deleteTask').onclick = () => {
            this.deleteTask(this.editingTaskId);
            this.closeEditModal();
        };

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn, .tab-panel').forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            });
        });

        const startInput = document.getElementById('editTaskStart');
        const weekdayInput = document.getElementById('editTaskWeekdays');
        const endInput = document.getElementById('editTaskEnd');

        startInput.onchange = () => { if (weekdayInput.value) endInput.value = this.calculateEndDate(startInput.value, parseInt(weekdayInput.value)); };
        weekdayInput.oninput = () => { if (startInput.value) endInput.value = this.calculateEndDate(startInput.value, parseInt(weekdayInput.value)); };
        endInput.onchange = () => { if (startInput.value) weekdayInput.value = this.calculateWeekdays(startInput.value, endInput.value); };

        document.getElementById('editTaskProgress').oninput = (e) => {
            document.getElementById('progressValue').innerText = `${e.target.value}%`;
        };

        // [추가] 스크롤 동기화 함수 실행
        this.bindScrollSync();
    }

    shiftView(type, days) {
        if (type === 'start') this.viewStart.setDate(this.viewStart.getDate() + days);
        else this.viewEnd.setDate(this.viewEnd.getDate() + days);
        this.renderAll();
    }

    showContextMenu(e, taskId) {
        const menu = document.getElementById('contextMenu');
        menu.classList.remove('hidden');
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.dataset.taskId = taskId;
        lucide.createIcons(); // 아이콘 재생성 확인
    }

    hideContextMenu() {
        document.getElementById('contextMenu').classList.add('hidden');
    }

    // [수정] 스크롤 동기화 (Body to Body 매칭)
    bindScrollSync() {
        const tree = document.getElementById('treeGrid');       // 왼쪽 몸통
        const ganttBody = document.getElementById('ganttBody'); // 오른쪽 몸통 (Main Scroller)
        const ganttHeader = document.getElementById('ganttHeader'); // 오른쪽 헤더

        if (!tree || !ganttBody || !ganttHeader) return;

        // 1. [Main] 오른쪽 몸통(Body)을 스크롤할 때
        ganttBody.addEventListener('scroll', () => {
            // 세로 스크롤 -> 왼쪽 리스트 동기화
            tree.scrollTop = ganttBody.scrollTop;

            // 가로 스크롤 -> 오른쪽 헤더 동기화 (날짜가 같이 옆으로 이동)
            ganttHeader.scrollLeft = ganttBody.scrollLeft;
        });

        // 2. 왼쪽 리스트에서 휠을 굴릴 때 -> 오른쪽 몸통을 움직임
        tree.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                // 오른쪽 몸통을 스크롤하면 -> 위 1번 이벤트가 발생해서 왼쪽도 따라감
                ganttBody.scrollTop += e.deltaY;
            }
        }, { passive: false });
    }

    handleMenuAction(action, taskId) {
        switch (action) {
            case 'edit': this.openEditModal(taskId); break;
            case 'newChild': this.addNewTask(taskId); break;
            case 'newSameRow': this.addNewTask(null, taskId); break;
            case 'delete': this.deleteTask(taskId); break;
            case 'moveUp': this.moveTask(taskId, -1); break;   // 위로 이동
            case 'moveDown': this.moveTask(taskId, 1); break;  // 아래로 이동
            case 'copy': console.log('Copy'); break;
            case 'paste': console.log('Paste'); break;
            case 'template': console.log('Template'); break;
        }
    }

    async addNewTask(parentId = null, rowTaskId = null) {
        const projectName = document.getElementById('appTitle').innerText.trim();
        let labelName = "New Task";

        // 메인 태스크는 이름만 입력받고 끝냄 (모달 안 띄움)
        if (!parentId && !rowTaskId) {
            const input = prompt("Enter Main Task Name:");
            if (input === null || input.trim() === "") return;
            labelName = input.trim();
        } else {
            labelName = rowTaskId ? 'Sub item' : 'Child item';
        }

        const newTask = {
            label: labelName,
            start: new Date().toISOString().split('T')[0],
            end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            progress: 0,
            color: '#0084d1',
            type: 'Task',
            expanded: true,
            parentId: parentId,
            rowTaskId: rowTaskId,
            weekdays: 5,
            state: 'none',
            project_name: projectName,
            user_id: Auth.user.id,
            description: ''
        };

        try {
            const { data, error } = await this.supabase.from('tasks').insert([newTask]).select();
            if (error) throw error;
            const created = data[0];
            this.tasks.push(created);

            // 데이터 추가 후 화면 갱신
            this.renderAll();

            // [안전 장치] 메인 태스크가 아닐 때만, 그리고 데이터가 확실히 있을 때만 모달 열기
            if (parentId || rowTaskId) {
                // DOM이 그려질 시간을 조금 줍니다 (50ms)
                setTimeout(() => {
                    if (created && created.id) this.openEditModal(created.id);
                }, 50);
            }
        } catch (err) {
            console.error('Task Add Error:', err);
            // alert를 띄우지 않고 콘솔에만 기록하여 사용자 방해 최소화
        }
    }

    async deleteTask(id) {
        // [수정] 관리자가 아니고, 현재 프로젝트 권한도 없으면 거부
        const hasPermission = await this.checkPermission(Auth.user.id, this.activeProject);

        // (관리자가 아님 AND 권한없음) 이면 차단
        if (!Auth.isAdmin && !hasPermission) {
            alert("권한이 없습니다: 프로젝트 멤버 또는 관리자만 삭제할 수 있습니다.");
            return;
        }

        if (!confirm("정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
            return;
        }

        await this.deleteFromSupabase(id);

        // 화면 갱신
        const sid = String(id);
        this.tasks = this.tasks.filter(t =>
            String(t.id) !== sid && String(t.parentId) !== sid && String(t.rowTaskId) !== sid
        );
        this.renderAll();
    }

    // 2. 이동 로직 업그레이드 (DB 저장 기능 추가)
    // [수정] 순서 이동 기능 (트리 구조 및 간트 차트 동기화 문제 해결)
    async moveTask(id, dir) {
        // 1. 현재 이동하려는 태스크 찾기
        const task = this.tasks.find(t => String(t.id) === String(id));
        if (!task) return;

        // 2. 나와 같은 레벨의 형제들(Siblings)만 모아서 현재 순서대로 정렬
        // (부모가 같고, rowTaskId가 같은 항목들)
        const siblings = this.tasks
            .filter(t => t.parentId === task.parentId && t.rowTaskId === task.rowTaskId)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        // 3. 형제 리스트 안에서 나의 현재 위치(Index) 찾기
        const currentIndex = siblings.findIndex(t => String(t.id) === String(id));
        if (currentIndex === -1) return;

        // 4. 이동할 목표 위치 계산
        const targetIndex = currentIndex + dir;
        if (targetIndex < 0 || targetIndex >= siblings.length) return; // 더 이상 이동 불가

        // 5. 맞바꿀 대상 태스크 가져오기
        const targetTask = siblings[targetIndex];

        // 6. 서로의 sort_order 값 교환
        // (값이 없으면 현재 인덱스를 기준으로 임시 값 생성)
        const orderA = task.sort_order !== null ? task.sort_order : currentIndex;
        const orderB = targetTask.sort_order !== null ? targetTask.sort_order : targetIndex;

        task.sort_order = orderB;
        targetTask.sort_order = orderA;

        // 7. [핵심] 전체 배열을 sort_order 기준으로 재정렬
        // 이 과정이 있어야 왼쪽 트리와 오른쪽 간트 차트가 똑같은 순서로 그려집니다.
        this.tasks.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        // 8. 화면 즉시 갱신 (이제 줄이 딱 맞을 겁니다)
        this.renderAll();

        // 9. 변경된 순서를 DB에 저장 (백그라운드 처리)
        try {
            await this.supabase.from('tasks').upsert([
                { id: task.id, sort_order: task.sort_order },
                { id: targetTask.id, sort_order: targetTask.sort_order }
            ]);
        } catch (e) {
            console.error("순서 저장 실패:", e);
        }
    }

    openEditModal(taskId) {
        const task = this.tasks.find(t => String(t.id) === String(taskId));
        if (!task) return;

        this.editingTaskId = taskId;
        document.getElementById('editTaskLabel').value = task.label;
        document.getElementById('editTaskStart').value = task.start;
        document.getElementById('editTaskEnd').value = task.end;
        document.getElementById('editTaskWeekdays').value = task.weekdays;
        document.getElementById('editTaskProgress').value = task.progress;
        document.getElementById('progressValue').innerText = `${task.progress}%`;
        document.getElementById('editTaskType').value = task.type;
        document.getElementById('editTaskState').value = task.state;
        document.getElementById('editTaskDescription').value = task.description || '';

        // [New] 컬러 팔레트 생성 함수 호출
        generateColorPalette(task.color);

        document.getElementById('editModal').classList.remove('hidden');
    }

    closeEditModal() {
        document.getElementById('editModal').classList.add('hidden');
        this.editingTaskId = null;
    }

    async saveTask() {
        if (!this.editingTaskId) return;
        const task = this.tasks.find(t => String(t.id) === String(this.editingTaskId));

        task.label = document.getElementById('editTaskLabel').value;
        task.start = document.getElementById('editTaskStart').value;
        task.end = document.getElementById('editTaskEnd').value;
        task.weekdays = parseInt(document.getElementById('editTaskWeekdays').value);
        task.progress = parseInt(document.getElementById('editTaskProgress').value);
        task.type = document.getElementById('editTaskType').value;
        task.state = document.getElementById('editTaskState').value;
        task.description = document.getElementById('editTaskDescription').value;

        // [New] 선택된 컬러 값을 가져와서 저장
        const selectedColor = document.getElementById('editTaskColorValue').value;
        if (selectedColor) {
            task.color = selectedColor;
        }

        await this.syncTask(task);
        this.renderAll();
        this.closeEditModal();
    }

    // [신규 함수] 프로젝트 멤버 이니셜 표시
    async renderProjectMemberIcons(projectName) {
        // 아이콘을 넣을 위치 찾기 (HR 제목 옆)
        const headerContainer = document.querySelector('.header-left .logo').parentNode;

        // 기존에 그려진 아이콘이 있다면 삭제 (중복 방지)
        const oldIcons = headerContainer.querySelectorAll('.project-member-icon');
        oldIcons.forEach(el => el.remove());

        try {
            // 1. 이 프로젝트의 멤버 ID 조회
            const { data: perms } = await this.supabase
                .from('user_permissions')
                .select('user_id')
                .eq('project_name', projectName)
                .eq('is_approved', true);

            if (!perms || perms.length === 0) return;

            const userIds = perms.map(p => p.user_id);

            // 2. 프로필 정보(이름) 조회
            const { data: profiles } = await this.supabase
                .from('profiles')
                .select('display_name, email')
                .in('id', userIds);

            if (!profiles) return;

            // 3. 아이콘 생성 및 부착
            profiles.forEach(user => {
                const name = user.display_name || user.email;
                const initial = name.charAt(0).toUpperCase();

                const badge = document.createElement('div');
                badge.className = 'project-member-icon'; // CSS 스타일링용 클래스
                badge.innerText = initial;
                badge.title = name; // 마우스 올리면 이름 나옴

                // 스타일 직접 지정 (CSS 파일에 넣어도 됨)
                Object.assign(badge.style, {
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: '#FF7575', // 요청하신 붉은색 계열
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: '8px',
                    cursor: 'help'
                });

                headerContainer.appendChild(badge);
            });

        } catch (e) {
            console.error("멤버 아이콘 로드 실패", e);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new GanttApp();
});

// --- Member Management Add-on ---

/**
 * [Admin Only] Render User List with Grant/Revoke Buttons
 */
async function renderUserList() {
    const tableBody = document.getElementById('adminUserTableBody');
    if (!tableBody) return;

    try {
        // 1. 유저, 프로젝트, 그리고 '이미 부여된 권한'을 모두 가져옵니다.
        const [usersResult, projectsResult, permissionsResult] = await Promise.all([
            window.app.supabase.from('profiles').select('*').order('display_name', { ascending: true }),
            window.app.supabase.from('tasks').select('project_name'),
            window.app.supabase.from('user_permissions').select('*') // 권한 목록 조회
        ]);

        const users = usersResult.data || [];
        const projectData = projectsResult.data || [];
        const permissions = permissionsResult.data || [];

        if (usersResult.error) throw usersResult.error;

        // 프로젝트 목록 중복 제거
        const uniqueProjects = [...new Set(projectData.map(item => item.project_name))]
            .filter(name => name && name.trim() !== '').sort();

        // 프로젝트 선택 옵션 HTML 생성
        let projectOptions = '<option value="">Select Project</option>';
        uniqueProjects.forEach(name => {
            projectOptions += `<option value="${name}">${name}</option>`;
        });

        if (users.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 30px;">No members found.</td></tr>';
            return;
        }

        // 테이블 렌더링
        tableBody.innerHTML = users.map(user => {
            // 이 유저가 가진 권한들을 찾습니다.
            const userPerms = permissions.filter(p => p.user_id === user.id);

            // 권한 목록을 배지로 표시 (삭제 버튼 포함)
            const permBadges = userPerms.map(p => `
                <span style="
                    display: inline-flex; align-items: center; gap: 4px; 
                    background: #e1f2ff; color: #0073ea; 
                    padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-right: 4px;">
                    ${p.project_name}
                    <i data-lucide="x" 
                       style="width:12px; height:12px; cursor:pointer;" 
                       onclick="Auth.revokePermission('${p.id}')"></i>
                </span>
            `).join('');

            return `
            <tr style="border-bottom: 1px solid #f0f0f0;">
                <td style="padding: 12px 24px;">
                    <div style="font-weight: 600;">${user.display_name || user.full_name || 'No Name'}</div>
                    <div style="font-size: 12px; color: #666;">${user.email}</div>
                </td>
                <td style="padding: 12px 24px;">
                    ${permBadges || '<span style="color:#999; font-size:12px;">No permissions</span>'}
                </td>
                <td style="padding: 12px 24px;">
                    <div style="display: flex; gap: 8px;">
                        <select id="proj-${user.id}" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
                            ${projectOptions}
                        </select>
                        <button onclick="executeGrantPermission('${user.id}')" class="grant-btn">Grant</button>
                    </div>
                </td>
            </tr>
        `;
        }).join('');

        lucide.createIcons();

    } catch (err) {
        console.error('Failed to load admin data:', err.message);
    }
}

/**
 * [Admin Only] Grant Full Access (Read + Write)
 * Simplified Logic: One button grants full permissions for the selected project.
 */
async function executeGrantPermission(userId) {
    const projInput = document.getElementById(`proj-${userId}`);
    const projectName = projInput ? projInput.value.trim() : "";

    if (!projectName) {
        alert('Please select a project first.');
        return;
    }

    try {
        // Grant FULL access (Read: true, Write: true)
        const upsertData = {
            user_id: userId,
            project_name: projectName,
            is_approved: true,
            can_read: true,
            can_write: true // Always give write access when granting
        };

        const { error } = await window.app.supabase
            .from('user_permissions')
            .upsert(upsertData, { onConflict: 'user_id, project_name' });

        if (error) throw error;

        alert(`Successfully granted access to project: [${projectName}]`);
    } catch (err) {
        console.error('Permission Error:', err.message);
        alert('Error granting permission: ' + err.message);
    }
}

// --- [Color Logic Add-on] Monday.com Palette ---

// Monday.com Tones (Red, Orange, Yellow, Green, Blue, Indigo, Violet)
const MONDAY_COLORS = [
    '#E2445C', // Red
    '#FF9F00', // Orange
    '#FFCB00', // Yellow
    '#00C875', // Green
    '#0073EA', // Blue
    '#579BFC', // Indigo (Dark Blue)
    '#A25DDC'  // Violet (Purple)
];

/**
 * 7가지 색상 팔레트를 생성하고 클릭 이벤트를 연결하는 함수
 */
function generateColorPalette(selectedColor) {
    const container = document.getElementById('colorPalette');
    const hiddenInput = document.getElementById('editTaskColorValue');

    if (!container || !hiddenInput) return;

    container.innerHTML = ''; // 초기화

    // 기본값이 없거나 이상하면 파란색(#0073EA)을 기본으로
    if (!selectedColor || !MONDAY_COLORS.includes(selectedColor)) {
        selectedColor = '#0073EA';
    }
    hiddenInput.value = selectedColor;

    MONDAY_COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;

        if (color === selectedColor) {
            swatch.classList.add('selected');
        }

        // 색상 클릭 이벤트
        swatch.onclick = () => {
            // 모든 선택 해제 후 현재 클릭한 것만 선택
            document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
            swatch.classList.add('selected');
            hiddenInput.value = color; // 숨겨진 input에 값 저장
        };

        container.appendChild(swatch);
    });
}
