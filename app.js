/**
 * Gantt Application Logic with Supabase Integration
 */

class GanttApp {
    constructor() {
        // CONFIG가 정의되어 있는지 확인
        if (typeof CONFIG === 'undefined') {
            console.error('config.js 파일을 찾을 수 없습니다.');
            return;
        }

        // Supabase 클라이언트 초기화
        this.supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

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

            // 관리자가 아니고, 해당 프로젝트 권한이 없는 경우 체크
            if (!Auth.isAdmin) {
                const hasPermission = await this.checkPermission(Auth.user.id, projectName);
                if (!hasPermission) {
                    alert(`'${projectName}' 프로젝트에 대한 접근 권한이 없습니다. 관리자에게 승인을 요청하세요.`);
                    this.tasks = [];
                    this.renderAll();
                    return;
                }
            }

            const { data, error } = await this.supabase
                .from('tasks')
                .select('*')
                .eq('project_name', projectName)
                .order('created_at', { ascending: true });

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
            document.getElementById('activeProjectName').innerText = '프로젝트를 선택하세요';
        }
        document.getElementById('appTitle').innerText = 'Select Project';
        this.renderAll();
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
            // 트리 구조이므로 하위 태스크나 같은 행의 세그먼트도 함께 삭제 고려
            // Supabase에서 cascade 설정이 되어있지 않다면 수동으로 처리
            const { error } = await this.supabase
                .from('tasks')
                .delete()
                .or(`id.eq.${id},parentId.eq.${id},rowTaskId.eq.${id}`);

            if (error) throw error;
        } catch (err) {
            console.error('Error deleting task:', err.message);
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

        const renderItem = (task, depth = 0) => {
            if (task.rowTaskId) return;

            const matchesFilter = task.label.toLowerCase().includes(filter);
            const hasVisibleChildren = this.tasks.some(t => t.parentId === task.id && (t.label.toLowerCase().includes(filter) || filter === ''));
            const hasVisibleSegments = this.tasks.some(t => t.rowTaskId === task.id && t.label.toLowerCase().includes(filter));

            if (filter !== '' && !matchesFilter && !hasVisibleChildren && !hasVisibleSegments) return;

            const row = document.createElement('div');
            row.className = 'tree-row';
            row.dataset.id = task.id;
            row.style.paddingLeft = `${depth * 20 + 12}px`;

            const hasChildren = this.tasks.some(t => t.parentId === task.id);

            row.innerHTML = `
                <div class="tree-expander">
                    ${hasChildren ? `<i data-lucide="${task.expanded ? 'chevron-down' : 'chevron-right'}"></i>` : ''}
                </div>
                <div class="tree-label">${task.label}</div>
                <div class="tree-actions">
                    <button class="icon-btn more-btn"><i data-lucide="more-vertical"></i></button>
                </div>
            `;

            container.appendChild(row);

            if (task.expanded || filter !== '') {
                this.tasks
                    .filter(t => t.parentId === task.id)
                    .forEach(child => renderItem(child, depth + 1));
            }
        };

        this.tasks
            .filter(t => t.parentId === null)
            .forEach(task => renderItem(task));

        lucide.createIcons();
    }

    renderGanttTimeline() {
        const header = document.getElementById('ganttHeader');
        header.innerHTML = '';

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        let cur = new Date(this.viewStart);
        cur.setDate(1);

        const adjustedEnd = new Date(this.viewEnd);
        adjustedEnd.setMonth(adjustedEnd.getMonth() + 1);
        adjustedEnd.setDate(0);

        while (cur <= adjustedEnd) {
            const monthCell = document.createElement('div');
            monthCell.className = 'month-cell';
            const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
            monthCell.style.width = `${daysInMonth * this.pxPerDay}px`;
            monthCell.innerText = `${months[cur.getMonth()]}`;
            header.appendChild(monthCell);
            cur.setMonth(cur.getMonth() + 1);
        }
    }

    renderGanttBars() {
        const body = document.getElementById('ganttBody');
        const oldContent = body.querySelectorAll('.gantt-bar, .gantt-row');
        oldContent.forEach(b => b.remove());

        const filter = this.searchQuery.toLowerCase();
        const mainVisibleTasks = [];

        const collectVisible = (parentId = null) => {
            this.tasks.filter(t => t.parentId === parentId && !t.rowTaskId).forEach(t => {
                const matches = t.label.toLowerCase().includes(filter);
                const sameRowMatches = this.tasks.some(s => s.rowTaskId === t.id && s.label.toLowerCase().includes(filter));
                const hasVisibleChild = this.tasks.some(child => child.parentId === t.id && (child.label.toLowerCase().includes(filter) || filter === ''));

                if (filter === '' || matches || sameRowMatches || hasVisibleChild) {
                    mainVisibleTasks.push(t);
                    if (t.expanded || filter !== '') collectVisible(t.id);
                }
            });
        };
        collectVisible();

        mainVisibleTasks.forEach((mainTask, index) => {
            const row = document.createElement('div');
            row.className = 'gantt-row';
            body.appendChild(row);

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
                bar.style.backgroundColor = task.color;
                bar.style.top = `${index * 40 + 6}px`;
                bar.dataset.id = task.id;

                bar.innerHTML = `
                    <div class="resizer resizer-l"></div>
                    <div class="progress-fill" style="width: ${task.progress}%"></div>
                    <span class="bar-label">${task.label}</span>
                    <div class="resizer resizer-r"></div>
                `;

                body.appendChild(bar);
            });
        });
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

    handleMenuAction(action, taskId) {
        switch (action) {
            case 'edit': this.openEditModal(taskId); break;
            case 'newChild': this.addNewTask(taskId); break;
            case 'newSameRow': this.addNewTask(null, taskId); break;
            case 'delete': this.deleteTask(taskId); break;
            case 'moveUp': this.moveTask(taskId, -1); break;
            case 'moveDown': this.moveTask(taskId, 1); break;
            case 'copy': console.log('Copy'); break;
            case 'paste': console.log('Paste'); break;
            case 'template': console.log('Template'); break;
            case 'openAttachment': console.log('Attachment'); break;
        }
    }

    async addNewTask(parentId = null, rowTaskId = null) {
        const projectName = document.getElementById('appTitle').innerText.trim();
        const newTask = {
            label: rowTaskId ? 'Subtask' : (parentId ? 'New Subtask' : 'New Project'),
            start: '2026-03-01',
            end: '2026-03-15',
            progress: 0,
            color: '#0084d1',
            type: 'Task',
            expanded: true,
            parentId: parentId,
            rowTaskId: rowTaskId,
            weekdays: 10,
            state: 'none',
            project_name: projectName,
            user_id: Auth.user.id, // 작성자 아이디 포함
            description: ''
        };

        try {
            const performInsert = async (dataToInsert) => {
                const { data: insertData, error: insertError } = await this.supabase
                    .from('tasks')
                    .insert([dataToInsert])
                    .select();

                if (insertError && insertError.message.includes('description')) {
                    const { description, ...dataWithoutDesc } = dataToInsert;
                    return await this.supabase.from('tasks').insert([dataWithoutDesc]).select();
                }
                return { data: insertData, error: insertError };
            };

            let { data, error } = await performInsert(newTask);
            if (error) throw error;

            const createdTask = data[0];
            this.tasks.push(createdTask);
            this.renderAll();
            this.openEditModal(createdTask.id);
        } catch (err) {
            console.error('Error adding task:', err.message);
            alert('작업 추가 실패: ' + err.message);
        }
    }

    async deleteTask(id) {
        if (!Auth.isAdmin) {
            alert("Permission Denied: Only administrators can delete tasks.");
            return;
        }

        if (!confirm("Are you sure you want to delete this item? This action cannot be undone.")) {
            return;
        }

        await this.deleteFromSupabase(id);
        const sid = String(id);
        this.tasks = this.tasks.filter(t =>
            String(t.id) !== sid && String(t.parentId) !== sid && String(t.rowTaskId) !== sid
        );
        this.renderAll();
    }

    async moveTask(id, dir) {
        const sid = String(id);
        const index = this.tasks.findIndex(t => String(t.id) === sid);
        if (index === -1) return;
        const newIndex = index + dir;
        if (newIndex < 0 || newIndex >= this.tasks.length) return;

        const temp = this.tasks[index];
        this.tasks[index] = this.tasks[newIndex];
        this.tasks[newIndex] = temp;

        // 순서 변경의 경우 'sort_order' 같은 컬럼을 두고 업데이트하는 것이 정석이나,
        // 여기서는 전체 tasks 배열의 created_at 등을 조정하거나 별도 로직이 필요함.
        // 현재는 메모리 상에서만 이동 후 renderAll 호출
        this.renderAll();
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
        document.getElementById('editTaskColor').style.backgroundColor = task.color;
        document.getElementById('editTaskState').value = task.state;
        document.getElementById('editTaskDescription').value = task.description || ''; // 설명 로드
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
        task.description = document.getElementById('editTaskDescription').value; // 설명 저장

        await this.syncTask(task);
        this.renderAll();
        this.closeEditModal();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new GanttApp();
});

// --- Member Management Add-on ---

/**
 * [관리자 전용] 회원 리스트를 불러와 테이블에 렌더링합니다.
 * (수정됨: 프로젝트명을 직접 입력하는 대신, DB의 tasks 테이블에서 프로젝트 목록을 가져와 선택하도록 변경)
 */
async function renderUserList() {
    const tableBody = document.getElementById('adminUserTableBody');
    if (!tableBody) return;

    try {
        // [1] 사용자 리스트와 프로젝트 목록을 동시에 가져옵니다 (병렬 처리)
        const [usersResult, projectsResult] = await Promise.all([
            window.app.supabase
                .from('profiles')
                .select('*')
                .order('display_name', { ascending: true }),
            window.app.supabase
                .from('tasks')
                .select('project_name') // 프로젝트 명만 가져옴
        ]);

        const users = usersResult.data;
        const projectData = projectsResult.data;

        if (usersResult.error) throw usersResult.error;
        if (projectsResult.error) throw projectsResult.error;

        // [2] 프로젝트 목록 중복 제거 및 정렬
        // (Set을 사용하여 중복을 없애고, 빈 이름은 제외한 뒤 가나다순 정렬)
        const uniqueProjects = [...new Set(projectData.map(item => item.project_name))]
            .filter(name => name && name.trim() !== '')
            .sort();

        // [3] 드롭다운(Select) 옵션 HTML 생성
        let projectOptions = '<option value="">프로젝트 선택</option>';
        if (uniqueProjects.length > 0) {
            projectOptions += uniqueProjects.map(name => `<option value="${name}">${name}</option>`).join('');
        } else {
            projectOptions += '<option value="" disabled>생성된 프로젝트 없음</option>';
        }

        if (!users || users.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">가입된 회원이 없습니다.</td></tr>';
            return;
        }

        // [4] 테이블 렌더링 (Input -> Select 로 변경)
        tableBody.innerHTML = users.map(user => `
            <tr>
                <td>${user.display_name || user.full_name || '이름 없음'}</td>
                <td>${user.email}</td>
                <td>
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <select id="proj-${user.id}" style="width:120px; padding:4px; border:1px solid #ccc; border-radius:4px;">
                            ${projectOptions}
                        </select>
                        
                        <button onclick="executeGrantPermission('${user.id}', 'read')" 
                                style="background-color: #00c875; border:none; color:white; padding:4px 8px; border-radius:4px; cursor:pointer;">읽기</button>
                        <button onclick="executeGrantPermission('${user.id}', 'write')" 
                                style="background-color: #0073ea; border:none; color:white; padding:4px 8px; border-radius:4px; cursor:pointer;">쓰기</button>
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        console.error('관리자 데이터 로드 실패:', err.message);
        tableBody.innerHTML = `<tr><td colspan="3" style="color:red; text-align:center;">로드 실패: ${err.message}</td></tr>`;
    }
}

/**
 * [관리자 전용] 특정 사용자에게 프로젝트 권한을 부여합니다.
 * (HTML이 Select로 바뀌어도 .value로 값을 가져오는 방식은 동일하므로 로직 수정 없음)
 */
async function executeGrantPermission(userId, type) {
    const projInput = document.getElementById(`proj-${userId}`);
    const projectName = projInput ? projInput.value.trim() : "";

    if (!projectName) {
        alert('권한을 부여할 프로젝트를 선택해주세요.');
        return;
    }

    try {
        const upsertData = {
            user_id: userId,
            project_name: projectName,
            is_approved: true, // 로그인 허용 여부
            can_read: true,    // '읽기'나 '쓰기' 모두 읽기는 가능
            can_write: (type === 'write')
        };

        // user_permissions 테이블에 데이터 저장 (upsert로 중복 방지)
        const { error } = await window.app.supabase
            .from('user_permissions')
            .upsert(upsertData, { onConflict: 'user_id, project_name' });

        if (error) throw error;

        alert(`[${projectName}] 프로젝트에 대한 ${type === 'write' ? '쓰기' : '읽기'} 권한을 부여했습니다.`);
    } catch (err) {
        console.error('권한 부여 에러:', err.message);
        alert('권한 부여 중 오류가 발생했습니다: ' + err.message);
    }
}
