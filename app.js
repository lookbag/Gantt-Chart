/**
 * Gantt Application Logic with Supabase Integration
 * Fixed: Save/Cancel buttons, Safe DOM access
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
        this.clipboard = null;

        // 초기 날짜 설정
        const today = new Date();
        this.viewStart = new Date(today);
        this.viewStart.setDate(today.getDate() - 7);

        this.viewEnd = new Date(this.viewStart);
        this.viewEnd.setMonth(this.viewStart.getMonth() + 4);
        this.pxPerDay = 30;
        this.editingTaskId = null;
        this.searchQuery = '';
        this.currentLogData = [];

        window.app = this;
        this.init();
    }

    async init() {
        this.bindEvents();
        this.setupRealtime();

        if (Auth.isLoggedIn) {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = '';
                this.searchQuery = '';
            }

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
                () => this.loadTasks()
            )
            .subscribe();
    }

    // --- Data Loading ---

    async loadTasks() {
        if (!Auth.isLoggedIn) return;

        try {
            const projectName = this.activeProject;
            if (!projectName) {
                this.renderInitialState();
                return;
            }

            if (document.getElementById('activeProjectName')) {
                document.getElementById('activeProjectName').innerText = projectName;
            }
            document.getElementById('appTitle').innerText = projectName;

            this.renderProjectMemberIcons(projectName);
            await this.fetchProjectMembers(projectName);

            if (!Auth.isAdmin) {
                const hasPermission = await this.checkPermission(Auth.user.id, projectName);
                if (!hasPermission) {
                    if (confirm(`'${projectName}' 프로젝트에 접근 권한이 없습니다.\n관리자에게 권한 요청 메일을 보내시겠습니까?`)) {
                        const subject = `[Gantt] 권한 요청: ${projectName}`;
                        const body = `프로젝트명: ${projectName}\n요청자: ${Auth.user.email}`;
                        window.location.href = `mailto:csyoon@kbautosys.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                    }
                    this.tasks = [];
                    this.renderAll();
                    return;
                }
            }

            const { data, error } = await this.supabase
                .from('tasks')
                .select('*')
                .eq('project_name', projectName)
                .order('sort_order', { ascending: true });

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
            body.innerHTML = '';
        }
    }

    // --- Permissions & Members ---

    async checkPermission(userId, projectName) {
        try {
            const { data } = await this.supabase
                .from('user_permissions')
                .select('*')
                .eq('user_id', userId)
                .eq('project_name', projectName)
                .eq('is_approved', true)
                .single();
            return !!data;
        } catch (err) { return false; }
    }

    async fetchProjectMembers(projectName) {
        try {
            const { data: perms } = await this.supabase.from('user_permissions').select('user_id').eq('project_name', projectName).eq('is_approved', true);
            if (!perms || perms.length === 0) {
                this.currentProjectMembers = [];
                return;
            }
            const userIds = perms.map(p => p.user_id);
            const { data: profiles } = await this.supabase.from('profiles').select('id, display_name, email').in('id', userIds);
            this.currentProjectMembers = profiles || [];
        } catch (e) {
            this.currentProjectMembers = [];
        }
    }

    async renderProjectMemberIcons(projectName) {
        const container = document.getElementById('projectMemberContainer');
        if (!container) return;
        container.innerHTML = '';

        try {
            const { data: perms } = await this.supabase.from('user_permissions').select('user_id').eq('project_name', projectName).eq('is_approved', true);
            if (!perms || perms.length === 0) return;
            const userIds = perms.map(p => p.user_id);
            const { data: profiles } = await this.supabase.from('profiles').select('display_name, email').in('id', userIds);
            if (!profiles) return;

            profiles.forEach(user => {
                const name = user.display_name || user.email;
                const initial = name.charAt(0).toUpperCase();
                const badge = document.createElement('div');
                badge.className = 'project-member-icon';
                badge.innerText = initial;
                badge.title = name;
                Object.assign(badge.style, {
                    width: '24px', height: '24px', borderRadius: '50%',
                    backgroundColor: '#FF7575', color: 'white', fontSize: '12px',
                    fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginLeft: '-8px', cursor: 'help', border: '2px solid white'
                });
                container.appendChild(badge);
            });
            if (container.firstChild) container.firstChild.style.marginLeft = '0';
        } catch (e) { console.error(e); }
    }

    // --- CRUD Operations ---

    async syncTask(task) {
        if (!Auth.isLoggedIn) return;
        try {
            const projectName = document.getElementById('appTitle').innerText.trim();
            const taskWithMeta = { ...task, project_name: projectName, user_id: Auth.user.id };

            const { error } = await this.supabase.from('tasks').upsert(taskWithMeta);
            if (error && error.message.includes('description')) {
                delete taskWithMeta.description;
                await this.supabase.from('tasks').upsert(taskWithMeta);
            }
        } catch (err) { console.error('Sync Error:', err); }
    }

    async deleteFromSupabase(id) {
        await this.supabase.from('tasks').delete().or(`id.eq.${id},parentId.eq.${id},rowTaskId.eq.${id}`);
    }

    // --- Helper Functions ---

    isWeekend(date) { const day = date.getDay(); return day === 0 || day === 6; }

    calculateEndDate(startDate, weekdays) {
        let date = new Date(startDate);
        let count = 0;
        while (count < weekdays) {
            date.setDate(date.getDate() + 1);
            if (!this.isWeekend(date)) count++;
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
            if (!this.isWeekend(cur)) count++;
        }
        return count;
    }

    formatDate(date) { return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`; }

    updateDateDisplay() {
        document.getElementById('viewStartDateText').innerText = this.formatDate(this.viewStart);
        document.getElementById('viewEndDateText').innerText = this.formatDate(this.viewEnd);
    }

    // --- Events & Interaction ---

    bindEvents() {
        // 검색창
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.renderAll();
        });

        // 줌 & 날짜 이동
        document.getElementById('zoomIn').onclick = () => { this.pxPerDay = Math.min(100, this.pxPerDay + 5); this.renderAll(); };
        document.getElementById('zoomOut').onclick = () => { this.pxPerDay = Math.max(5, this.pxPerDay - 5); this.renderAll(); };
        document.getElementById('prevStart').onclick = () => this.shiftView('start', -7);
        document.getElementById('nextStart').onclick = () => this.shiftView('start', 7);
        document.getElementById('prevEnd').onclick = () => this.shiftView('end', -7);
        document.getElementById('nextEnd').onclick = () => this.shiftView('end', 7);

        // 태스크 및 프로젝트 추가
        document.getElementById('globalAddTask').onclick = () => this.addNewTask(null);
        document.getElementById('headerNewProjectBtn').onclick = () => this.createNewProject();

        // 프로젝트 드롭다운
        const projectBtn = document.getElementById('showProjectList');
        const projectDropdown = document.getElementById('projectDropdown');
        projectBtn.onclick = (e) => {
            e.stopPropagation();
            projectDropdown.classList.toggle('hidden');
            if (!projectDropdown.classList.contains('hidden')) this.fetchProjectList();
        };

        // [수정] 모달 버튼 이벤트 (상단 X 버튼 + 하단 Cancel 버튼 모두 연결)
        const cancelBtnHeader = document.getElementById('cancelEdit');
        if (cancelBtnHeader) cancelBtnHeader.onclick = () => this.closeEditModal();

        const cancelBtnFooter = document.getElementById('cancelEditBtn');
        if (cancelBtnFooter) cancelBtnFooter.onclick = () => this.closeEditModal();

        const saveBtn = document.getElementById('saveTask');
        if (saveBtn) saveBtn.onclick = () => this.saveTask();

        const deleteBtn = document.getElementById('deleteTask');
        if (deleteBtn) deleteBtn.onclick = () => { this.deleteTask(this.editingTaskId); this.closeEditModal(); };

        // [로그 추가 버튼]
        const addLogBtn = document.getElementById('addLogBtn');
        if (addLogBtn) addLogBtn.onclick = () => this.addLogEntry();

        const newLogText = document.getElementById('newLogText');
        if (newLogText) newLogText.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.addLogEntry(); });

        // 컨텍스트 메뉴
        document.getElementById('contextMenu').addEventListener('click', (e) => {
            const action = e.target.closest('li')?.dataset.action;
            if (!action || e.target.closest('li').classList.contains('disabled')) return;
            const taskId = document.getElementById('contextMenu').dataset.taskId;
            this.handleMenuAction(action, taskId);
            this.hideContextMenu();
        });

        // 전역 클릭 (메뉴 닫기)
        window.addEventListener('click', (e) => {
            if (document.getElementById('projectDropdown')) document.getElementById('projectDropdown').classList.add('hidden');
            if (!document.getElementById('contextMenu').contains(e.target)) this.hideContextMenu();
        });

        // 날짜 자동 계산
        const startInput = document.getElementById('editTaskStart');
        const weekdayInput = document.getElementById('editTaskWeekdays');
        const endInput = document.getElementById('editTaskEnd');
        if (startInput && weekdayInput && endInput) {
            startInput.onchange = () => { if (weekdayInput.value) endInput.value = this.calculateEndDate(startInput.value, parseInt(weekdayInput.value)); };
            weekdayInput.oninput = () => { if (startInput.value) endInput.value = this.calculateEndDate(startInput.value, parseInt(weekdayInput.value)); };
            endInput.onchange = () => { if (startInput.value) weekdayInput.value = this.calculateWeekdays(startInput.value, endInput.value); };
        }

        // 진행률 표시
        const progInput = document.getElementById('editTaskProgress');
        if (progInput) progInput.oninput = (e) => document.getElementById('progressValue').innerText = `${e.target.value}%`;

        // 더블 클릭 이벤트
        document.getElementById('treeGrid').addEventListener('dblclick', (e) => {
            const row = e.target.closest('.tree-row');
            if (row) this.openEditModal(row.dataset.id);
        });
        document.getElementById('ganttBody').addEventListener('dblclick', (e) => {
            const bar = e.target.closest('.gantt-bar');
            if (bar) this.openEditModal(bar.dataset.id);
        });

        // 스크롤 동기화
        this.bindScrollSync();
    }

    // --- Modal Logic (Fix Applied) ---

    openEditModal(taskId) {
        const task = this.tasks.find(t => String(t.id) === String(taskId));
        if (!task) return;

        this.editingTaskId = taskId;

        // 안전하게 값 채우기 Helper
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        setVal('editTaskLabel', task.label);
        setVal('editTaskStart', task.start);
        setVal('editTaskEnd', task.end);
        setVal('editTaskWeekdays', task.weekdays);
        setVal('editTaskProgress', task.progress);
        setVal('editTaskType', task.type);
        setVal('editTaskState', task.state);

        const progBadge = document.getElementById('progressValue');
        if (progBadge) progBadge.innerText = `${task.progress}%`;

        // 로그 렌더링
        this.renderDescriptionLog(task.description || '');

        // 날짜 기본값
        const logDate = document.getElementById('newLogDate');
        if (logDate) logDate.value = new Date().toISOString().split('T')[0];

        generateColorPalette(task.color);
        document.getElementById('editModal').classList.remove('hidden');
    }

    closeEditModal() {
        const modal = document.getElementById('editModal');
        if (modal) modal.classList.add('hidden');
        this.editingTaskId = null;
    }

    // [수정] 안전한 저장 함수 (Save Button Fix)
    async saveTask() {
        if (!this.editingTaskId) return;

        try {
            const task = this.tasks.find(t => String(t.id) === String(this.editingTaskId));
            if (!task) throw new Error("Task not found");

            // 안전한 값 읽기 Helper (요소가 없으면 null 반환하여 에러 방지)
            const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : null; };

            const label = getVal('editTaskLabel'); if (label !== null) task.label = label;
            const start = getVal('editTaskStart'); if (start !== null) task.start = start;
            const end = getVal('editTaskEnd'); if (end !== null) task.end = end;
            const weekdays = getVal('editTaskWeekdays'); if (weekdays !== null) task.weekdays = parseInt(weekdays) || 0;
            const progress = getVal('editTaskProgress'); if (progress !== null) task.progress = parseInt(progress) || 0;
            const type = getVal('editTaskType'); if (type !== null) task.type = type;
            const state = getVal('editTaskState'); if (state !== null) task.state = state;

            // Description은 renderDescriptionLog에서 hidden input에 업데이트됨
            const desc = getVal('editTaskDescription'); if (desc !== null) task.description = desc;

            const selectedColor = getVal('editTaskColorValue');
            if (selectedColor) task.color = selectedColor;

            await this.syncTask(task);
            this.renderAll();

            // [중요] 성공 시 모달 닫기
            this.closeEditModal();
        } catch (e) {
            console.error("Save failed:", e);
            alert("저장 중 오류가 발생했습니다: " + e.message);
        }
    }

    // --- Description Log Logic ---

    renderDescriptionLog(jsonString) {
        const historyContainer = document.getElementById('logHistory');
        const hiddenInput = document.getElementById('editTaskDescription');
        if (!historyContainer || !hiddenInput) return;

        this.currentLogData = [];

        try {
            if (jsonString && jsonString.trim().startsWith('[')) {
                this.currentLogData = JSON.parse(jsonString);
            } else if (jsonString && jsonString.trim() !== '') {
                this.currentLogData.push({
                    date: new Date().toISOString().split('T')[0],
                    text: jsonString,
                    user: 'Legacy'
                });
            }
        } catch (e) {
            this.currentLogData = [];
        }

        historyContainer.innerHTML = '';
        if (this.currentLogData.length === 0) {
            historyContainer.innerHTML = '<div style="text-align:center; color:#ccc; padding:20px;">No updates yet.</div>';
        } else {
            this.currentLogData.forEach(item => {
                const div = document.createElement('div');
                div.className = 'log-item';
                div.innerHTML = `
                    <div class="log-meta">
                        <span>${item.date}</span>
                        <span>${item.user || ''}</span>
                    </div>
                    <div class="log-content">${item.text}</div>
                `;
                historyContainer.appendChild(div);
            });
            historyContainer.scrollTop = historyContainer.scrollHeight;
        }
        hiddenInput.value = JSON.stringify(this.currentLogData);
    }

    addLogEntry() {
        const dateInput = document.getElementById('newLogDate');
        const textInput = document.getElementById('newLogText');

        if (!dateInput.value || !textInput.value.trim()) {
            alert("날짜와 내용을 입력해주세요.");
            return;
        }

        const userName = Auth.user?.user_metadata?.full_name || Auth.user?.email?.split('@')[0] || 'User';
        const newEntry = {
            date: dateInput.value,
            text: textInput.value.trim(),
            user: userName
        };

        this.currentLogData.push(newEntry);
        this.renderDescriptionLog(JSON.stringify(this.currentLogData));
        textInput.value = '';
    }

    // --- Rendering Main Views ---

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

        // D-Day 계산
        const getRemainingDays = (end) => {
            if (!end) return '-';
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const endDate = new Date(end);
            endDate.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) return `D+${Math.abs(diffDays)}`;
            if (diffDays === 0) return `D-Day`;
            return `D-${diffDays}`;
        };

        const members = this.currentProjectMembers || [];
        const createOwnerSelect = (taskId, currentUserId) => {
            let options = `<option value="">-</option>`;
            members.forEach(m => {
                const selected = String(m.id) === String(currentUserId) ? 'selected' : '';
                options += `<option value="${m.id}" ${selected}>${m.display_name || m.email.split('@')[0]}</option>`;
            });
            return `<select class="owner-select" onchange="app.updateTaskOwner('${taskId}', this.value)" onclick="event.stopPropagation()">${options}</select>`;
        };

        const renderItem = (task, depth = 0) => {
            if (task.rowTaskId) return;
            const matches = task.label.toLowerCase().includes(filter);
            const hasVisibleChild = this.tasks.some(t => t.parentId === task.id && (t.label.toLowerCase().includes(filter) || filter === ''));
            if (filter !== '' && !matches && !hasVisibleChild) return;

            const row = document.createElement('div');
            row.className = `tree-row ${!task.parentId ? 'project-row' : ''}`;
            row.dataset.id = task.id;
            const hasChildren = this.tasks.some(t => t.parentId === task.id);

            const dDay = getRemainingDays(task.end);
            let dDayColor = '#333';
            if (dDay.startsWith('D+')) dDayColor = '#e2445c';
            else if (dDay === 'D-Day') dDayColor = '#fdab3d';

            row.innerHTML = `
                <div class="tree-cell name-cell" style="padding-left: ${depth * 20 + 8}px;">
                    <span class="tree-expander">${hasChildren ? `<i data-lucide="${task.expanded ? 'chevron-down' : 'chevron-right'}"></i>` : ''}</span>
                    <span class="tree-label-text">${task.label}</span>
                    <button class="icon-btn more-btn" style="margin-left:auto; opacity:0;"><i data-lucide="more-vertical" style="width:14px;"></i></button>
                </div>
                <div class="tree-cell">${createOwnerSelect(task.id, task.user_id)}</div>
                <div class="tree-cell">${task.start ? task.start.substring(5).replace('-', '/') : '-'}</div>
                <div class="tree-cell">${task.end ? task.end.substring(5).replace('-', '/') : '-'}</div>
                <div class="tree-cell" style="color: ${dDayColor}; font-weight:700;">${dDay}</div>
                <div class="tree-cell" style="flex-direction:column; justify-content:center; align-items: flex-start;">
                    <span style="font-size:10px;">${task.progress}%</span>
                    <div class="cell-progress-bar"><div class="cell-progress-value" style="width: ${task.progress}%;"></div></div>
                </div>
            `;
            container.appendChild(row);
            row.addEventListener('mouseenter', () => { const b = row.querySelector('.more-btn'); if (b) b.style.opacity = '1'; });
            row.addEventListener('mouseleave', () => { const b = row.querySelector('.more-btn'); if (b) b.style.opacity = '0'; });

            if (task.expanded || filter !== '') {
                this.tasks.filter(t => t.parentId === task.id).forEach(c => renderItem(c, depth + 1));
            }
        };
        this.tasks.filter(t => t.parentId === null).forEach(t => renderItem(t));
        lucide.createIcons();
    }

    renderGanttTimeline() {
        const header = document.getElementById('ganttHeader');
        header.innerHTML = '';
        const monthRow = document.createElement('div'); monthRow.className = 'gantt-header-months';
        const weekRow = document.createElement('div'); weekRow.className = 'gantt-header-weeks';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        let cur = new Date(this.viewStart); cur.setDate(1);
        const adjustedEnd = new Date(this.viewEnd); adjustedEnd.setMonth(adjustedEnd.getMonth() + 1); adjustedEnd.setDate(0);

        while (cur <= adjustedEnd) {
            const width = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate() * this.pxPerDay;
            const cell = document.createElement('div');
            cell.className = 'month-cell'; cell.style.width = `${width}px`; cell.style.flexShrink = '0';
            cell.innerText = `${months[cur.getMonth()]} ${cur.getFullYear()}`;
            monthRow.appendChild(cell);
            cur.setMonth(cur.getMonth() + 1);
        }

        let weekStart = new Date(this.viewStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        let weekCur = new Date(weekStart);
        const loopEnd = new Date(adjustedEnd); loopEnd.setDate(loopEnd.getDate() + 7);

        while (weekCur <= loopEnd) {
            const width = 7 * this.pxPerDay;
            const d = new Date(weekCur); d.setDate(d.getDate() + 4 - (d.getDay() || 7));
            const yearStart = new Date(d.getFullYear(), 0, 1);
            const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            const cell = document.createElement('div');
            cell.className = 'week-cell'; cell.style.width = `${width}px`; cell.style.flexShrink = '0';
            cell.innerText = `W${weekNo}`;
            weekRow.appendChild(cell);
            weekCur.setDate(weekCur.getDate() + 7);
        }
        header.appendChild(monthRow); header.appendChild(weekRow);

        const body = document.getElementById('ganttBody');
        if (body) {
            const px = 7 * this.pxPerDay;
            body.style.backgroundSize = `${px}px 100%`;
            body.style.backgroundImage = `linear-gradient(to right, transparent ${px - 1}px, #f0f0f0 ${px}px)`;
        }
    }

    bindScrollSync() {
        const tree = document.getElementById('treeGrid');
        const ganttBody = document.getElementById('ganttBody');
        const ganttHeader = document.getElementById('ganttHeader');
        if (!tree || !ganttBody || !ganttHeader) return;

        ganttBody.addEventListener('scroll', () => {
            tree.scrollTop = ganttBody.scrollTop;
            ganttHeader.scrollLeft = ganttBody.scrollLeft;
        });
        tree.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                ganttBody.scrollTop += e.deltaY;
            }
        }, { passive: false });
    }

    // --- Other Interaction ---

    handleMenuAction(action, taskId) {
        switch (action) {
            case 'edit': this.openEditModal(taskId); break;
            case 'newChild': this.addNewTask(taskId); break;
            case 'newSameRow': this.addNewTask(null, taskId); break;
            case 'delete': this.deleteTask(taskId); break;
            case 'moveUp': this.moveTask(taskId, -1); break;
            case 'moveDown': this.moveTask(taskId, 1); break;
            case 'copy': this.copyTask(taskId); break;
            case 'paste': this.pasteTask(taskId); break;
        }
    }

    async addNewTask(parentId = null, rowTaskId = null) {
        const projectName = document.getElementById('appTitle').innerText.trim();
        let labelName = "New Task";
        if (!parentId && !rowTaskId) {
            const input = prompt("Enter Main Task Name:");
            if (!input || input.trim() === "") return;
            labelName = input.trim();
        } else { labelName = rowTaskId ? 'Sub item' : 'Child item'; }

        const newTask = {
            label: labelName, start: new Date().toISOString().split('T')[0],
            end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            progress: 0, color: '#0084d1', type: 'Task', expanded: true,
            parentId: parentId, rowTaskId: rowTaskId, weekdays: 5, state: 'none',
            project_name: projectName, user_id: Auth.user.id, description: ''
        };
        try {
            const { data, error } = await this.supabase.from('tasks').insert([newTask]).select();
            if (error) throw error;
            this.tasks.push(data[0]);
            this.renderAll();
            if (parentId || rowTaskId) setTimeout(() => this.openEditModal(data[0].id), 50);
        } catch (err) { console.error(err); }
    }

    async deleteTask(id) {
        if (!confirm("삭제하시겠습니까?")) return;
        await this.deleteFromSupabase(id);
        this.tasks = this.tasks.filter(t => t.id !== id && t.parentId !== id);
        this.renderAll();
    }

    async moveTask(id, dir) {
        const task = this.tasks.find(t => String(t.id) === String(id));
        if (!task) return;
        const siblings = this.tasks.filter(t => t.parentId === task.parentId && t.rowTaskId === task.rowTaskId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const idx = siblings.findIndex(t => String(t.id) === String(id));
        if (idx === -1 || idx + dir < 0 || idx + dir >= siblings.length) return;

        const target = siblings[idx + dir];
        const temp = task.sort_order || idx;
        task.sort_order = target.sort_order || (idx + dir);
        target.sort_order = temp;

        this.tasks.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        this.renderAll();

        try {
            await this.supabase.from('tasks').upsert([
                { id: task.id, sort_order: task.sort_order },
                { id: target.id, sort_order: target.sort_order }
            ]);
        } catch (e) { console.error(e); }
    }

    copyTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        const tasksToCopy = [];
        const findDescendants = (pid) => {
            const children = this.tasks.filter(t => t.parentId === pid);
            children.forEach(c => { tasksToCopy.push(c); findDescendants(c.id); });
        };
        tasksToCopy.push(task);
        findDescendants(taskId);
        this.clipboard = JSON.parse(JSON.stringify(tasksToCopy));
        alert(`${tasksToCopy.length}개 항목 복사됨`);
    }

    async pasteTask(targetPid) {
        if (!this.clipboard) return alert("Empty Clipboard");
        const projectName = document.getElementById('appTitle').innerText.trim();
        const idMap = {};
        const newTasks = this.clipboard.map(t => ({ ...t, oldId: t.id }));

        try {
            const root = newTasks[0];
            const rootData = { ...root, id: undefined, oldId: undefined, parentId: targetPid, project_name: projectName, user_id: Auth.user.id, label: root.label + " (Copy)" };
            const { data, error } = await this.supabase.from('tasks').insert([rootData]).select();
            if (error) throw error;
            idMap[root.oldId] = data[0].id;

            const others = newTasks.slice(1);
            for (const item of others) {
                const newPid = idMap[item.parentId];
                if (!newPid) continue;
                const iData = { ...item, id: undefined, oldId: undefined, parentId: newPid, project_name: projectName, user_id: Auth.user.id };
                const { data: d } = await this.supabase.from('tasks').insert([iData]).select();
                if (d) idMap[item.oldId] = d[0].id;
            }
            await this.loadTasks();
            alert("Paste Completed");
        } catch (e) { console.error(e); alert("Paste Failed"); }
    }

    shiftView(type, days) {
        if (type === 'start') this.viewStart.setDate(this.viewStart.getDate() + days);
        else this.viewEnd.setDate(this.viewEnd.getDate() + days);
        this.renderAll();
    }

    showContextMenu(e, taskId) {
        const menu = document.getElementById('contextMenu');
        menu.classList.remove('hidden');
        menu.style.left = `${e.clientX}px`; menu.style.top = `${e.clientY}px`;
        menu.dataset.taskId = taskId;
    }
    hideContextMenu() { document.getElementById('contextMenu').classList.add('hidden'); }

    // Project Management
    async fetchProjectList() {
        try {
            const { data, error } = await this.supabase.from('tasks').select('project_name');
            if (error) throw error;
            const projects = [...new Set(data.map(i => i.project_name))].filter(Boolean).sort();
            this.renderProjectDropdown(projects);
        } catch (e) { console.error(e); }
    }

    renderProjectDropdown(projects) {
        const list = document.getElementById('projectListItems');
        if (!list) return;
        list.innerHTML = '';
        projects.forEach(name => {
            const li = document.createElement('li');
            li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.padding = '4px 8px';
            li.innerHTML = `<span style="cursor:pointer; flex-grow:1;">${name}</span>`;
            li.querySelector('span').onclick = () => {
                this.activeProject = name;
                localStorage.setItem('lastProject', name);
                document.getElementById('projectDropdown').classList.add('hidden');
                this.loadTasks();
            };
            list.appendChild(li);
        });
    }
    async createNewProject() {
        const name = prompt('새 프로젝트 이름:');
        if (!name) return;
        const task = {
            label: 'New Task', start: new Date().toISOString().split('T')[0], end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            progress: 0, color: '#0073ea', type: 'Task', expanded: true, parentId: null, weekdays: 5, state: 'none',
            project_name: name, user_id: Auth.user.id, description: ''
        };
        try {
            await this.supabase.from('tasks').insert([task]);
            this.activeProject = name;
            localStorage.setItem('lastProject', name);
            this.loadTasks();
        } catch (e) { alert(e.message); }
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new GanttApp(); });

// Admin / List Logic
async function renderUserList() {
    const tableBody = document.getElementById('adminUserTableBody');
    if (!tableBody) return;
    try {
        const [usersResult, projectsResult, permissionsResult] = await Promise.all([
            window.app.supabase.from('profiles').select('*').order('display_name', { ascending: true }),
            window.app.supabase.from('tasks').select('project_name'),
            window.app.supabase.from('user_permissions').select('*')
        ]);
        const users = usersResult.data || [];
        const projectData = projectsResult.data || [];
        const permissions = permissionsResult.data || [];
        const uniqueProjects = [...new Set(projectData.map(item => item.project_name))].filter(Boolean).sort();
        let projectOptions = '<option value="">Select Project</option>';
        uniqueProjects.forEach(name => { projectOptions += `<option value="${name}">${name}</option>`; });

        if (users.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 30px;">No members found.</td></tr>';
            return;
        }
        tableBody.innerHTML = users.map(user => {
            const userPerms = permissions.filter(p => p.user_id === user.id);
            const permBadges = userPerms.map(p => `
                <span style="display: inline-flex; align-items: center; gap: 4px; background: #e1f2ff; color: #0073ea; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-right: 4px;">
                    ${p.project_name} <i data-lucide="x" style="width:12px; height:12px; cursor:pointer;" onclick="Auth.revokePermission('${p.id}')"></i>
                </span>`).join('');
            return `
            <tr style="border-bottom: 1px solid #f0f0f0;">
                <td style="padding: 12px 24px;">
                    <div style="font-weight: 600;">${user.display_name || user.full_name || 'No Name'}</div>
                    <div style="font-size: 12px; color: #666;">${user.email}</div>
                </td>
                <td style="padding: 12px 24px;">${permBadges || '<span style="color:#999; font-size:12px;">No permissions</span>'}</td>
                <td style="padding: 12px 24px;">
                    <div style="display: flex; gap: 8px;">
                        <select id="proj-${user.id}" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">${projectOptions}</select>
                        <button onclick="executeGrantPermission('${user.id}')" class="grant-btn">Grant</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
        lucide.createIcons();
    } catch (err) { console.error('Failed to load admin data:', err.message); }
}

async function executeGrantPermission(userId) {
    const projInput = document.getElementById(`proj-${userId}`);
    const projectName = projInput ? projInput.value.trim() : "";
    if (!projectName) { alert('Please select a project first.'); return; }
    try {
        const upsertData = { user_id: userId, project_name: projectName, is_approved: true, can_read: true, can_write: true };
        const { error } = await window.app.supabase.from('user_permissions').upsert(upsertData, { onConflict: 'user_id, project_name' });
        if (error) throw error;
        alert(`Successfully granted access to project: [${projectName}]`);
        renderUserList();
    } catch (err) { alert('Error granting permission: ' + err.message); }
}

// Color Palette
const MONDAY_COLORS = ['#E2445C', '#FF9F00', '#FFCB00', '#00C875', '#0073EA', '#579BFC', '#A25DDC'];
function generateColorPalette(selectedColor) {
    const container = document.getElementById('colorPalette');
    const hiddenInput = document.getElementById('editTaskColorValue');
    if (!container || !hiddenInput) return;
    container.innerHTML = '';
    if (!selectedColor || !MONDAY_COLORS.includes(selectedColor)) selectedColor = '#0073EA';
    hiddenInput.value = selectedColor;
    MONDAY_COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        if (color === selectedColor) swatch.classList.add('selected');
        swatch.onclick = () => {
            document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
            swatch.classList.add('selected');
            hiddenInput.value = color;
        };
        container.appendChild(swatch);
    });
}
