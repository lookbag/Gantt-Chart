/**
 * Gantt Application Logic with Supabase Integration
 */

class GanttApp {
    constructor() {
        // Check if CONFIG is defined
        if (typeof CONFIG === 'undefined') {
            console.error('config.js file not found.');
            return;
        }

        // Initialize Supabase Client
        this.supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

        this.tasks = [];
        this.activeProject = localStorage.getItem('lastProject') || null;

        // Initial date setup: Start 7 days ago, end 4 months later
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
                    // Minimal reloading - you could check payload.new.user_id if needed
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

            // UI Update
            if (document.getElementById('activeProjectName')) {
                document.getElementById('activeProjectName').innerText = projectName;
            }
            document.getElementById('appTitle').innerText = projectName;

            // Permission Check & Write State
            this.canWrite = true; // Default for Admin
            if (!Auth.isAdmin) {
                const hasPermission = await this.checkPermission(Auth.user.id, projectName);
                this.canWrite = hasPermission;
                // Note: We don't block loading here anymore. Read-only is allowed.
            }

            // Render Members
            this.renderProjectMembers(projectName);

            const { data, error } = await this.supabase
                .from('tasks')
                .select('*')
                .ilike('project_name', projectName.trim())
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
        const trimmedName = projectName ? projectName.trim() : "";
        try {
            const { data, error } = await this.supabase
                .from('user_permissions')
                .select('*')
                .eq('user_id', userId)
                .ilike('project_name', trimmedName)
                .eq('is_approved', true)
                .maybeSingle();

            if (!data) {
                console.warn(`[Permission Denied] User: ${userId}, Project: ${trimmedName}`);
            } else {
                console.log(`[Permission Granted] User: ${userId}, Project: ${trimmedName}`);
            }

            return !!data;
        } catch (err) {
            console.error('[Permission Check Error]', err);
            return false;
        }
    }

    async syncTask(task) {
        if (!Auth.isLoggedIn) return;

        try {
            const projectName = document.getElementById('appTitle').innerText.trim();

            // Permission Check (Refined)
            if (!Auth.isAdmin) {
                const hasPermission = await this.checkPermission(Auth.user.id, projectName);
                if (!hasPermission) {
                    this.showAccessDeniedModal(projectName);
                    return;
                }
            }

            // Add project name and user ID to data
            const taskWithMeta = {
                ...task,
                project_name: projectName,
                user_id: Auth.user.id
            };

            // Clean upsert logic (includes description fallback)
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
            // Consider deleting subtasks or segments in the same row due to tree structure
            // Handle manually if cascade is not set in Supabase
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
            // 1. Fetch ALL distinct project names from the tasks table
            const { data: taskData, error: taskError } = await this.supabase
                .from('tasks')
                .select('project_name');

            if (taskError) throw taskError;

            // Generate unique project list (Case-insensitive unique)
            const uniqueProjects = [...new Set(taskData.map(item => item.project_name.trim()))].filter(Boolean).sort();

            // 2. Fetch current user's approved projects (Case-insensitive match)
            let approvedProjects = [];
            if (Auth.user) {
                const { data: permData } = await this.supabase
                    .from('user_permissions')
                    .select('project_name')
                    .eq('user_id', Auth.user.id)
                    .eq('is_approved', true);
                if (permData) approvedProjects = permData.map(p => p.project_name.trim().toLowerCase());
            }

            // 3. Admin bypass & Final call to populate dropdown
            if (Auth.isAdmin) {
                // Admin effectively has permission for everything that exists
                this.renderProjectDropdown(uniqueProjects, uniqueProjects.map(p => p.toLowerCase()));
            } else {
                this.renderProjectDropdown(uniqueProjects, approvedProjects);
            }
        } catch (err) {
            console.error('Project list fetch failed:', err.message);
        }
    }

    renderProjectDropdown(projects, approvedProjects) {
        const listContainer = document.getElementById('projectListItems');
        if (!listContainer) return;
        listContainer.innerHTML = '';

        if (projects.length === 0) {
            listContainer.innerHTML = '<li style="padding:10px; font-size:12px; color:#999;">No projects yet</li>';
            return;
        }

        projects.forEach(name => {
            // Check approved status case-insensitively
            const isApproved = approvedProjects.includes(name.toLowerCase());
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '4px 8px';
            li.className = this.activeProject === name ? 'active-project-item' : '';

            li.innerHTML = `
                <span class="project-name-link" style="flex-grow: 1; cursor: pointer; padding: 4px; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="${isApproved ? 'layout' : 'lock'}" style="width:14px; ${isApproved ? '' : 'color:#999;'}"></i> 
                    ${name}
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
        const name = prompt('Enter the name of the new project:');
        if (!name) return;

        try {
            // First task to initialize the project
            const initialTask = {
                project_name: name,
                label: 'Project Root',
                type: 'Project',
                start: new Date().toISOString().split('T')[0],
                end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                weekdays: 5,
                progress: 0,
                color: '#0073ea',
                user_id: Auth.user.id
            };

            const { error } = await this.supabase
                .from('tasks')
                .insert(initialTask);

            if (error) throw error;

            alert(`Project '${name}' created successfully.`);
            this.switchProject(name);
            this.fetchProjectList();
        } catch (err) {
            console.error('Project creation failed:', err.message);
            alert('Error creating project: ' + err.message);
        }
    }

    async deleteProject(projectName) {
        if (!Auth.isAdmin) {
            alert("Only administrators can delete projects.");
            return;
        }

        if (!confirm(`All data for project '${projectName}' will be permanently deleted. Continue?`)) {
            return;
        }

        try {
            const { error } = await this.supabase
                .from('tasks')
                .delete()
                .eq('project_name', projectName);

            if (error) throw error;

            alert(`Project '${projectName}' has been deleted.`);

            if (this.activeProject === projectName) {
                this.activeProject = null;
                localStorage.removeItem('lastProject');
                this.renderInitialState();
            }

            this.fetchProjectList();
        } catch (err) {
            console.error('Project deletion failed:', err.message);
            alert('An error occurred during deletion.');
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

        // Project list dropdown related
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

        // Dropdown on title click (when not editing)
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

        // Access Denied Modal Events
        const closeAccess = document.getElementById('closeAccessDenied');
        if (closeAccess) {
            closeAccess.onclick = (e) => {
                e.preventDefault();
                document.getElementById('accessDeniedModal').classList.add('hidden');
            };
        }
        const requestBtn = document.getElementById('requestAccessBtn');
        if (requestBtn) {
            requestBtn.onclick = () => this.requestAccess();
        }
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

    const projectName = document.getElementById('appTitle').innerText.trim();

    // Permission Check
    if(!Auth.isAdmin) {
        const hasPermission = await this.checkPermission(Auth.user.id, projectName);
        if (!hasPermission) {
            this.showAccessDeniedModal(projectName);
            return;
        }
    }

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
        user_id: Auth.user.id, // Include author ID
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
    alert('Failed to add task: ' + err.message);
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
    const projectName = document.getElementById('appTitle').innerText.trim();
    if (!Auth.isAdmin) {
        const hasPermission = await this.checkPermission(Auth.user.id, projectName);
        if (!hasPermission) {
            this.showAccessDeniedModal(projectName);
            return;
        }
    }

    const sid = String(id);
    const index = this.tasks.findIndex(t => String(t.id) === sid);
    if (index === -1) return;
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= this.tasks.length) return;

    const temp = this.tasks[index];
    this.tasks[index] = this.tasks[newIndex];
    this.tasks[newIndex] = temp;

    // In a production app, you would update a 'sort_order' column here.
    // For now, we update in-memory only for visual feedback.
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
    document.getElementById('editTaskState').value = task.state;
    document.getElementById('editTaskDescription').value = task.description || '';

    // [New] 컬러 팔레트 생성 함수 호출
    generateColorPalette(task.color);

    // [Permission Check] Hide editing actions if read-only
    const footerButtons = ['saveTask', 'deleteTask'];
    footerButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.style.display = this.canWrite ? 'block' : 'none';
        }
    });

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

// --- Access Denied & Request Logic ---

showAccessDeniedModal(projectName) {
    const modal = document.getElementById('accessDeniedModal');
    if (!modal) return;

    this.deniedProject = projectName;
    document.getElementById('accessDeniedMessage').innerHTML =
        `You do not have permission to view the <strong>${projectName}</strong> project.<br>Would you like to request access from the administrator?`;
    modal.classList.remove('hidden');
}

    async requestAccess() {
    if (!this.deniedProject || !Auth.user) return;

    const projectName = this.deniedProject;
    try {
        const { error } = await this.supabase
            .from('user_permissions')
            .upsert({
                user_id: Auth.user.id,
                project_name: projectName,
                is_approved: false
            }, { onConflict: 'user_id, project_name' });

        if (error) throw error;

        // Trigger mailto
        const subject = encodeURIComponent(`Requesting Access for ${projectName}`);
        const body = encodeURIComponent(`User ${Auth.user.email} is requesting access to project [${projectName}].\nPlease approve in the admin panel.`);
        window.location.href = `mailto:csyoon@kbautosys.com?subject=${subject}&body=${body}`;

        alert('Access request has been sent to the administrator.');
        document.getElementById('accessDeniedModal').classList.add('hidden');
    } catch (err) {
        console.error('Request Access Error:', err.message);
        alert('Failed to send request: ' + err.message);
    }
}

    // --- Project Members UI ---

    async renderProjectMembers(projectName) {
    const trimmedName = projectName ? projectName.trim() : "";
    const container = document.getElementById('projectMembers');
    if (!container) return;
    container.innerHTML = '';

    try {
        // 1. Get approved user IDs for this project (Case-insensitive)
        const { data: perms, error: permError } = await this.supabase
            .from('user_permissions')
            .select('user_id')
            .ilike('project_name', trimmedName)
            .eq('is_approved', true);

        if (permError) throw permError;
        if (!perms || perms.length === 0) return;

        const userIds = perms.map(p => p.user_id);

        // 2. Get profile names for these IDs
        const { data: profiles, error: profError } = await this.supabase
            .from('profiles')
            .select('id, display_name, full_name, email')
            .in('id', userIds);

        if (profError) throw profError;

        // 3. Render Avatars with fallback for missing profiles
        userIds.forEach(uid => {
            const profile = profiles ? profiles.find(p => p.id === uid) : null;
            let name = "User";
            let initials = "US";

            if (profile) {
                name = profile.display_name || profile.full_name || profile.email || "User";
                if (profile.display_name || profile.full_name) {
                    initials = (profile.display_name || profile.full_name).charAt(0).toUpperCase();
                } else if (profile.email) {
                    initials = profile.email.substring(0, 2).toUpperCase();
                } else {
                    initials = name.charAt(0).toUpperCase();
                }
            }

            const avatar = document.createElement('div');
            avatar.className = 'member-avatar';
            avatar.innerText = initials;
            avatar.title = profile ? `${name} (${profile.email || 'No email'})` : `Member ID: ${uid}`;
            container.appendChild(avatar);
        });
    } catch (err) {
        console.error('Error rendering members:', err.message);
    }
}
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new GanttApp();
});

// --- Member Management Add-on ---

/**
 * [Admin Only] Render User List with Wider Layout & Single Action Button
 */
async function renderUserList() {
    const tableBody = document.getElementById('adminUserTableBody');
    if (!tableBody) return;

    try {
        const [usersResult, projectsResult] = await Promise.all([
            window.app.supabase
                .from('profiles')
                .select('*')
                .order('display_name', { ascending: true }),
            window.app.supabase
                .from('tasks')
                .select('project_name')
        ]);

        const users = usersResult.data;
        const projectData = projectsResult.data;

        if (usersResult.error) throw usersResult.error;
        if (projectsResult.error) throw projectsResult.error;

        const uniqueProjects = [...new Set(projectData.map(item => item.project_name))]
            .filter(name => name && name.trim() !== '')
            .sort();

        // [English] Dropdown Options
        let projectOptions = '<option value="">Select Project</option>';
        if (uniqueProjects.length > 0) {
            projectOptions += uniqueProjects.map(name => `<option value="${name}">${name}</option>`).join('');
        } else {
            projectOptions += '<option value="" disabled>No projects available</option>';
        }

        if (!users || users.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 30px; color: #666;">No registered members found.</td></tr>';
            return;
        }

        // [Design Update]
        // 1. Single Button: "Grant Access" (Grants both Read & Write)
        // 2. Padding: Optimized for 900px width
        tableBody.innerHTML = users.map(user => `
            <tr style="border-bottom: 1px solid #f0f0f0;">
                <td style="padding: 16px 24px; vertical-align: middle;">
                    <span style="font-weight: 600; font-size: 14px; color: #333;">${user.display_name || user.full_name || 'No Name'}</span>
                </td>
                <td style="padding: 16px 24px; vertical-align: middle; color: #666; font-size: 13px;">
                    ${user.email}
                </td>
                <td style="padding: 16px 24px; vertical-align: middle;">
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <select id="proj-${user.id}" 
                                style="flex: 1; padding: 0 12px; border: 1px solid #e0e2e7; border-radius: 4px; height: 38px; background-color: #fff; cursor: pointer; font-size: 13px;">
                            ${projectOptions}
                        </select>
                        
                        <button onclick="executeGrantPermission('${user.id}')" class="grant-btn">
                            Grant
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        console.error('Failed to load admin data:', err.message);
        tableBody.innerHTML = `<tr><td colspan="3" style="color:#e2445c; text-align:center; padding: 20px;">Load Failed: ${err.message}</td></tr>`;
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
 * Generate a 7-color palette and bind click events
 */
function generateColorPalette(selectedColor) {
    const container = document.getElementById('colorPalette');
    const hiddenInput = document.getElementById('editTaskColorValue');

    if (!container || !hiddenInput) return;

    container.innerHTML = ''; // Reset

    // Default to blue (#0073EA) if color is missing or invalid
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

        // Color click event
        swatch.onclick = () => {
            // Deselect all and select the current one
            document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
            swatch.classList.add('selected');
            hiddenInput.value = color; // Store value in hidden input
        };

        container.appendChild(swatch);
    });
}
