/**
 * Authentication and Permission Logic for KB Autosys Gantt
 */
const authSuppabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const Auth = {
    isLoggedIn: false,
    isAdmin: false,
    user: null,
    mode: 'login', // 'login' or 'register'

    async init() {
        this.bindEvents();

        // Supabase 인증 상태 변화 감지 (비밀번호 재설정 이벤트 포착용)
        authSuppabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                this.showResetForm(); // 재설정 모드면 강제로 폼 표시
            } else if (event === 'SIGNED_IN' && session) {
                this.handleAuthStateChange(session.user);
            } else if (event === 'SIGNED_OUT') {
                // 로그아웃 시 처리
            }
        });

        // 초기 세션 체크 (기존 로직 유지하되, 리스너가 처리하므로 중복 방지)
        const { data: { session } } = await authSuppabase.auth.getSession();
        if (session && !window.location.hash.includes('type=recovery')) {
            this.handleAuthStateChange(session.user);
        } else if (!session) {
            this.showAuthModal();
        }
    },

    bindEvents() {
        document.getElementById('toggleAuthMode').onclick = () => this.toggleMode();
        document.getElementById('authSubmit').onclick = () => this.mode === 'login' ? this.login() : this.register();
        document.getElementById('otpSubmit').onclick = () => this.verifyOtp();
        document.getElementById('logoutBtn').onclick = () => this.logout();
        document.getElementById('adminMenuBtn').onclick = () => this.showAdminModal();
        document.getElementById('closeAdmin').onclick = () => document.getElementById('adminModal').classList.add('hidden');
        document.getElementById('approveBtn').onclick = () => this.approveUser();

        // OTP helpers
        if (document.getElementById('resendOtp')) {
            document.getElementById('resendOtp').onclick = () => {
                alert("If you haven't received the code, please try signing up again or contact admin.");
            };
        }
        if (document.getElementById('cancelOtp')) {
            document.getElementById('cancelOtp').onclick = () => this.showLoginForm();
        }

        // Password Reset Events
        document.getElementById('openForgotPass').onclick = () => this.showForgotForm();
        document.getElementById('backToLogin').onclick = () => this.showLoginForm();
        document.getElementById('forgotSubmit').onclick = () => this.sendResetEmail();
        document.getElementById('resetSubmit').onclick = () => this.updatePassword();
    },



    showAuthModal() {
        document.getElementById('authModal').classList.remove('hidden');
        this.showLoginForm();
    },

    showLoginForm() {
        document.getElementById('loginForm').classList.remove('hidden');
        document.getElementById('forgotPassForm').classList.add('hidden');
        document.getElementById('otpSection').classList.add('hidden');
        document.getElementById('resetPassForm').classList.add('hidden');
        document.getElementById('authSubtitle').innerText = 'Please log in with your company email';
    },

    showForgotForm() {
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('forgotPassForm').classList.remove('hidden');
        document.getElementById('authSubtitle').innerText = 'Reset Password';
    },

    showResetForm() {
        document.getElementById('authModal').classList.remove('hidden');
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('forgotPassForm').classList.add('hidden');
        document.getElementById('resetPassForm').classList.remove('hidden');
        document.getElementById('authSubtitle').innerText = 'Set New Password';
    },

    toggleMode() {
        this.mode = this.mode === 'login' ? 'register' : 'login';
        const registerFields = document.getElementById('registerFields');
        const authSubmit = document.getElementById('authSubmit');
        const toggleAuthMode = document.getElementById('toggleAuthMode');
        const authSubtitle = document.getElementById('authSubtitle');

        if (this.mode === 'register') {
            registerFields.classList.remove('hidden');
            authSubmit.innerText = 'Sign Up & Get Code';
            toggleAuthMode.innerText = 'Log In';
            authSubtitle.innerText = 'Create your account with company email';
        } else {
            registerFields.classList.add('hidden');
            authSubmit.innerText = 'Login';
            toggleAuthMode.innerText = 'Sign Up';
            authSubtitle.innerText = 'Please log in with your company email';
        }
    },

    async register() {
        const id = document.getElementById('userAccount').value.trim();
        const password = document.getElementById('authPassword').value;
        const fullName = document.getElementById('authName').value;
        const email = id + '@kbautosys.com';

        if (!id) {
            alert("Please enter your account ID.");
            return;
        }

        if (!fullName) {
            alert("Please enter your full name.");
            return;
        }

        try {
            const { data, error } = await authSuppabase.auth.signUp({
                email,
                password,
                options: {
                    data: { full_name: fullName }
                }
            });

            if (error) throw error;

            // Show OTP section
            document.getElementById('loginForm').classList.add('hidden');
            document.getElementById('otpSection').classList.remove('hidden');
            document.getElementById('authSubtitle').innerText = 'Check Your Email';
        } catch (err) {
            alert("Sign up failed: " + err.message);
        }
    },

    async verifyOtp() {
        const id = document.getElementById('userAccount').value.trim();
        const email = id + '@kbautosys.com';
        const token = document.getElementById('otpToken').value;

        try {
            const { error } = await authSuppabase.auth.verifyOtp({
                email,
                token,
                type: 'signup'
            });

            if (error) throw error;
            alert("Email verification successful! You can log in after admin approval.");
            window.location.reload();
        } catch (err) {
            alert("Verification failed: " + err.message);
        }
    },

    async login() {
        const id = document.getElementById('userAccount').value.trim();
        const email = id + '@kbautosys.com';
        const password = document.getElementById('authPassword').value;

        try {
            const { data, error } = await authSuppabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;
            this.handleAuthStateChange(data.user);
        } catch (err) {
            alert("Login failed: " + err.message);
        }
    },

    async sendResetEmail() {
        const id = document.getElementById('forgotAccount').value.trim();
        const email = id + '@kbautosys.com';
        if (!id) {
            alert("Please enter your account ID.");
            return;
        }

        try {
            const { error } = await authSuppabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + window.location.pathname
            });
            if (error) throw error;
            alert("Password reset email has been sent.");
            this.showLoginForm();
        } catch (err) {
            alert("An error occurred: " + err.message);
        }
    },

    async updatePassword() {
        const newPassword = document.getElementById('newPassword').value;
        if (newPassword.length < 6) {
            alert("Password must be at least 6 characters long.");
            return;
        }

        try {
            const { error } = await authSuppabase.auth.updateUser({
                password: newPassword
            });
            if (error) throw error;
            alert("Password updated successfully. Please log in with your new password.");
            window.location.hash = ''; // Clear hash
            this.showLoginForm();
        } catch (err) {
            alert("An error occurred: " + err.message);
        }
    },

    async handleAuthStateChange(user) {
        this.user = user;
        this.isLoggedIn = true;
        this.isAdmin = user.email === 'csyoon@kbautosys.com'; // 관리자 이메일 확인

        // [수정된 부분] 비밀번호 재설정 중이 아닐 때만 모달을 닫음
        if (!window.location.hash.includes('type=recovery')) {
            document.getElementById('authModal').classList.add('hidden');
        }
        document.getElementById('userAvatar').innerText = user.user_metadata.full_name?.charAt(0) || user.email.charAt(0).toUpperCase();
        document.getElementById('userAvatar').title = `${user.user_metadata.full_name || 'User'} (${user.email})`;

        if (this.isAdmin) {
            document.getElementById('adminMenuBtn').style.display = 'flex';
        }

        // Initialize App after auth
        if (window.app) {
            window.app.loadTasks();
        }
    },

    async logout() {
        await authSuppabase.auth.signOut();
        window.location.reload();
    },

    async showAdminModal() {
        document.getElementById('adminModal').classList.remove('hidden');
        if (typeof renderUserList === 'function') {
            renderUserList();
        }
    },

    async loadPermissionList() {
        const list = document.getElementById('userPermissionList');
        list.innerHTML = '<p style="padding:16px; text-align:center;">Loading...</p>';

        try {
            const { data, error } = await authSuppabase
                .from('user_permissions')
                .select('*');

            if (error) throw error;

            list.innerHTML = '';
            if (data.length === 0) {
                list.innerHTML = '<p style="padding:16px; text-align:center; color:#999;">No permissions granted yet.</p>';
            }

            data.forEach(perm => {
                const item = document.createElement('div');
                item.className = 'permission-item';
                item.innerHTML = `
                    <div>
                        <div style="font-weight:600; font-size:14px;">User ID: ${perm.user_id.substring(0, 8)}...</div>
                        <div style="color:#666; font-size:12px;">Project: ${perm.project_name}</div>
                    </div>
                    <button class="project-delete-btn" onclick="Auth.revokePermission('${perm.id}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                `;
                list.appendChild(item);
            });
            lucide.createIcons();
        } catch (err) {
            console.error(err);
        }
    },

    async approveUser() {
        const userId = document.getElementById('adminUserId').value;
        const projectName = document.getElementById('adminProjName').value;

        if (!userId || !projectName) {
            alert("Please enter both User ID and Project Name.");
            return;
        }

        try {
            const { error } = await authSuppabase
                .from('user_permissions')
                .insert({
                    user_id: userId,
                    project_name: projectName,
                    is_approved: true
                });

            if (error) throw error;
            alert("Permission granted successfully.");
            this.loadPermissionList();
        } catch (err) {
            alert("Failed to grant permission: " + err.message);
        }
    },

    async revokePermission(id) {
        if (!confirm("Are you sure you want to revoke this permission?")) return;
        try {
            const { error } = await authSuppabase
                .from('user_permissions')
                .delete()
                .eq('id', id);

            if (error) throw error;
            this.loadPermissionList();
        } catch (err) {
            alert("Revoke failed: " + err.message);
        }
    }
};

window.Auth = Auth;
Auth.init();
