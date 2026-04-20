// ═══════════════════════════════════════════════════════
// AUTH MODULE
// ═══════════════════════════════════════════════════════


        function isServerAuthToken(token = authToken) {
            return typeof token === 'string' && token.length > 0 && !token.startsWith(LOCAL_TOKEN_PREFIX);
        }


        function shouldFallbackToLocalAuth(error) {
            // Localstorage fallback is disabled now that the server is real —
            // silently creating a shadow account whenever the API is
            // unreachable let accounts diverge from the source of truth.
            // Surface the error to the user instead.
            return false;
        }


        // ── User Data Scoping ─────────────────────────────────
        // Keys that contain user-specific data and must be saved/restored per user
        const _USER_SCOPED_KEYS = [
            typeof STORAGE_KEY_BALANCE !== 'undefined' ? STORAGE_KEY_BALANCE : 'casinoBalance',
            typeof STORAGE_KEY_STATS !== 'undefined' ? STORAGE_KEY_STATS : 'casinoStats',
            typeof STORAGE_KEY_XP !== 'undefined' ? STORAGE_KEY_XP : 'casinoXP',
            typeof STORAGE_KEY_DAILY_BONUS !== 'undefined' ? STORAGE_KEY_DAILY_BONUS : 'casinoDailyBonus',
            typeof STORAGE_KEY_BONUS_WHEEL !== 'undefined' ? STORAGE_KEY_BONUS_WHEEL : 'casinoBonusWheel',
            typeof STORAGE_KEY_RECENTLY_PLAYED !== 'undefined' ? STORAGE_KEY_RECENTLY_PLAYED : 'casinoRecentlyPlayed',
            typeof STORAGE_KEY_VIP !== 'undefined' ? STORAGE_KEY_VIP : 'casinoVIP',
            typeof STORAGE_KEY_HALL_OF_FAME !== 'undefined' ? STORAGE_KEY_HALL_OF_FAME : 'matrixHallOfFame',
            typeof STORAGE_KEY_WEEKLY_MISSIONS !== 'undefined' ? STORAGE_KEY_WEEKLY_MISSIONS : 'matrixWeeklyMissions',
            typeof STORAGE_KEY_NOTIFICATIONS !== 'undefined' ? STORAGE_KEY_NOTIFICATIONS : 'matrixNotifications',
            typeof STORAGE_KEY_LOGIN_STREAK !== 'undefined' ? STORAGE_KEY_LOGIN_STREAK : 'matrixLoginStreak',
            'matrixChallenges', 'matrixAchievements', 'matrixLoginCalendar', 'matrixCalendarMilestones',
            'matrixBalanceHistory', 'matrixCommunityJackpot', 'matrixXpBoost', 'matrixMysteryBox',
            'matrixLevelMilestones', 'matrixSpinHistory', 'matrixPromoCodes', 'matrixCashback',
            'matrixHourlyBonus', 'matrixChallengeStreak',
            'matrixLuckySpin', 'matrixGameRatings', 'matrixMyRatings', 'matrixWinReplays', 'matrixUserAvatar',
            typeof STORAGE_KEY_SETTINGS !== 'undefined' ? STORAGE_KEY_SETTINGS : 'casinoSettings',
        ];

        function _saveUserData(userId) {
            if (!userId) return;
            const prefix = '_user_' + userId + '_';
            _USER_SCOPED_KEYS.forEach(key => {
                const val = localStorage.getItem(key);
                if (val !== null) {
                    localStorage.setItem(prefix + key, val);
                }
            });
        }

        function _clearActiveUserData() {
            _USER_SCOPED_KEYS.forEach(key => {
                localStorage.removeItem(key);
            });
        }

        function _restoreUserData(userId) {
            if (!userId) return;
            const prefix = '_user_' + userId + '_';
            _USER_SCOPED_KEYS.forEach(key => {
                const val = localStorage.getItem(prefix + key);
                if (val !== null) {
                    localStorage.setItem(key, val);
                } else {
                    localStorage.removeItem(key);
                }
            });
        }

        function clearAuthSession() {
            // Save outgoing user's data before clearing
            if (currentUser && currentUser.id) {
                _saveUserData(currentUser.id);
            }
            _clearActiveUserData();
            authToken = null;
            localStorage.removeItem(STORAGE_KEY_TOKEN);
            currentUser = null;
            localStorage.removeItem(STORAGE_KEY_USER);
            if (window.CsrfHelper && CsrfHelper.invalidate) CsrfHelper.invalidate();
            // Reset in-memory state
            if (typeof balance !== 'undefined') balance = 0;
            if (typeof stats !== 'undefined') {
                stats.totalSpins = 0; stats.totalWins = 0;
                stats.totalWagered = 0; stats.biggestWin = 0;
            }
            if (typeof playerXP !== 'undefined') playerXP = 0;
            if (typeof playerLevel !== 'undefined') playerLevel = 1;
        }


        function applyAuthSession(token, user) {
            // Save outgoing user's data if switching users
            if (currentUser && currentUser.id && (!user || user.id !== currentUser.id)) {
                _saveUserData(currentUser.id);
                _clearActiveUserData();
            }

            authToken = token;
            localStorage.setItem(STORAGE_KEY_TOKEN, token);
            currentUser = user ? {
                id: user.id,
                username: user.username,
                email: user.email,
                is_admin: Boolean(user.is_admin),
                isGuest: Boolean(user.isGuest),
            } : null;
            localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(currentUser));

            // The CSRF token is bound to the current user id; on a session
            // change, drop the cached token so the next mutation refetches
            // one bound to the new identity.
            if (window.CsrfHelper && CsrfHelper.invalidate) CsrfHelper.invalidate();

            // Restore incoming user's saved data
            if (currentUser && currentUser.id) {
                _restoreUserData(currentUser.id);
            }

            // Server-provided balance takes precedence
            const userBalance = Number(user?.balance);
            if (Number.isFinite(userBalance)) {
                balance = userBalance;
                updateBalance();
                saveBalance();
            } else {
                // Load balance from restored localStorage
                try {
                    const saved = localStorage.getItem(typeof STORAGE_KEY_BALANCE !== 'undefined' ? STORAGE_KEY_BALANCE : 'casinoBalance');
                    if (saved !== null) balance = parseFloat(saved) || 0;
                } catch(e) {}
                if (typeof updateBalance === 'function') updateBalance();
            }

            // Reload XP from restored data
            try {
                const xpKey = typeof STORAGE_KEY_XP !== 'undefined' ? STORAGE_KEY_XP : 'casinoXP';
                const xpData = JSON.parse(localStorage.getItem(xpKey) || '{}');
                if (typeof playerXP !== 'undefined') playerXP = xpData.xp || 0;
                if (typeof playerLevel !== 'undefined') playerLevel = xpData.level || 1;
            } catch(e) {}

            // Reload stats from restored data
            try {
                const statsKey = typeof STORAGE_KEY_STATS !== 'undefined' ? STORAGE_KEY_STATS : 'casinoStats';
                const savedStats = JSON.parse(localStorage.getItem(statsKey) || '{}');
                if (typeof stats !== 'undefined') {
                    stats.totalSpins = savedStats.totalSpins || 0;
                    stats.totalWins = savedStats.totalWins || 0;
                    stats.totalWagered = savedStats.totalWagered || 0;
                    stats.biggestWin = savedStats.biggestWin || 0;
                }
            } catch(e) {}
        }


        async function apiRequest(path, options = {}) {
            const method = options.method || 'GET';
            const body = options.body;
            const requireAuth = Boolean(options.requireAuth);
            const headers = { Accept: 'application/json' };
            if (body !== undefined) {
                headers['Content-Type'] = 'application/json';
            }
            if (requireAuth && authToken) {
                headers.Authorization = `Bearer ${authToken}`;
            }

            let response;
            try {
                response = await fetch(path, {
                    method,
                    headers,
                    body: body !== undefined ? JSON.stringify(body) : undefined
                });
            } catch (error) {
                const networkError = new Error('Could not reach the casino server.');
                networkError.isNetworkError = true;
                networkError.cause = error;
                throw networkError;
            }

            let payload = null;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                try {
                    payload = await response.json();
                } catch {
                    payload = null;
                }
            } else {
                const text = await response.text();
                if (text) payload = { error: text };
            }

            if (!response.ok) {
                const message = payload?.error || payload?.message || `Request failed (${response.status})`;
                const requestError = new Error(message);
                requestError.status = response.status;
                requestError.payload = payload;
                throw requestError;
            }

            return payload || {};
        }


        async function syncServerSession() {
            if (!isServerAuthToken()) return;

            try {
                const me = await apiRequest('/api/auth/me', { requireAuth: true });
                if (me && me.user) {
                    currentUser = {
                        id: me.user.id,
                        username: me.user.username,
                        email: me.user.email,
                        is_admin: Boolean(me.user.is_admin),
                        isGuest: false,
                    };
                    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(currentUser));
                }

                const balanceRes = await apiRequest('/api/balance', { requireAuth: true });
                const serverBalance = Number(balanceRes.balance);
                if (Number.isFinite(serverBalance)) {
                    balance = serverBalance;
                    updateBalance();
                    saveBalance();
                }
            } catch (error) {
                if (error.status === 401 || error.status === 403) {
                    clearAuthSession();
                    updateAuthButton();
                    showToast('Session expired. Please log in again.', 'info');
                } else {
                    console.warn('Unable to sync server session:', error);
                }
            }
        }


        // Check daily login reward availability and show modal if claimable
        async function checkDailyLoginReward() {
            try {
                const data = await apiRequest('/api/daily-login/', { requireAuth: true });
                if (data && data.canClaim && typeof Onboarding !== 'undefined' && Onboarding.showDailyLoginModal) {
                    setTimeout(() => Onboarding.showDailyLoginModal(data), 1500);
                }
            } catch (e) {
                console.warn('[DailyLogin] Could not check:', e);
            }
        }

        // Hash a password with SHA-256 via Web Crypto (returns hex string).
        async function hashPassword(password) {
            const encoded = new TextEncoder().encode(password);
            const buf = await crypto.subtle.digest('SHA-256', encoded);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }


        async function loginWithLocalFallback(username, password) {
            const users = JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || '{}');
            const key = username.toLowerCase();
            const user = users[key];
            if (!user) throw new Error('User not found. Please register first.');

            const hashed = await hashPassword(password);

            // Accept hashed match; also migrate legacy plaintext entries on the fly
            const isHashedMatch   = user.passwordHash && user.passwordHash === hashed;
            const isLegacyMatch   = !user.passwordHash && user.password === password;
            if (!isHashedMatch && !isLegacyMatch) throw new Error('Incorrect password.');

            if (isLegacyMatch) {
                // Upgrade to hashed storage and remove plaintext
                user.passwordHash = hashed;
                delete user.password;
                users[key] = user;
                localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
            }

            applyAuthSession(`${LOCAL_TOKEN_PREFIX}${Date.now()}`, {
                id: user.id || null,
                username: user.username,
                email: user.email,
                balance,
            });
            return user;
        }


        async function registerWithLocalFallback(username, email, password, dateOfBirth) {
            const users = JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || '{}');
            const key = username.toLowerCase();
            if (users[key]) throw new Error('Username already taken.');
            if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) throw new Error(`Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`);
            if (password.length < 6) throw new Error('Password must be at least 6 characters.');

            const passwordHash = await hashPassword(password);
            const localId = `local_${Date.now()}`;
            users[key] = { username, email, passwordHash, id: localId, date_of_birth: dateOfBirth || null };
            localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
            applyAuthSession(`${LOCAL_TOKEN_PREFIX}${Date.now()}`, {
                id: localId,
                username,
                email,
                date_of_birth: dateOfBirth || null,
                balance,
            });
        }


        async function login(username, password) {
            let serverError = null;
            try {
                const response = await apiRequest('/api/auth/login', {
                    method: 'POST',
                    body: { username, password },
                    requireAuth: false
                });
                if (!response.token || !response.user) {
                    throw new Error('Invalid login response from server.');
                }
                applyAuthSession(response.token, response.user);
                updateAuthButton();
                document.body.classList.remove('auth-gate');
                hideAuthModal();
                showToast(`Welcome back, ${response.user.username}!`, 'success');
                if (typeof onPostAuthInit === 'function') onPostAuthInit();
                if (window.LoginHistory) LoginHistory.log({ type: 'login', outcome: 'success', username: response.user.username });
                if (window.SessionClock) SessionClock.reset();
                // Check for daily login reward after login
                checkDailyLoginReward();
                return;
            } catch (error) {
                serverError = error;
            }

            if (!shouldFallbackToLocalAuth(serverError)) {
                if (window.LoginHistory) LoginHistory.log({ type: 'login', outcome: 'failed', username: username, reason: (serverError && serverError.message) || 'server error' });
                throw serverError;
            }

            let user;
            try {
                user = await loginWithLocalFallback(username, password);
            } catch (localError) {
                if (window.LoginHistory) LoginHistory.log({ type: 'login', outcome: 'failed', username: username, reason: (localError && localError.message) || 'local auth failed' });
                throw localError;
            }
            updateAuthButton();
            document.body.classList.remove('auth-gate');
            hideAuthModal();
            showToast(`Welcome back, ${user.username}!`, 'success');
            if (typeof onPostAuthInit === 'function') onPostAuthInit();
            if (window.LoginHistory) LoginHistory.log({ type: 'login', outcome: 'success', username: user.username });
            if (window.SessionClock) SessionClock.reset();
        }


        async function register(username, email, password, referralCode, dateOfBirth) {
            let serverError = null;
            try {
                const body = { username, email, password };
                if (referralCode) body.referralCode = referralCode;
                if (dateOfBirth) body.date_of_birth = dateOfBirth;
                const response = await apiRequest('/api/auth/register', {
                    method: 'POST',
                    body,
                    requireAuth: false
                });
                if (!response.token || !response.user) {
                    throw new Error('Invalid registration response from server.');
                }
                applyAuthSession(response.token, response.user);
                updateAuthButton();
                document.body.classList.remove('auth-gate');
                hideAuthModal();
                showToast(`Welcome, ${response.user.username}! Your account has been created.`, 'success');
                if (typeof onPostAuthInit === 'function') onPostAuthInit();
                if (window.LoginHistory) LoginHistory.log({ type: 'register', outcome: 'success', username: response.user.username });
                if (window.SessionClock) SessionClock.reset();
                // Show welcome onboarding modal for new registrations
                if (typeof Onboarding !== 'undefined' && Onboarding.showWelcomeModal) {
                    setTimeout(() => Onboarding.showWelcomeModal(response.user), 600);
                }
                return;
            } catch (error) {
                serverError = error;
            }

            if (!shouldFallbackToLocalAuth(serverError)) {
                throw serverError;
            }

            await registerWithLocalFallback(username, email, password, dateOfBirth);
            if (window.LoginHistory) LoginHistory.log({ type: 'register', outcome: 'success', username: username });
            if (window.SessionClock) SessionClock.reset();
            updateAuthButton();
            document.body.classList.remove('auth-gate');
            hideAuthModal();
            showToast(`Welcome, ${username}! Your account has been created.`, 'success');
            if (typeof onPostAuthInit === 'function') onPostAuthInit();
        }


        function loginAsGuest() {
            // Guest login previously minted a $1,000 client-side balance
            // with no server backing — a demo shortcut, not a real account.
            // Now that balances settle on the server via real deposits, there
            // is no honest way to grant money here. Redirect the user to
            // create a real account instead.
            if (typeof switchAuthTab === 'function') switchAuthTab('register');
            showToast('Please create an account to play. Guest mode has been removed.', 'info');
        }


        async function logout() {
            // Push stats to server before clearing session
            if (isServerAuthToken()) {
                try {
                    await apiRequest('/api/user/stats', {
                        method: 'PUT',
                        body: { stats: stats },
                        requireAuth: true
                    });
                } catch (err) {
                    // Best-effort — don't block logout
                }
            }
            const priorUser = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;
            clearAuthSession();
            if (window.LoginHistory) LoginHistory.log({ type: 'logout', outcome: 'success', username: priorUser });
            if (window.SessionClock) SessionClock.stop();
            updateAuthButton();
            if (typeof updateBalance === 'function') updateBalance();
            showToast('Logged out successfully.', 'info');
            // Return to auth gate
            document.body.classList.add('auth-gate');
            showAuthModal();
        }


        function updateAuthButton() {
            const label = document.getElementById('authBtnLabel');
            const btn = document.getElementById('authBtn');
            if (!btn) return;
            if (currentUser) {
                if (label) label.textContent = currentUser.username.toUpperCase();
                btn.title = 'View profile';
                btn.onclick = () => showProfileModal();
                // Show admin button if user is admin
                _updateAdminButton();
            } else {
                if (label) label.textContent = 'LOGIN';
                btn.title = 'Click to login';
                btn.onclick = () => showAuthModal();
                _hideAdminButton();
            }
        }

        function _updateAdminButton() {
            if (!currentUser || (currentUser.is_admin !== 1 && currentUser.is_admin !== true)) {
                _hideAdminButton();
                return;
            }
            var xpDisplay = document.getElementById('xpDisplay');
            if (!xpDisplay) return;
            var adminBtn = document.getElementById('adminAnalyticsBtn');
            if (!adminBtn) {
                adminBtn = document.createElement('button');
                adminBtn.id = 'adminAnalyticsBtn';
                adminBtn.className = 'btn btn-user';
                adminBtn.title = 'Admin Analytics Dashboard';
                adminBtn.innerHTML = '📊';
                adminBtn.style.fontSize = '18px';
                adminBtn.style.padding = '8px 10px';
                adminBtn.onclick = function() {
                    if (typeof AdminAnalytics !== 'undefined' && AdminAnalytics.show) {
                        AdminAnalytics.show();
                    }
                };
                xpDisplay.parentElement.insertBefore(adminBtn, xpDisplay.nextSibling);
            }
            adminBtn.style.display = 'block';
        }

        function _hideAdminButton() {
            var adminBtn = document.getElementById('adminAnalyticsBtn');
            if (adminBtn) adminBtn.style.display = 'none';
        }


        function showAuthModal() {
            const modal = document.getElementById('authModal');
            if (modal) modal.classList.add('active');
            // Reset to login tab when opening
            if (typeof switchAuthTab === 'function') switchAuthTab('login');
        }


        function hideAuthModal() {
            // When auth is required, don't allow the modal to be dismissed until signed in
            if (document.body.classList.contains('auth-gate') && !currentUser) return;
            const modal = document.getElementById('authModal');
            if (modal) modal.classList.remove('active');
            // Clear form fields and errors on close
            const errEl = document.getElementById('authError');
            if (errEl) errEl.textContent = '';
            ['loginUsername', 'loginPassword', 'regUsername', 'regEmail', 'regPassword', 'regConfirm', 'forgotEmail', 'resetNewPassword', 'resetConfirmPassword'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            // Reset to login form
            showForgotPassword(false);
            // Also hide reset password form if visible
            const resetForm = document.getElementById('resetPasswordForm');
            if (resetForm) resetForm.style.display = 'none';
        }


        function showForgotPassword(show) {
            const loginForm = document.getElementById('loginForm');
            const forgotForm = document.getElementById('forgotPasswordForm');
            if (show === false || show === undefined && forgotForm && forgotForm.style.display !== 'none') {
                // Show login, hide forgot
                if (loginForm) loginForm.style.display = '';
                if (forgotForm) forgotForm.style.display = 'none';
            } else {
                // Show forgot, hide login
                if (loginForm) loginForm.style.display = 'none';
                if (forgotForm) forgotForm.style.display = '';
            }
        }


        async function handleForgotPassword() {
            const email = (document.getElementById('forgotEmail')?.value || '').trim();
            const errEl = document.getElementById('authError');
            if (!email) {
                if (errEl) errEl.textContent = 'Please enter your email address.';
                return;
            }
            try {
                await apiRequest('/api/user/forgot-password', {
                    method: 'POST',
                    body: { email }
                });
                showToast('If an account with that email exists, a reset link has been sent.', 'success');
                showForgotPassword(false);
            } catch (err) {
                // Always show generic success to prevent email enumeration
                showToast('If an account with that email exists, a reset link has been sent.', 'success');
                showForgotPassword(false);
            }
        }


        // ─── Password Reset (from emailed ?resetToken= link) ───

        // Stored token from URL — consumed by handleResetPassword()
        let _pendingResetToken = null;

        function showResetPassword(show) {
            const loginForm = document.getElementById('loginForm');
            const registerForm = document.getElementById('registerForm');
            const forgotForm = document.getElementById('forgotPasswordForm');
            const resetForm = document.getElementById('resetPasswordForm');
            const tabs = document.querySelectorAll('.auth-tab');
            const divider = document.querySelector('.auth-divider');
            const guestBtn = document.querySelector('.auth-guest-btn');

            if (show === false) {
                // Back to login
                _pendingResetToken = null;
                if (loginForm) loginForm.style.display = '';
                if (registerForm) registerForm.style.display = 'none';
                if (forgotForm) forgotForm.style.display = 'none';
                if (resetForm) resetForm.style.display = 'none';
                tabs.forEach(t => t.style.display = '');
                if (divider) divider.style.display = '';
                if (guestBtn) guestBtn.style.display = '';
                // Clean URL without reload
                const url = new URL(window.location);
                url.searchParams.delete('resetToken');
                window.history.replaceState({}, '', url);
                return;
            }

            // Show reset form, hide everything else
            if (loginForm) loginForm.style.display = 'none';
            if (registerForm) registerForm.style.display = 'none';
            if (forgotForm) forgotForm.style.display = 'none';
            if (resetForm) resetForm.style.display = '';
            tabs.forEach(t => t.style.display = 'none');
            if (divider) divider.style.display = 'none';
            if (guestBtn) guestBtn.style.display = 'none';
        }

        async function handleResetPassword() {
            const newPwd = (document.getElementById('resetNewPassword')?.value || '');
            const confirmPwd = (document.getElementById('resetConfirmPassword')?.value || '');
            const errEl = document.getElementById('authError');

            if (!newPwd || newPwd.length < 6) {
                if (errEl) errEl.textContent = 'Password must be at least 6 characters.';
                return;
            }
            if (newPwd !== confirmPwd) {
                if (errEl) errEl.textContent = 'Passwords do not match.';
                return;
            }
            if (!_pendingResetToken) {
                if (errEl) errEl.textContent = 'Reset token is missing. Please use the link from your email.';
                return;
            }

            try {
                await apiRequest('/api/user/reset-password', {
                    method: 'POST',
                    body: { token: _pendingResetToken, new_password: newPwd }
                });
                showToast('Password reset successful! You can now sign in.', 'success');
                showResetPassword(false);
            } catch (err) {
                if (errEl) errEl.textContent = err.message || 'Reset failed. The link may have expired.';
            }
        }

        /**
         * Called from initAllSystems — checks for ?resetToken= and shows the reset form.
         * Returns true if the reset flow was activated (caller should skip normal auth gate).
         */
        function checkResetTokenOnLoad() {
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('resetToken');
            if (!token) return false;
            _pendingResetToken = token;
            showAuthModal();
            showResetPassword(true);
            return true;
        }
