/**
 * Gantt Application Logic
 */

class GanttApp {
    constructor() {
        this.tasks = [
            { id: '1', label: 'P833', start: '2026-01-25', end: '2026-04-10', progress: 0, color: '#0084d1', type: 'Project', expanded: true, parentId: null, weekdays: 55, state: 'none' },
            { id: '2', label: 'Subtask of P833', start: '2026-01-25', end: '2026-02-06', progress: 0, color: '#0084d1', type: 'Task', expanded: true, parentId: '1', weekdays: 10, state: 'none' },
            { id: '3', label: 'Rivian R2', start: '2026-01-25', end: '2026-04-10', progress: 0, color: '#c63927', type: 'Project', expanded: true, parentId: null, weekdays: 55, state: 'none' },
            { id: '4', label: 'Subtask of Rivian R2', start: '2026-01-25', end: '2026-02-06', progress: 0, color: '#c63927', type: 'Task', expanded: true, parentId: '3', weekdays: 10, state: 'none' },
            { id: '5', label: 'PPAP', start: '2026-01-25', end: '2026-02-06', progress: 0, color: '#c63927', type: 'Task', expanded: true, parentId: '3', weekdays: 10, state: 'none' },
            { id: '6', label: 'Sample', start: '2026-01-25', end: '2026-02-06', progress: 0, color: '#c63927', type: 'Task', expanded: true, parentId: '3', weekdays: 10, state: 'none' },
            { id: '7', label: 'T1xx', start: '2026-01-25', end: '2026-04-10', progress: 0, color: '#a2ae2a', type: 'Project', expanded: true, parentId: null, weekdays: 55, state: 'none' },
            { id: '8', label: 'Subtask of T1xx', start: '2026-01-25', end: '2026-02-01', progress: 0, color: '#a2ae2a', type: 'Task', expanded: true, parentId: '7', weekdays: 5, state: 'none' },
        ];

        this.viewStart = new Date('2026-01-01');
        this.viewEnd = new Date('2026-04-30');
        this.pxPerDay = 30; // Scale factor
        this.editingTaskId = null;
        this.searchQuery = '';

        this.init();
    }

    init() {
        this.renderAll();
        this.bindEvents();
        lucide.createIcons();
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
            // Hide segments (same-row bars) from the tree list
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
        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.renderAll();
        });

        // Zoom
        document.getElementById('zoomIn').onclick = () => {
            this.pxPerDay = Math.min(100, this.pxPerDay + 5);
            this.renderAll();
        };
        document.getElementById('zoomOut').onclick = () => {
            this.pxPerDay = Math.max(5, this.pxPerDay - 5);
            this.renderAll();
        };

        // Date Navigation
        document.getElementById('prevStart').onclick = () => this.shiftView('start', -7);
        document.getElementById('nextStart').onclick = () => this.shiftView('start', 7);
        document.getElementById('prevEnd').onclick = () => this.shiftView('end', -7);
        document.getElementById('nextEnd').onclick = () => this.shiftView('end', 7);

        // Global Add
        document.getElementById('globalAddTask').onclick = () => this.addNewTask(null);

        // Gantt Interactions (Drag & Resize)
        let isInteracting = false;
        let interactionType = null; // 'drag', 'resize-l', 'resize-r'
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

            if (resizer) {
                interactionType = resizer.classList.contains('resizer-l') ? 'resize-l' : 'resize-r';
            } else {
                interactionType = 'drag';
            }

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
                if (newWidth > 10) {
                    bar.style.left = `${newLeft}px`;
                    bar.style.width = `${newWidth}px`;
                }
            } else if (interactionType === 'resize-r') {
                const newWidth = initialWidth + deltaX;
                if (newWidth > 10) {
                    bar.style.width = `${newWidth}px`;
                }
            }
        });

        window.addEventListener('mouseup', () => {
            if (!isInteracting) return;

            const bar = document.querySelector(`.gantt-bar[data-id="${targetTaskId}"]`);
            const task = this.tasks.find(t => t.id === targetTaskId);

            if (bar && task) {
                const left = parseFloat(bar.style.left);
                const width = parseFloat(bar.style.width);

                // Convert pixels back to dates
                const startMs = this.viewStart.getTime() + (left / this.pxPerDay) * (1000 * 60 * 60 * 24);
                const endMs = startMs + (width / this.pxPerDay) * (1000 * 60 * 60 * 24);

                task.start = new Date(startMs).toISOString().split('T')[0];
                task.end = new Date(endMs).toISOString().split('T')[0];
                task.weekdays = this.calculateWeekdays(task.start, task.end);
            }

            isInteracting = false;
            targetTaskId = null;
            this.renderAll();
        });

        // Tree Grid Click
        document.getElementById('treeGrid').addEventListener('click', (e) => {
            const row = e.target.closest('.tree-row');
            if (!row) return;
            const id = row.dataset.id;
            const task = this.tasks.find(t => t.id === id);

            if (e.target.closest('.tree-expander')) {
                task.expanded = !task.expanded;
                this.renderAll();
                return;
            }

            if (e.target.closest('.more-btn')) {
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
            if (!e.target.closest('#contextMenu') && !e.target.closest('.more-btn')) {
                this.hideContextMenu();
            }
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

        startInput.onchange = () => {
            if (weekdayInput.value) {
                endInput.value = this.calculateEndDate(startInput.value, parseInt(weekdayInput.value));
            }
        };
        weekdayInput.oninput = () => {
            if (startInput.value) {
                endInput.value = this.calculateEndDate(startInput.value, parseInt(weekdayInput.value));
            }
        };
        endInput.onchange = () => {
            if (startInput.value) {
                weekdayInput.value = this.calculateWeekdays(startInput.value, endInput.value);
            }
        };
    }

    shiftView(type, days) {
        if (type === 'start') {
            this.viewStart.setDate(this.viewStart.getDate() + days);
        } else {
            this.viewEnd.setDate(this.viewEnd.getDate() + days);
        }
        this.renderAll();
    }

    showContextMenu(e, taskId) {
        const menu = document.getElementById('contextMenu');
        menu.classList.remove('hidden');
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.dataset.taskId = taskId;
    }

    hideContextMenu() {
        document.getElementById('contextMenu').classList.add('hidden');
    }

    handleMenuAction(action, taskId) {
        const target = this.tasks.find(t => t.id === taskId);
        switch (action) {
            case 'edit': this.openEditModal(taskId); break;
            case 'newChild': this.addNewTask(taskId); break;
            case 'newSameRow': this.addNewTask(null, taskId); break;
            case 'delete': this.deleteTask(taskId); break;
            case 'moveUp': this.moveTask(taskId, -1); break;
            case 'moveDown': this.moveTask(taskId, 1); break;
        }
    }

    addNewTask(parentId = null, rowTaskId = null) {
        const id = Date.now().toString();
        const newTask = {
            id,
            label: rowTaskId ? 'Subtask' : (parentId ? 'New Subtask' : 'New Project'),
            start: '2026-03-01',
            end: '2026-03-15',
            progress: 0,
            color: '#0084d1',
            type: 'Task',
            expanded: true,
            parentId: parentId,
            rowTaskId: rowTaskId, // Link to existing row
            weekdays: 10,
            state: 'none'
        };
        this.tasks.push(newTask);
        this.renderAll();
        this.openEditModal(id);
    }

    deleteTask(id) {
        this.tasks = this.tasks.filter(t => t.id !== id && t.parentId !== id && t.rowTaskId !== id);
        this.renderAll();
    }

    moveTask(id, dir) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index === -1) return;
        const newIndex = index + dir;
        if (newIndex < 0 || newIndex >= this.tasks.length) return;

        const temp = this.tasks[index];
        this.tasks[index] = this.tasks[newIndex];
        this.tasks[newIndex] = temp;
        this.renderAll();
    }

    openEditModal(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        this.editingTaskId = taskId;
        document.getElementById('editTaskLabel').value = task.label;
        document.getElementById('editTaskStart').value = task.start;
        document.getElementById('editTaskEnd').value = task.end;
        document.getElementById('editTaskWeekdays').value = task.weekdays;
        document.getElementById('editTaskProgress').value = task.progress;
        document.getElementById('editTaskType').value = task.type;
        document.getElementById('editTaskColor').style.backgroundColor = task.color;
        document.getElementById('editTaskState').value = task.state;

        document.getElementById('editModal').classList.remove('hidden');
    }

    closeEditModal() {
        document.getElementById('editModal').classList.add('hidden');
        this.editingTaskId = null;
    }

    saveTask() {
        if (!this.editingTaskId) return;
        const task = this.tasks.find(t => t.id === this.editingTaskId);
        task.label = document.getElementById('editTaskLabel').value;
        task.start = document.getElementById('editTaskStart').value;
        task.end = document.getElementById('editTaskEnd').value;
        task.weekdays = parseInt(document.getElementById('editTaskWeekdays').value);
        task.progress = parseInt(document.getElementById('editTaskProgress').value);
        task.type = document.getElementById('editTaskType').value;
        task.state = document.getElementById('editTaskState').value;

        this.renderAll();
        this.closeEditModal();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new GanttApp();
});

