const authSuppabase = window.sbClient;

if (!authSuppabase) {
    console.error("Supabase client not found in auth.js");
}

const Auth = {
    isLoggedIn: false,
    isAdmin: false,
    user: null,
    mode: 'login',

    async init() {
        console.log("Auth init started...");
        this.bindEvents(); // [중요] 버튼 이벤트 먼저 연결하여 UI 먹통 방지

        if (!authSuppabase) return;

        try {
            // 세션 상태 감지
            authSuppabase.auth.onAuthStateChange(async (event, session) => {
                console.log("Auth Event:", event);
                if (event === 'SIGNED_IN' && session) {
                    await this.handleAuthStateChange(session.user);
                } else if (event === 'SIGNED_OUT') {
                    window.location.reload();
                } else if (event === 'PASSWORD_RECOVERY') {
                    this.showResetForm();
                }
            });

            // 현재 세션 확인
            const { data, error } = await authSuppabase.auth.getSession();
            if (error) throw error;

            if (data.session) {
                await this.handleAuthStateChange(data.session.user);
            } else {
                this.showAuthModal();
            }
        } catch (err) {
            console.error("Auth Init Error:", err);
            this.showAuthModal();
        }
    },

    bindEvents() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.onclick = fn;
        };

        bind('toggleAuthMode', () => this.toggleMode());
        bind('authSubmit', () => this.mode === 'login' ? this.login() : this.register());
        bind('otpSubmit', () => this.verifyOtp());

        // [핵심] 강력한 로그아웃: 에러가 나도 무조건 초기화
        bind('logoutBtn', async () => {
            try {
                await authSuppabase.auth.signOut();
            } catch (e) {
                console.warn("SignOut api failed, forcing clear:", e);
            }
            // 강제 청소 및 새로고침
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload();
        });

        bind('adminMenuBtn', () => this.showAdminModal());
        bind('closeAdmin', () => document.getElementById('adminModal').classList.add('hidden'));
        bind('approveBtn', () => this.approveUser());

        // Password Reset
        bind('openForgotPass', () => this.showForgotForm());
        bind('backToLogin', () => this.showLoginForm());
        bind('forgotSubmit', () => this.sendResetEmail());
        bind('resetSubmit', () => this.updatePassword());

        if (document.getElementById('resendOtp')) bind('resendOtp', () => this.resendOtp());
        if (document.getElementById('cancelOtp')) bind('cancelOtp', () => this.showLoginForm());
    },

    // --- UI Helpers ---

    showAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) {
            modal.classList.remove('hidden');
            this.showLoginForm();
        }
    },

    showLoginForm() {
        this.safeRemove('loginForm', 'hidden');
        this.safeAdd('forgotPassForm', 'hidden');
        this.safeAdd('otpSection', 'hidden');
        this.safeAdd('resetPassForm', 'hidden');
        const sub = document.getElementById('authSubtitle');
        if (sub) sub.innerText = 'Please log in with your company email';
    },

    showForgotForm() {
        this.safeAdd('loginForm', 'hidden');
        this.safeRemove('forgotPassForm', 'hidden');
        const sub = document.getElementById('authSubtitle');
        if (sub) sub.innerText = 'Reset Password';
    },

    showResetForm() {
        this.safeRemove('authModal', 'hidden');
        this.safeAdd('loginForm', 'hidden');
        this.safeAdd('forgotPassForm', 'hidden');
        this.safeRemove('resetPassForm', 'hidden');
        const sub = document.getElementById('authSubtitle');
        if (sub) sub.innerText = 'Set New Password';
    },

    safeAdd(id, cls) { const el = document.getElementById(id); if (el) el.classList.add(cls); },
    safeRemove(id, cls) { const el = document.getElementById(id); if (el) el.classList.remove(cls); },

    toggleMode() {
        this.mode = this.mode === 'login' ? 'register' : 'login';
        const registerFields = document.getElementById('registerFields');
        const authSubmit = document.getElementById('authSubmit');
        const toggleAuthMode = document.getElementById('toggleAuthMode');
        const authSubtitle = document.getElementById('authSubtitle');

        if (this.mode === 'register') {
            registerFields?.classList.remove('hidden');
            if (authSubmit) authSubmit.innerText = 'Sign Up & Get Code';
            if (toggleAuthMode) toggleAuthMode.innerText = 'Log In';
            if (authSubtitle) authSubtitle.innerText = 'Create your account with company email';
        } else {
            registerFields?.classList.add('hidden');
            if (authSubmit) authSubmit.innerText = 'Login';
            if (toggleAuthMode) toggleAuthMode.innerText = 'Sign Up';
            if (authSubtitle) authSubtitle.innerText = 'Please log in with your company email';
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
            this.safeAdd('loginForm', 'hidden');
            this.safeRemove('otpSection', 'hidden');
            const sub = document.getElementById('authSubtitle');
            if (sub) sub.innerText = 'Check Your Email';
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

    async resendOtp() {
        const id = document.getElementById('userAccount').value.trim();
        const email = id + '@kbautosys.com';
        try {
            const { error } = await authSuppabase.auth.resend({
                type: 'signup',
                email: email
            });
            if (error) throw error;
            alert("Verification code resent successfully.");
        } catch (err) {
            alert("Failed to resend code: " + err.message);
        }
    },

    async login() {
        const id = document.getElementById('userAccount').value.trim();
        const email = id + '@kbautosys.com';
        const password = document.getElementById('authPassword').value;

        try {
            const { data, error } = await authSuppabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
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

    async checkAdminStatus(email) {
        try {
            const { data } = await authSuppabase.from('admin_users').select('email').eq('email', email).maybeSingle();
            return !!data;
        } catch (err) {
            return false;
        }
    },

    async getAdminEmails() {
        try {
            const { data, error } = await authSuppabase
                .from('admin_users')
                .select('email');

            if (error) throw error;
            return data.map(admin => admin.email);
        } catch (err) {
            console.error('Error fetching admin emails:', err);
            return ['csyoon@kbautosys.com']; // Fallback
        }
    },

    async handleAuthStateChange(user) {
        this.user = user;
        this.isLoggedIn = true;

        try {
            this.isAdmin = await this.checkAdminStatus(user.email);
        } catch (e) {
            console.warn("Admin check failed", e);
            this.isAdmin = false;
        }

        if (!window.location.hash.includes('type=recovery')) {
            document.getElementById('authModal')?.classList.add('hidden');
        }

        const avatar = document.getElementById('userAvatar');
        if (avatar) {
            const initial = user.user_metadata.full_name?.charAt(0) || user.email.charAt(0).toUpperCase();
            avatar.innerText = initial;
            avatar.title = `${user.user_metadata.full_name || 'User'} (${user.email})`;
        }

        const adminBtn = document.getElementById('adminMenuBtn');
        if (adminBtn) adminBtn.style.display = this.isAdmin ? 'flex' : 'none';

        if (window.app && typeof window.app.loadTasks === 'function') {
            window.app.loadTasks();
        }
    },

    async showAdminModal() {
        document.getElementById('adminModal').classList.remove('hidden');
        this.loadPermissionList();
    },

    async loadPermissionList() {
        const tbody = document.getElementById('adminUserTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Loading...</td></tr>';

        try {
            const { data, error } = await authSuppabase
                .from('user_permissions')
                .select('*');

            if (error) throw error;

            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#999;">No permissions granted yet.</td></tr>';
                return;
            }

            data.forEach(perm => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 12px 24px;">User: ${perm.user_id.substring(0, 8)}...</td>
                    <td style="padding: 12px 24px;">Project: ${perm.project_name}</td>
                    <td style="padding: 12px 24px;">
                        <button class="project-delete-btn" onclick="Auth.revokePermission('${perm.id}')" style="background:none; border:none; color:var(--danger-color); cursor:pointer;">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
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
