// =============================================
// NEXUS BOTHOST - Full Client-Side Application
// A production-grade SPA with virtual routing,
// state management, and real-time updates
// =============================================

'use strict';

// ─── CONFIGURATION ─────────────────────────────
const CONFIG = {
    API_BASE: '/api',
    ADMIN_API: '/admin',
    REFRESH_INTERVAL: 30000,
    DEPS_CHECK_INTERVAL: 5000,
    MAX_LOG_LINES: 2000,
    TOAST_DURATION: 3000,
    DEBOUNCE_DELAY: 300
};

// ─── STATE MANAGEMENT ──────────────────────────
class Store {
    constructor() {
        this.state = {
            user: null,
            isAdmin: false,
            bots: [],
            myBots: [],
            logs: [],
            stats: null,
            trends: null,
            users: [],
            currentView: 'dashboard',
            selectedBot: null,
            consoleLines: [],
            consoleAutoScroll: true,
            consoleUnread: 0,
            fileBrowser: {
                path: '',
                files: [],
                breadcrumb: []
            },
            editingFile: null,
            isLoading: false,
            notifications: []
        };
        this.listeners = [];
        this.cache = new Map();
    }

    get(key) {
        return key ? this.state[key] : this.state;
    }

    set(key, value) {
        if (typeof key === 'object') {
            Object.assign(this.state, key);
        } else {
            this.state[key] = value;
        }
        this.notify();
    }

    update(key, updater) {
        this.state[key] = updater(this.state[key]);
        this.notify();
    }

    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify() {
        this.listeners.forEach(listener => listener(this.state));
    }

    // Cache helpers
    cacheGet(key, ttl = 60000) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < ttl) {
            return cached.data;
        }
        return null;
    }

    cacheSet(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    cacheInvalidate(key) {
        this.cache.delete(key);
    }

    cacheClear() {
        this.cache.clear();
    }
}

const store = new Store();

// ─── ROUTER ──────────────────────────────────────
class Router {
    constructor() {
        this.routes = new Map();
        this.currentPath = '';
        this.viewTransitions = true;
        
        // Intercept all navigation
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href]');
            if (!link) return;
            
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
                link.target === '_blank' || link.hasAttribute('download')) return;
            
            try {
                const url = new URL(href, location.origin);
                if (url.origin !== location.origin) return;
                e.preventDefault();
                this.navigate(url.pathname);
            } catch (_) {
                // Invalid URL, let browser handle it
            }
        });

        // Handle back/forward
        window.addEventListener('popstate', () => {
            this.navigate(window.location.pathname, false);
        });

        // Intercept form submissions for SPA behavior
        document.addEventListener('submit', (e) => {
            const form = e.target;
            if (form.dataset.spa !== 'false' && !form.hasAttribute('action')) {
                e.preventDefault();
                this.handleFormSubmit(form);
            }
        });
    }

    register(path, handler, options = {}) {
        this.routes.set(path, { handler, options });
        return this;
    }

    navigate(path, pushState = true) {
        if (path === this.currentPath) {
            this.routes.get(path)?.handler();
            return;
        }

        // Find matching route
        let matchedRoute = null;
        let params = {};
        
        for (const [route, config] of this.routes) {
            if (route === path) {
                matchedRoute = config;
                break;
            }
            // Simple path param support: /admin/bots/:id
            const routeParts = route.split('/');
            const pathParts = path.split('/');
            if (routeParts.length === pathParts.length) {
                let match = true;
                const tempParams = {};
                for (let i = 0; i < routeParts.length; i++) {
                    if (routeParts[i].startsWith(':')) {
                        tempParams[routeParts[i].slice(1)] = pathParts[i];
                    } else if (routeParts[i] !== pathParts[i]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    matchedRoute = config;
                    params = tempParams;
                    break;
                }
            }
        }

        if (!matchedRoute) {
            this.routes.get('/404')?.handler();
            return;
        }

        if (pushState) {
            window.history.pushState({}, '', path);
        }

        this.currentPath = path;
        store.set({ currentPath: path, routeParams: params });
        
        if (this.viewTransitions && document.startViewTransition) {
            document.startViewTransition(() => matchedRoute.handler(params));
        } else {
            matchedRoute.handler(params);
        }
    }

    handleFormSubmit(form) {
        const method = (form.method || 'POST').toUpperCase();
        const action = form.action || window.location.pathname;
        const formData = new FormData(form);

        // Check if form has file uploads
        const hasFiles = form.querySelector('input[type="file"]') !== null;

        // Build request
        let body;
        let headers = {};

        if (hasFiles) {
            body = formData;
        } else {
            const data = {};
            for (const [key, value] of formData) {
                if (value instanceof File) continue;
                data[key] = value;
            }
            body = JSON.stringify(data);
            headers['Content-Type'] = 'application/json';
        }

        // Submit via fetch
        fetch(action, {
            method,
            headers,
            body,
            credentials: 'same-origin'
        })
        .then(response => response.json())
        .then(data => {
            if (data.redirect) {
                this.navigate(data.redirect);
            } else if (data.success) {
                showToast('Success!', 'success');
                this.navigate(this.currentPath, false); // Refresh current view
            } else {
                showToast(data.error || 'Operation failed', 'error');
            }
        })
        .catch(err => {
            showToast('Network error: ' + err.message, 'error');
        });
    }
}

// ─── COMPONENT SYSTEM ────────────────────────────
class Component {
    constructor(template, props = {}) {
        this.template = template;
        this.props = props;
        this.element = null;
        this.children = [];
        this.listeners = [];
    }

    render() {
        if (typeof this.template === 'function') {
            return this.template(this.props);
        }
        return this.template;
    }

    mount(container) {
        this.element = document.createElement('div');
        this.element.innerHTML = this.render();
        container.appendChild(this.element);
        this.afterMount();
        return this.element;
    }

    afterMount() {
        // Override in subclasses
    }

    update(props) {
        this.props = { ...this.props, ...props };
        if (this.element) {
            const newHtml = this.render();
            // Use morphdom or similar for efficient updates
            this.element.innerHTML = newHtml;
        }
    }

    destroy() {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
}

// ─── VIEWS ────────────────────────────────────────

// Login View
class LoginView extends Component {
    constructor() {
        super(() => `
            <div class="panel" role="main" aria-label="Sign in">
                <span class="corner corner-tl" aria-hidden="true"></span>
                <span class="corner corner-tr" aria-hidden="true"></span>
                <span class="corner corner-bl" aria-hidden="true"></span>
                <span class="corner corner-br" aria-hidden="true"></span>

                <div class="brand-row">
                    <div class="brand">🤖 NEXUS <span class="tag">BOTHOST</span></div>
                    <div class="status-pill" aria-hidden="true">
                        <span class="status-dot"></span>
                        <span class="status-label">Operational</span>
                    </div>
                </div>
                <h1>Sign in</h1>
                <div class="subtitle">Access your bots and dashboard</div>

                <div id="message-container" role="alert" aria-live="polite"></div>

                <form id="login-form" data-spa="false">
                    <div class="field">
                        <label for="username">Username</label>
                        <div class="field-input-wrap">
                            <span class="field-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                            </span>
                            <input type="text" name="username" id="username" placeholder="your_username" required autofocus spellcheck="false" autocomplete="username" minlength="3" maxlength="50" pattern="[A-Za-z0-9_\\-]+">
                        </div>
                        <div class="error-message" id="username-error">Invalid username format</div>
                    </div>

                    <div class="field">
                        <label for="password">Password</label>
                        <div class="field-input-wrap">
                            <span class="field-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                            </span>
                            <input type="password" name="password" id="password" placeholder="••••••••" required autocomplete="current-password" minlength="6" maxlength="128">
                            <button type="button" class="password-toggle" id="toggle-password" aria-label="Show password" tabindex="-1">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                            </button>
                        </div>
                        <div class="error-message" id="password-error">Password must be at least 6 characters</div>
                        <div class="caps-warning" id="caps-warning">Caps Lock is on</div>
                    </div>

                    <label class="remember-row">
                        <input type="checkbox" name="remember" value="1">
                        <span>Remember this device</span>
                    </label>

                    <button class="submit-btn" type="submit" id="submit-btn">
                        <span class="btn-label">Sign in</span>
                        <svg class="btn-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
                    </button>
                </form>

                <div class="links-row">
                    <a href="/register">Create an account</a>
                    <span class="sep">|</span>
                    <a href="/recovery">Forgot password?</a>
                </div>

                <div class="kbd-hint"><kbd>⌘</kbd><span>+</span><kbd>Enter</kbd><span>to sign in</span></div>

                <div class="footnote">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                    TLS 1.3 · AES-256
                    <span class="dot-sep" aria-hidden="true">·</span>
                    <span id="clock"></span>
                </div>
            </div>
        `);
    }

    afterMount() {
        // Bind form submit
        const form = this.element.querySelector('#login-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = form.querySelector('#username').value;
            const password = form.querySelector('#password').value;
            const remember = form.querySelector('input[name="remember"]').checked;

            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({ username, password, remember: remember ? '1' : '' })
                });

                const data = await response.text();
                if (response.redirected) {
                    // Login successful - check if admin and route accordingly
                    const user = await fetch('/api/user').then(r => r.json()).catch(() => null);
                    if (user && user.is_admin) {
                        router.navigate('/admin');
                    } else {
                        router.navigate('/dashboard');
                    }
                } else {
                    showToast('Invalid username or password', 'error');
                }
            } catch (err) {
                showToast('Network error: ' + err.message, 'error');
            }
        });

        // Password toggle
        const toggleBtn = this.element.querySelector('#toggle-password');
        const passwordInput = this.element.querySelector('#password');
        toggleBtn.addEventListener('click', () => {
            const isVisible = passwordInput.type === 'text';
            passwordInput.type = isVisible ? 'password' : 'text';
            toggleBtn.innerHTML = isVisible ? 
                `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>` :
                `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-3.1 3.9M6.5 6.6C4 8.3 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.2 3.6-.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
        });

        // Caps lock detection
        passwordInput.addEventListener('keydown', (e) => {
            const warning = this.element.querySelector('#caps-warning');
            if (e.getModifierState('CapsLock')) {
                warning.classList.add('visible');
            } else {
                warning.classList.remove('visible');
            }
        });

        // Clock update
        function updateClock() {
            const clock = document.querySelector('#clock');
            if (clock) {
                const now = new Date();
                clock.textContent = now.toUTCString().split(' ')[4];
            }
        }
        updateClock();
        setInterval(updateClock, 1000);
    }
}

// Dashboard View
class DashboardView extends Component {
    constructor() {
        super(() => {
            const bots = store.get('bots') || [];
            const username = store.get('user')?.username || 'User';
            
            return `
                <nav class="dashboard-nav">
                    <div class="nav-brand">🤖 NEXUS BOTHOST</div>
                    <div class="nav-user">
                        <span>👋 ${escapeHtml(username)}</span>
                        <a href="/logout" class="logout-btn" data-nav="false">🚪 Logout</a>
                    </div>
                </nav>

                <div class="container">
                    <div class="header">
                        <h1>Your Bots</h1>
                        <button class="btn add-bot-btn" onclick="showAddBotModal()">+ Add New Bot</button>
                    </div>

                    <div class="bots-grid" id="botsGrid">
                        ${bots.length === 0 ? `
                            <div class="empty-state">
                                <p>No bots yet. Click "Add New Bot" to get started!</p>
                                <p>You'll need to upload a Python file for your bot.</p>
                            </div>
                        ` : bots.map(bot => `
                            <div class="bot-card" data-bot-id="${bot.bot_id}">
                                <div class="bot-name">
                                    ${escapeHtml(bot.bot_name)}
                                    ${!bot.deps_installed ? `
                                        <span class="deps-badge"><span class="spinner"></span> Installing deps</span>
                                    ` : ''}
                                </div>
                                <div class="bot-id">ID: ${bot.bot_id}</div>
                                <div class="bot-status status-${bot.status}">${bot.status.toUpperCase()}</div>
                                <div class="messages-count">📨 ${bot.total_messages || 0} messages processed</div>
                                <div class="bot-actions">
                                    <button class="btn btn-start" onclick="controlBot('${bot.bot_id}', 'start')">▶ Start</button>
                                    <button class="btn btn-stop" onclick="controlBot('${bot.bot_id}', 'stop')">⏹ Stop</button>
                                    <a href="/bot_console/${bot.bot_id}" class="btn btn-console" data-nav="false">📟 Console</a>
                                    <button class="btn btn-delete" onclick="deleteBot('${bot.bot_id}')">🗑 Delete</button>
                                </div>
                                <button class="btn btn-upload" onclick="showUploadModal('${bot.bot_id}')">📤 Upload New Version</button>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Add Bot Modal -->
                <div id="addBotModal" class="modal">
                    <div class="modal-content">
                        <h2>Add New Bot</h2>
                        <form id="addBotForm" enctype="multipart/form-data">
                            <input type="text" id="botName" placeholder="Bot Name" required>
                            <input type="text" id="botToken" placeholder="Bot Token (from @BotFather)" required>
                            <input type="file" id="botFile" accept=".py" required>
                            <div class="file-info">📄 Upload your bot's Python file (max 100MB)</div>
                            <div class="file-info">⚙️ Dependencies will be auto-installed</div>
                            <button type="submit">Create Bot</button>
                            <button type="button" onclick="closeModal()">Cancel</button>
                        </form>
                    </div>
                </div>

                <!-- Upload Modal -->
                <div id="uploadModal" class="modal">
                    <div class="modal-content">
                        <h2>Upload New Bot Version</h2>
                        <form id="uploadForm" enctype="multipart/form-data">
                            <input type="file" id="uploadFile" accept=".py" required>
                            <div class="file-info">📄 Upload your updated Python file (max 100MB)</div>
                            <div class="file-info">⚙️ Dependencies will be auto-installed</div>
                            <button type="submit">Upload</button>
                            <button type="button" onclick="closeUploadModal()">Cancel</button>
                        </form>
                    </div>
                </div>
            `;
        });
    }

    afterMount() {
        // Bind modal controls
        window.showAddBotModal = () => {
            const modal = document.getElementById('addBotModal');
            if (modal) modal.style.display = 'flex';
        };

        window.closeModal = () => {
            const modal = document.getElementById('addBotModal');
            if (modal) {
                modal.style.display = 'none';
                document.getElementById('addBotForm')?.reset();
            }
        };

        window.showUploadModal = (botId) => {
            window._uploadBotId = botId;
            const modal = document.getElementById('uploadModal');
            if (modal) modal.style.display = 'flex';
        };

        window.closeUploadModal = () => {
            const modal = document.getElementById('uploadModal');
            if (modal) {
                modal.style.display = 'none';
                document.getElementById('uploadForm')?.reset();
            }
        };

        // Add bot form
        document.getElementById('addBotForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData();
            formData.append('bot_name', document.getElementById('botName').value);
            formData.append('bot_token', document.getElementById('botToken').value);
            formData.append('bot_file', document.getElementById('botFile').files[0]);

            try {
                const response = await fetch('/api/bots', { method: 'POST', body: formData });
                if (response.ok) {
                    showToast('Bot created! Dependencies installing...');
                    closeModal();
                    await refreshBots();
                } else {
                    const error = await response.json();
                    showToast('Failed: ' + (error.error || 'Unknown error'), 'error');
                }
            } catch (err) {
                showToast('Network error: ' + err.message, 'error');
            }
        });

        // Upload form
        document.getElementById('uploadForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const botId = window._uploadBotId;
            const formData = new FormData();
            formData.append('bot_file', document.getElementById('uploadFile').files[0]);

            try {
                const response = await fetch(`/api/bots/${botId}/upload`, { method: 'POST', body: formData });
                if (response.ok) {
                    showToast('Bot code updated! Dependencies installing...');
                    closeUploadModal();
                    await refreshBots();
                } else {
                    const error = await response.json();
                    showToast('Failed: ' + (error.error || 'Unknown error'), 'error');
                }
            } catch (err) {
                showToast('Network error: ' + err.message, 'error');
            }
        });

        // Bot control functions
        window.controlBot = async (botId, action) => {
            try {
                const response = await fetch(`/api/bots/${botId}/${action}`, { method: 'POST' });
                const result = await response.json();
                if (response.ok) {
                    if (result.status === 'deps_installing') {
                        showToast('Dependencies still installing. Please wait.', 'error');
                    } else {
                        showToast(`Bot ${action}ed successfully`);
                        await refreshBots();
                    }
                } else {
                    showToast(`Failed to ${action} bot`, 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        };

        window.deleteBot = async (botId) => {
            if (!confirm('Are you sure you want to delete this bot?')) return;
            try {
                const response = await fetch(`/api/bots/${botId}`, { method: 'DELETE' });
                if (response.ok) {
                    showToast('Bot deleted');
                    await refreshBots();
                } else {
                    showToast('Failed to delete bot', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        };

        // Close modals on outside click
        document.addEventListener('click', (e) => {
            const addModal = document.getElementById('addBotModal');
            const uploadModal = document.getElementById('uploadModal');
            if (e.target === addModal) closeModal();
            if (e.target === uploadModal) closeUploadModal();
        });

        // Initial refresh
        refreshBots();
    }
}

// ─── API HELPERS ──────────────────────────────────
async function apiFetch(endpoint, options = {}) {
    const response = await fetch(endpoint, {
        ...options,
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
}

async function refreshBots() {
    try {
        const bots = await apiFetch('/api/bots');
        store.set('bots', bots);
        return bots;
    } catch (err) {
        console.error('Failed to refresh bots:', err);
        return [];
    }
}

async function refreshMyBots() {
    try {
        const data = await apiFetch('/api/my/bots');
        store.set('myBots', data.bots || []);
        return data.bots;
    } catch (err) {
        console.error('Failed to refresh my bots:', err);
        return [];
    }
}

// ─── TOAST SYSTEM ─────────────────────────────────
let toastTimeout;

function showToast(message, type = 'success') {
    // Remove existing toast
    const existing = document.getElementById('toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.borderLeftColor = type === 'error' ? 'var(--red)' : 'var(--green)';
    document.body.appendChild(toast);

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, CONFIG.TOAST_DURATION);
}

// ─── UTILITY FUNCTIONS ───────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const d = new Date(dateStr);
        return d.toLocaleString();
    } catch {
        return dateStr;
    }
}

function debounce(fn, delay = CONFIG.DEBOUNCE_DELAY) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ─── ROUTER INSTANCE ──────────────────────────────
const router = new Router();

// ─── REGISTER ROUTES ──────────────────────────────
router
    .register('/', () => {
        // Check if user is logged in
        fetch('/api/user')
            .then(r => r.json())
            .then(user => {
                if (user && user.id) {
                    store.set('user', user);
                    if (user.is_admin) {
                        router.navigate('/admin');
                    } else {
                        router.navigate('/dashboard');
                    }
                } else {
                    router.navigate('/login');
                }
            })
            .catch(() => router.navigate('/login'));
    })
    .register('/login', () => {
        const container = document.getElementById('app');
        const view = new LoginView();
        view.mount(container);
    })
    .register('/dashboard', () => {
        const container = document.getElementById('app');
        const view = new DashboardView();
        view.mount(container);
        
        // Load user data
        fetch('/api/user')
            .then(r => r.json())
            .then(user => {
                if (user && user.id) {
                    store.set('user', user);
                }
            })
            .catch(() => {});
    })
    .register('/admin', () => {
        // Admin view will be loaded
        loadAdminView();
    })
    .register('/admin/bots', () => loadAdminBotsView())
    .register('/admin/users', () => loadAdminUsersView())
    .register('/admin/logs', () => loadAdminLogsView())
    .register('/admin/settings', () => loadAdminSettingsView())
    .register('/bot_console/:id', (params) => {
        loadBotConsole(params.id);
    })
    .register('/404', () => {
        document.getElementById('app').innerHTML = `
            <div class="error-page">
                <h1>404</h1>
                <p>Page not found</p>
                <a href="/">Go home</a>
            </div>
        `;
    });

// ─── ADMIN VIEW LOADERS ───────────────────────────
async function loadAdminView() {
    const container = document.getElementById('app');
    try {
        const [stats, trends, users, bots, logs] = await Promise.all([
            apiFetch('/api/admin/stats'),
            apiFetch('/api/admin/trends'),
            apiFetch('/admin/users').then(r => r.json()).catch(() => []),
            apiFetch('/admin/bots').then(r => r.json()).catch(() => []),
            apiFetch('/admin/logs?ajax=1').then(r => r.json()).catch(() => [])
        ]);

        container.innerHTML = renderAdminDashboard(stats, trends, users, bots, logs);
        initAdminDashboard();
    } catch (err) {
        container.innerHTML = `<div class="error-page"><p>Error loading admin dashboard: ${err.message}</p></div>`;
    }
}

function renderAdminDashboard(stats, trends, users, bots, logs) {
    return `
        <nav class="admin-nav">
            <div class="nav-brand">🤖 NEXUS Host <span>ADMIN v3.0</span></div>
            <div class="nav-links">
                <a href="/admin" class="active">📊 Dashboard</a>
                <a href="/admin/users">👥 Users</a>
                <a href="/admin/bots">🤖 Bots</a>
                <a href="/admin/logs">📋 Logs</a>
                <a href="/admin/settings">⚙ Settings</a>
                <span class="welcome">Welcome, ${escapeHtml(store.get('user')?.username || 'Admin')}</span>
                <a href="/logout" class="logout-btn">🚪 Logout</a>
            </div>
        </nav>

        <div class="container">
            <div class="stats-grid">
                ${renderStatCard('👥', stats.total_users || 0, 'Total Users', trends.users_trend, trends.users_trend_direction, trends.users_trend_period)}
                ${renderStatCard('🤖', stats.total_bots || 0, 'Total Bots', trends.bots_trend, trends.bots_trend_direction, trends.bots_trend_period)}
                ${renderStatCard('⚡', stats.active_bots || 0, 'Active Bots', trends.active_trend, trends.active_trend_direction, trends.active_trend_period)}
                ${renderStatCard('💬', stats.total_messages || 0, 'Total Messages', trends.messages_trend, trends.messages_trend_direction, trends.messages_trend_period)}
            </div>

            <div class="section">
                <div class="section-title">👑 Admin Actions</div>
                <div class="admin-action-group">
                    <button class="create-bot-btn" onclick="window.showAdminCreateBot()">➕ Create Bot for Any User</button>
                    <button class="create-bot-btn" onclick="window.showSystemHealth()" style="background: var(--purple); color: #150f24;">🩺 System Health</button>
                    <button class="create-bot-btn" onclick="window.exportData()" style="background: var(--accent2); color: #06201c;">📥 Export Data</button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">📊 Recent Bots</div>
                <div class="table-responsive">
                    <table>
                        <thead><tr><th>Bot Name</th><th>Owner</th><th>Status</th><th>Messages</th><th>Created</th><th>Actions</th></tr></thead>
                        <tbody>
                            ${bots.slice(0, 10).map(bot => `
                                <tr>
                                    <td><strong>${escapeHtml(bot.bot_name)}</strong></td>
                                    <td>${escapeHtml(bot.username)}</td>
                                    <td><span class="badge badge-${bot.status}">${bot.status.toUpperCase()}</span></td>
                                    <td>${bot.total_messages || 0}</td>
                                    <td>${formatDate(bot.created_at)}</td>
                                    <td>
                                        <button class="btn btn-start" onclick="adminControlBot('${bot.bot_id}', 'start')">▶ Start</button>
                                        <button class="btn btn-stop" onclick="adminControlBot('${bot.bot_id}', 'stop')">⏹ Stop</button>
                                        <a href="/bot_console/${bot.bot_id}" class="btn btn-console">📟 Console</a>
                                        <button class="btn btn-delete" onclick="adminDeleteBot('${bot.bot_id}')">🗑 Delete</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function renderStatCard(icon, number, label, trend, direction, period) {
    const trendClass = direction === 'up' ? 'trend-up' : 'trend-down';
    const trendIcon = direction === 'up' ? '↑' : '↓';
    return `
        <div class="stat-card">
            <div class="stat-icon">${icon}</div>
            <div class="stat-number">${number}</div>
            <div class="stat-label">${label}</div>
            <div class="stat-trend">
                <span class="${trendClass}">
                    <span class="trend-icon">${trendIcon}</span>
                    ${Math.abs(trend || 0)}%
                </span>
                <span>${period || ''}</span>
            </div>
        </div>
    `;
}

function initAdminDashboard() {
    // Admin bot controls
    window.adminControlBot = async (botId, action) => {
        try {
            const response = await fetch(`/admin/bot/${botId}/${action}`, { method: 'POST' });
            if (response.ok) {
                showToast(`Bot ${action}ed successfully`);
                setTimeout(() => router.navigate('/admin', false), 500);
            } else {
                showToast(`Failed to ${action} bot`, 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    };

    window.adminDeleteBot = async (botId) => {
        if (!confirm('Delete this bot permanently?')) return;
        try {
            const response = await fetch(`/admin/bot/${botId}/delete`, { method: 'POST' });
            if (response.ok) {
                showToast('Bot deleted');
                setTimeout(() => router.navigate('/admin', false), 500);
            } else {
                showToast('Failed to delete bot', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    };

    window.showAdminCreateBot = () => {
        // Load the create bot modal
        fetch('/admin/create_bot')
            .then(r => r.text())
            .then(html => {
                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.style.display = 'flex';
                modal.innerHTML = html;
                document.body.appendChild(modal);
                
                // Handle form submission
                modal.querySelector('form')?.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    try {
                        const response = await fetch('/admin/create_bot', { method: 'POST', body: formData });
                        if (response.ok) {
                            showToast('Bot created successfully');
                            modal.remove();
                            setTimeout(() => router.navigate('/admin', false), 500);
                        } else {
                            const error = await response.json();
                            showToast('Failed: ' + (error.error || 'Unknown error'), 'error');
                        }
                    } catch (err) {
                        showToast('Error: ' + err.message, 'error');
                    }
                });
                
                modal.querySelector('[onclick*="close"]')?.addEventListener('click', () => modal.remove());
            })
            .catch(err => showToast('Error loading form: ' + err.message, 'error'));
    };

    window.showSystemHealth = async () => {
        try {
            const health = await apiFetch('/admin/health');
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2>🩺 System Health</h2>
                    <div class="health-grid">
                        <div class="health-item"><strong>🖥️ CPU Usage</strong><span>${health.cpu || 'N/A'}%</span></div>
                        <div class="health-item"><strong>💾 Memory</strong><span>${health.memory || 'N/A'} / ${health.memory_total || 'N/A'} MB</span></div>
                        <div class="health-item"><strong>📀 Disk</strong><span>${health.disk || 'N/A'} / ${health.disk_total || 'N/A'} GB</span></div>
                        <div class="health-item"><strong>⏱️ Uptime</strong><span>${health.uptime || 'N/A'}</span></div>
                        <div class="health-item"><strong>🤖 Active Bots</strong><span>${health.active_bots || 0}</span></div>
                        <div class="health-item"><strong>⏱️ Bot Runtime</strong><span>${health.total_bot_runtime || 0}h</span></div>
                    </div>
                    <button onclick="this.closest('.modal').remove()">Close</button>
                </div>
            `;
            document.body.appendChild(modal);
        } catch (err) {
            showToast('Error loading health data: ' + err.message, 'error');
        }
    };

    window.exportData = () => {
        window.location.href = '/admin/export/data';
    };
}

// ─── LOAD BOT CONSOLE ────────────────────────────
async function loadBotConsole(botId) {
    const container = document.getElementById('app');
    try {
        const bot = await apiFetch(`/api/bots/${botId}/info`).catch(() => null);
        if (!bot) {
            container.innerHTML = `<div class="error-page"><p>Bot not found</p><a href="/dashboard">Go back</a></div>`;
            return;
        }

        container.innerHTML = `
            <nav>
                <div class="nav-brand">🤖 NEXUS <span class="tag">CONSOLE</span></div>
                <a href="/dashboard" class="back-btn">← Dashboard</a>
            </nav>

            <div class="container">
                <div class="bot-info">
                    <div class="bot-header">
                        <span class="status-badge" id="statusBadge"></span>
                        <span class="bot-name">${escapeHtml(bot.bot_name)}</span>
                        <span class="bot-status" id="statusText">${bot.status.toUpperCase()}</span>
                        ${!bot.deps_installed ? `
                            <span class="deps-indicator">
                                <span class="spinner"></span> Installing dependencies…
                            </span>
                        ` : ''}
                    </div>
                    <div class="bot-meta">ID: ${bot.bot_id}</div>
                    <div class="bot-stats">
                        <span id="liveIndicator"><span class="signal-bars"><span></span><span></span><span></span></span> Live</span>
                        <span id="consoleStats">0 lines</span>
                        <span id="runtimeStats">Runtime: 0s</span>
                    </div>
                    <div class="controls">
                        <button class="btn btn-start" onclick="consoleControl('${botId}', 'start')">▶ Start</button>
                        <button class="btn btn-stop" onclick="consoleControl('${botId}', 'stop')">⏹ Stop</button>
                        <button class="btn btn-restart" onclick="consoleControl('${botId}', 'restart')">↺ Restart</button>
                        <button class="btn btn-clear" onclick="clearConsole()">🗑 Clear</button>
                        <button class="btn btn-copy" onclick="copyLogs()">📋 Copy logs</button>
                        <button class="btn btn-refresh" onclick="refreshConsole()">⟳ Refresh</button>
                        <button class="btn btn-dl" onclick="downloadLogs()">💾 Download</button>
                    </div>
                </div>

                <div class="split-layout">
                    <div class="file-panel">
                        <div class="panel-title">
                            📁 Files
                            <div class="panel-actions">
                                <button class="btn-sm btn-sm-upload" onclick="showUploadModal('${botId}')">↑ Upload</button>
                                <button class="btn-sm btn-sm-new" onclick="showNewFileModal('${botId}')">+ New</button>
                            </div>
                        </div>
                        <input type="text" class="search-box" id="fileSearch" placeholder="Search files…" onkeyup="filterFiles()">
                        <div class="breadcrumb" id="breadcrumb"></div>
                        <div class="file-browser" id="fileBrowser">
                            <div class="info-text">Loading files…</div>
                        </div>
                        <div class="editor-area" id="editorArea">
                            <div class="editor-header">
                                <span class="editor-filename" id="editorFilename"></span>
                                <div style="display:flex;gap:6px;">
                                    <button class="btn btn-start" onclick="saveFile('${botId}')">💾 Save</button>
                                    <button class="btn btn-clear" onclick="closeEditor()">✕ Close</button>
                                </div>
                            </div>
                            <textarea id="editorContent" spellcheck="false"></textarea>
                        </div>
                    </div>

                    <div class="console-panel">
                        <div class="console-header">
                            <div class="panel-title" style="margin:0;">📟 Live Output</div>
                            <div class="console-toolbar">
                                <div id="autoScrollBtn" class="auto-scroll-badge auto-scroll-on" onclick="toggleAutoScroll()">↓ Auto-scroll</div>
                                <span style="font-size:11px;color:var(--green);">⚡ Real-time</span>
                            </div>
                        </div>
                        <div class="console-viewport" id="consoleViewport">
                            <div class="console-spacer" id="consoleSpacer"></div>
                            <div id="consoleRows"></div>
                        </div>
                        <button id="jumpBottomBtn" class="jump-bottom-btn" onclick="jumpToBottom()">
                            ↓ New output <span class="count" id="jumpBottomCount">0</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Initialize console
        initConsole(botId);
        loadFileBrowser(botId);
        startConsolePolling(botId);

    } catch (err) {
        container.innerHTML = `<div class="error-page"><p>Error loading console: ${err.message}</p><a href="/dashboard">Go back</a></div>`;
    }
}

// ─── CONSOLE STATE ───────────────────────────────
let consoleState = {
    botId: null,
    lines: [],
    seenLines: new Set(),
    autoScroll: true,
    unreadLines: 0,
    isRefreshing: false,
    lastLogContent: '',
    refreshInterval: null,
    depsInterval: null,
    runtimeInterval: null,
    botStartTime: null
};

function initConsole(botId) {
    consoleState.botId = botId;
    consoleState.lines = [];
    consoleState.seenLines = new Set();
    consoleState.unreadLines = 0;
    consoleState.autoScroll = true;
    consoleState.botStartTime = null;
    
    // Add initial messages
    addConsoleLine('NEXUS Bot Console v3.1 Ready', 'system');
    addConsoleLine(`Bot ID: ${botId}`, 'system');
    addConsoleLine('File upload supported • max 50 MB', 'system');
    addConsoleLine('Upload main bot file to auto-restart', 'system');
    addConsoleLine('Ctrl+S to save files, Ctrl+L to clear', 'system');

    updateAutoScrollUI();
    updateJumpPill();
}

function addConsoleLine(text, type = 'output') {
    let cls, prefix;
    switch (type) {
        case 'error': cls = 'cl-error'; prefix = '✕ '; break;
        case 'system': cls = 'cl-system'; prefix = '» '; break;
        case 'restart': cls = 'cl-restart'; prefix = '↺ '; break;
        default: cls = 'cl-output'; prefix = '› ';
    }
    
    // ANSI color handling
    const html = prefix + escapeHtml(text);
    consoleState.lines.push({ cls, html });
    
    // Trim if needed
    if (consoleState.lines.length > CONFIG.MAX_LOG_LINES) {
        consoleState.lines.splice(0, consoleState.lines.length - CONFIG.MAX_LOG_LINES);
    }
    
    updateConsoleStats();
    renderConsoleLines();
    
    if (consoleState.autoScroll) {
        const viewport = document.getElementById('consoleViewport');
        if (viewport) {
            requestAnimationFrame(() => {
                viewport.scrollTop = viewport.scrollHeight;
            });
        }
    } else {
        consoleState.unreadLines++;
        updateJumpPill();
    }
}

function renderConsoleLines() {
    const rows = document.getElementById('consoleRows');
    if (!rows) return;
    
    const viewport = document.getElementById('consoleViewport');
    if (!viewport) return;
    
    // Simple rendering - for production, use virtual scrolling
    rows.innerHTML = consoleState.lines.map(l => 
        `<div class="console-line ${l.cls}">${l.html}</div>`
    ).join('');
    
    const spacer = document.getElementById('consoleSpacer');
    if (spacer) {
        const totalHeight = consoleState.lines.length * 20 + 16;
        spacer.style.height = totalHeight + 'px';
    }
}

function updateConsoleStats() {
    const stats = document.getElementById('consoleStats');
    if (stats) stats.textContent = consoleState.lines.length + ' lines';
}

function updateAutoScrollUI() {
    const btn = document.getElementById('autoScrollBtn');
    if (!btn) return;
    if (consoleState.autoScroll) {
        btn.className = 'auto-scroll-badge auto-scroll-on';
        btn.textContent = '↓ Auto-scroll';
    } else {
        btn.className = 'auto-scroll-badge auto-scroll-off';
        btn.textContent = '↓ Paused';
    }
}

function updateJumpPill() {
    const pill = document.getElementById('jumpBottomBtn');
    const count = document.getElementById('jumpBottomCount');
    if (!pill) return;
    if (!consoleState.autoScroll && consoleState.unreadLines > 0) {
        count.textContent = consoleState.unreadLines > 99 ? '99+' : String(consoleState.unreadLines);
        pill.classList.add('visible');
    } else {
        pill.classList.remove('visible');
    }
}

function toggleAutoScroll() {
    consoleState.autoScroll = !consoleState.autoScroll;
    if (consoleState.autoScroll) {
        consoleState.unreadLines = 0;
        updateJumpPill();
        const viewport = document.getElementById('consoleViewport');
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
    updateAutoScrollUI();
}

function jumpToBottom() {
    consoleState.autoScroll = true;
    consoleState.unreadLines = 0;
    updateAutoScrollUI();
    updateJumpPill();
    const viewport = document.getElementById('consoleViewport');
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
}

function refreshConsole() {
    if (consoleState.botId) fetchConsoleLogs(consoleState.botId);
}

function clearConsole() {
    consoleState.lines = [];
    consoleState.seenLines = new Set();
    consoleState.unreadLines = 0;
    renderConsoleLines();
    updateConsoleStats();
    updateJumpPill();
    addConsoleLine('Console cleared', 'system');
    showToast('Console cleared');
}

function copyLogs() {
    const text = consoleState.lines.map(l => {
        const tmp = document.createElement('div');
        tmp.innerHTML = l.html;
        return tmp.textContent;
    }).join('\n');
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied ' + consoleState.lines.length + ' lines');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

function downloadLogs() {
    const text = consoleState.lines.map(l => {
        const tmp = document.createElement('div');
        tmp.innerHTML = l.html;
        return tmp.textContent;
    }).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bot_${consoleState.botId}_logs_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded ' + consoleState.lines.length + ' lines');
}

async function consoleControl(botId, action) {
    try {
        const response = await fetch(`/api/bots/${botId}/${action}`, { method: 'POST' });
        const result = await response.json();
        if (response.ok) {
            addConsoleLine(`Bot ${action}ed successfully`, 'system');
            showToast(`Bot ${action}ed`);
            if (action === 'start' || action === 'restart') {
                consoleState.botStartTime = Date.now();
            }
            await fetchConsoleLogs(botId);
        } else {
            addConsoleLine(`Failed: ${result.error || 'Unknown error'}`, 'error');
            showToast(`Failed: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (err) {
        addConsoleLine('Error: ' + err.message, 'error');
        showToast('Error: ' + err.message, 'error');
    }
}

async function fetchConsoleLogs(botId) {
    if (consoleState.isRefreshing) return;
    consoleState.isRefreshing = true;
    
    try {
        const response = await fetch(`/api/bots/${botId}/logs`);
        const data = await response.json();
        
        if (data.logs && data.logs !== consoleState.lastLogContent) {
            consoleState.lastLogContent = data.logs;
            
            const newLines = data.logs.split('\n').filter(t => t.trim());
            for (const raw of newLines) {
                const trimmed = raw.trim();
                if (!trimmed || consoleState.seenLines.has(trimmed)) continue;
                consoleState.seenLines.add(trimmed);
                
                let type = 'output';
                if (/error|failed|❌/i.test(trimmed)) type = 'error';
                else if (/restart|🔄/i.test(trimmed)) type = 'restart';
                else if (/✅|💡|📦/i.test(trimmed)) type = 'system';
                
                addConsoleLine(trimmed, type);
            }
        }
    } catch (err) {
        // Silent fail
    } finally {
        consoleState.isRefreshing = false;
    }
}

function startConsolePolling(botId) {
    if (consoleState.refreshInterval) clearInterval(consoleState.refreshInterval);
    consoleState.refreshInterval = setInterval(() => {
        fetchConsoleLogs(botId);
    }, CONFIG.REFRESH_INTERVAL / 10); // 3 seconds
}

// ─── FILE BROWSER ──────────────────────────────────
let currentFileBrowserPath = '';
let currentEditFile = null;

async function loadFileBrowser(botId, path = '') {
    try {
        const response = await fetch(`/api/bots/${botId}/files?path=${encodeURIComponent(path)}`);
        const data = await response.json();
        
        if (data.error) {
            document.getElementById('fileBrowser').innerHTML = 
                `<div class="info-text">Error: ${escapeHtml(data.error)}</div>`;
            return;
        }
        
        currentFileBrowserPath = data.current_path;
        
        // Build breadcrumb
        let crumbHtml = `<a onclick="loadFileBrowser('${botId}', '')">root</a>`;
        for (const c of data.breadcrumb) {
            crumbHtml += `<span style="color:var(--muted);">/</span><a onclick="loadFileBrowser('${botId}', '${c.path.replace(/'/g, "\\'")}')">${escapeHtml(c.name)}</a>`;
        }
        document.getElementById('breadcrumb').innerHTML = crumbHtml;
        
        // Build file list
        const browser = document.getElementById('fileBrowser');
        let html = '';
        
        if (data.parent_path !== null) {
            html += `<div class="file-item folder folder-parent" onclick="loadFileBrowser('${botId}', '${data.parent_path}')">
                        <div class="name">📁 .. (parent)</div></div>`;
        }
        
        if (data.files.length === 0) {
            html += '<div class="info-text">Empty. Upload or create a file.</div>';
        }
        
        for (const file of data.files) {
            const icon = file.is_dir ? '📁' : getFileIcon(file.name);
            const isTxt = isTextFile(file.name);
            const click = file.is_dir ? 
                `loadFileBrowser('${botId}', '${file.path}')` :
                isTxt ? `editFile('${botId}', '${file.path}')` : `downloadFile('${botId}', '${file.path}')`;
            
            html += `<div class="file-item ${file.is_dir ? 'folder' : ''}">
                <div class="name" onclick="${click}">
                    <span>${icon}</span>
                    <span>${escapeHtml(file.name)}</span>
                    ${!file.is_dir ? `<span style="font-size:10px;color:var(--muted);">${file.size_text}</span>` : ''}
                </div>
                <div class="file-actions">
                    ${!file.is_dir && isTxt ? 
                        `<button class="edit-btn" onclick="event.stopPropagation();editFile('${botId}', '${file.path}')">Edit</button>` : 
                        !file.is_dir ? 
                        `<button class="edit-btn" onclick="event.stopPropagation();downloadFile('${botId}', '${file.path}')">Download</button>` : ''}
                    <button class="delete-btn" onclick="event.stopPropagation();confirmDelete('${botId}', '${file.path}', ${file.is_dir})">Delete</button>
                </div>
            </div>`;
        }
        
        browser.innerHTML = html;
    } catch (err) {
        document.getElementById('fileBrowser').innerHTML = 
            `<div class="info-text">Error: ${escapeHtml(err.message)}</div>`;
    }
}

function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
        py: '🐍', js: '📜', html: '🌐', css: '🎨', json: '📦',
        md: '📝', txt: '📄', yml: '⚙️', yaml: '⚙️', ini: '⚙️',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️',
        zip: '📦', tar: '📦', gz: '📦', pdf: '📑',
        mp3: '🎵', mp4: '🎬', wav: '🎵'
    };
    return icons[ext] || '📄';
}

function isTextFile(name) {
    const exts = ['.py', '.js', '.html', '.css', '.json', '.txt', '.md', '.yml', '.yaml', '.xml', '.sh', '.env', '.cfg', '.ini'];
    return exts.some(e => name.endsWith(e));
}

function filterFiles() {
    const query = document.getElementById('fileSearch')?.value.toLowerCase() || '';
    const items = document.querySelectorAll('.file-item:not(.folder-parent)');
    items.forEach(el => {
        const name = el.querySelector('.name span:last-child')?.textContent?.toLowerCase() || '';
        el.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

async function editFile(botId, path) {
    try {
        const response = await fetch(`/api/bots/${botId}/file?path=${encodeURIComponent(path)}`);
        const data = await response.json();
        if (data.error) {
            showToast('Error: ' + data.error, 'error');
            return;
        }
        currentEditFile = path;
        document.getElementById('editorFilename').textContent = '✏ ' + path;
        document.getElementById('editorContent').value = data.content;
        document.getElementById('editorArea').style.display = 'block';
        document.getElementById('editorContent').focus();
        showToast('Opened: ' + path);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function saveFile(botId) {
    if (!currentEditFile) return;
    try {
        const response = await fetch(`/api/bots/${botId}/file`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: currentEditFile,
                content: document.getElementById('editorContent').value
            })
        });
        const data = await response.json();
        if (data.success) {
            addConsoleLine(`Saved: ${currentEditFile}`, 'system');
            showToast('Saved');
            loadFileBrowser(botId, currentFileBrowserPath);
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    }
}

function closeEditor() {
    document.getElementById('editorArea').style.display = 'none';
    currentEditFile = null;
    document.getElementById('editorContent').value = '';
}

function downloadFile(botId, path) {
    window.location.href = `/api/bots/${botId}/download?path=${encodeURIComponent(path)}`;
}

function confirmDelete(botId, path, isDir) {
    if (confirm(`Delete ${isDir ? 'folder' : 'file'} "${path}"? This cannot be undone.`)) {
        deleteFile(botId, path);
    }
}

async function deleteFile(botId, path) {
    try {
        const response = await fetch(`/api/bots/${botId}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            addConsoleLine(`Deleted: ${path}`, 'system');
            showToast('Deleted');
            loadFileBrowser(botId, currentFileBrowserPath);
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    }
}

function showUploadModal(botId) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>↑ Upload File</h2>
            <div class="upload-area" id="dropZone">
                <div style="color:var(--muted);font-size:13px;margin-bottom:8px;">Drag & drop files here, or click below</div>
                <input type="file" id="fileInput" class="upload-input" multiple>
                <label for="fileInput" class="upload-label">📂 Choose Files</label>
                <div class="auto-restart-toggle">
                    <input type="checkbox" id="autoRestartToggle" checked>
                    <span>Auto-restart when uploading main .py file</span>
                </div>
                <div class="upload-progress" id="uploadProgress" style="display:none;">
                    <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
                    <div style="font-size:11px;margin-top:4px;color:var(--muted);" id="progressText">Uploading…</div>
                </div>
                <div class="upload-list" id="uploadList"></div>
            </div>
            <button onclick="this.closest('.modal').remove()" class="btn-cancel" style="margin-top:10px;background:var(--panel);color:var(--muted);border:1px solid var(--border);border-radius:8px;padding:8px;width:100%;cursor:pointer;font-weight:600;">Close</button>
        </div>
    `;
    document.body.appendChild(modal);

    // Set up file input
    const fileInput = modal.querySelector('#fileInput');
    const dropZone = modal.querySelector('#dropZone');
    
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            uploadFiles(botId, fileInput.files, modal);
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
            uploadFiles(botId, e.dataTransfer.files, modal);
        }
    });
}

async function uploadFiles(botId, files, modal) {
    const list = modal.querySelector('#uploadList');
    const progress = modal.querySelector('#uploadProgress');
    const fill = modal.querySelector('#progressFill');
    const autoRestart = modal.querySelector('#autoRestartToggle')?.checked ?? true;
    
    progress.style.display = 'block';
    list.innerHTML = '';
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const item = document.createElement('div');
        item.className = 'upload-item';
        item.innerHTML = `
            <div class="upload-item-name">
                <span>${getFileIcon(file.name)}</span>
                <span>${escapeHtml(file.name)}</span>
                <span style="color:var(--muted);font-size:10px;">(${formatFileSize(file.size)})</span>
            </div>
            <span class="upload-item-status status-uploading">Uploading…</span>
        `;
        list.appendChild(item);

        const formData = new FormData();
        const path = currentFileBrowserPath ? currentFileBrowserPath + '/' + file.name : file.name;
        formData.append('path', path);
        formData.append('file', file);
        if (autoRestart) formData.append('auto_restart', 'true');

        try {
            const response = await fetch(`/api/bots/${botId}/upload_file`, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            const status = item.querySelector('.upload-item-status');
            if (data.success) {
                if (data.auto_restarted) {
                    status.className = 'upload-item-status status-restarted';
                    status.textContent = '↺ Restarted';
                    addConsoleLine(`Uploaded: ${file.name} (auto-restarted)`, 'restart');
                } else {
                    status.className = 'upload-item-status status-success';
                    status.textContent = '✓ Uploaded';
                    addConsoleLine(`Uploaded: ${file.name}`, 'system');
                }
            } else {
                status.className = 'upload-item-status status-error';
                status.textContent = '✕ Failed';
                addConsoleLine(`Upload failed: ${file.name} — ${data.error}`, 'error');
            }
        } catch (err) {
            const status = item.querySelector('.upload-item-status');
            status.className = 'upload-item-status status-error';
            status.textContent = '✕ Error';
            addConsoleLine(`Upload error: ${file.name} — ${err.message}`, 'error');
        }
        fill.style.width = ((i + 1) / files.length * 100) + '%';
    }

    setTimeout(() => {
        modal.remove();
        loadFileBrowser(botId, currentFileBrowserPath);
        showToast('Upload complete');
    }, 1500);
}

function showNewFileModal(botId) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>📄 Create New File</h3>
            <input type="text" id="newFileName" placeholder="filename.py" autocomplete="off">
            <button onclick="createNewFile('${botId}')">Create</button>
            <button onclick="this.closest('.modal').remove()" class="btn-cancel">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#newFileName').focus();
    modal.querySelector('#newFileName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createNewFile(botId);
    });
}

async function createNewFile(botId) {
    const name = document.getElementById('newFileName')?.value.trim();
    if (!name) {
        showToast('Enter a filename', 'error');
        return;
    }
    const path = currentFileBrowserPath ? currentFileBrowserPath + '/' + name : name;
    try {
        const response = await fetch(`/api/bots/${botId}/file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: path,
                content: `# ${name}\n# Created: ${new Date().toISOString()}\n\n`
            })
        });
        const data = await response.json();
        if (data.success) {
            document.querySelector('.modal')?.remove();
            loadFileBrowser(botId, currentFileBrowserPath);
            if (isTextFile(name)) editFile(botId, path);
            addConsoleLine(`Created: ${path}`, 'system');
            showToast('Created: ' + name);
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// ─── ADMIN VIEWS (Bots, Users, Logs, Settings) ──
async function loadAdminBotsView() {
    const container = document.getElementById('app');
    try {
        const bots = await apiFetch('/admin/bots').then(r => r.json()).catch(() => []);
        container.innerHTML = `
            <nav class="admin-nav">
                <div class="nav-brand">🤖 NEXUS <span class="tag">ADMIN</span></div>
                <div class="nav-links">
                    <a href="/admin">📊 Dashboard</a>
                    <a href="/admin/users">👥 Users</a>
                    <a href="/admin/bots" class="active">🤖 Bots</a>
                    <a href="/admin/logs">📋 Logs</a>
                    <a href="/admin/settings">⚙ Settings</a>
                    <span class="welcome">Welcome, ${escapeHtml(store.get('user')?.username || 'Admin')}</span>
                    <a href="/logout" class="logout-btn">🚪 Logout</a>
                </div>
            </nav>
            <div class="container">
                <div class="section">
                    <div class="section-header">
                        <div class="section-title">📊 All Bots</div>
                        <div class="filter-group">
                            <input type="text" class="search-box" id="searchInput" placeholder="Search by name, owner, or ID…" onkeyup="filterBotsTable()">
                            <select id="statusFilter" class="status-filter" onchange="filterBotsTable()">
                                <option value="all">All Status</option>
                                <option value="running">Running</option>
                                <option value="stopped">Stopped</option>
                            </select>
                            <span class="stats-info" id="botCount"></span>
                        </div>
                    </div>
                    <div class="table-responsive">
                        <table>
                            <thead><tr><th>Bot Name</th><th>Bot ID</th><th>Owner</th><th>Status</th><th>Messages</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody id="botsTableBody">
                                ${bots.map(bot => `
                                    <tr data-bot-name="${bot.bot_name.toLowerCase()}" data-owner="${bot.username.toLowerCase()}" data-status="${bot.status}">
                                        <td><strong>${escapeHtml(bot.bot_name)}</strong></td>
                                        <td><code style="font-size:11px;">${bot.bot_id.slice(0, 12)}...</code></td>
                                        <td>${escapeHtml(bot.username)}</td>
                                        <td><span class="badge badge-${bot.status}">${bot.status.toUpperCase()}</span></td>
                                        <td>${bot.total_messages || 0}</td>
                                        <td>${formatDate(bot.created_at)}</td>
                                        <td>
                                            <button class="btn btn-start" onclick="adminControlBot('${bot.bot_id}', 'start')">▶ Start</button>
                                            <button class="btn btn-stop" onclick="adminControlBot('${bot.bot_id}', 'stop')">⏹ Stop</button>
                                            <a href="/bot_console/${bot.bot_id}" class="btn btn-console">📟 Console</a>
                                            <button class="btn btn-delete" onclick="adminDeleteBot('${bot.bot_id}')">🗑 Delete</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        window.filterBotsTable = () => {
            const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
            const status = document.getElementById('statusFilter')?.value || 'all';
            const rows = document.querySelectorAll('#botsTableBody tr');
            let visible = 0;
            rows.forEach(row => {
                const name = row.getAttribute('data-bot-name') || '';
                const owner = row.getAttribute('data-owner') || '';
                const rowStatus = row.getAttribute('data-status') || '';
                const match = (!search || name.includes(search) || owner.includes(search)) &&
                             (status === 'all' || rowStatus === status);
                row.style.display = match ? '' : 'none';
                if (match) visible++;
            });
            document.getElementById('botCount').textContent = `Showing ${visible} of ${rows.length} bots`;
        };
        setTimeout(window.filterBotsTable, 100);
    } catch (err) {
        container.innerHTML = `<div class="error-page"><p>Error loading bots: ${err.message}</p></div>`;
    }
}

async function loadAdminUsersView() {
    const container = document.getElementById('app');
    try {
        const users = await apiFetch('/admin/users').then(r => r.json()).catch(() => []);
        container.innerHTML = `
            <nav class="admin-nav">
                <div class="nav-brand">🤖 NEXUS <span class="tag">ADMIN</span></div>
                <div class="nav-links">
                    <a href="/admin">📊 Dashboard</a>
                    <a href="/admin/users" class="active">👥 Users</a>
                    <a href="/admin/bots">🤖 Bots</a>
                    <a href="/admin/logs">📋 Logs</a>
                    <a href="/admin/settings">⚙ Settings</a>
                    <span class="welcome">Welcome, ${escapeHtml(store.get('user')?.username || 'Admin')}</span>
                    <a href="/logout" class="logout-btn">🚪 Logout</a>
                </div>
            </nav>
            <div class="container">
                <div class="section">
                    <div class="section-header">
                        <div class="section-title">👥 User Management</div>
                        <div>
                            <input type="text" class="search-box" id="searchInput" placeholder="🔍 Search users..." onkeyup="filterUsersTable()">
                            <span class="stats-info" id="userCount"></span>
                        </div>
                    </div>
                    <div class="table-responsive">
                        <table>
                            <thead><tr><th>ID</th><th>Username</th><th>Email</th><th>Role</th><th>Joined</th><th>Last Login</th><th>Bots</th><th>Actions</th></tr></thead>
                            <tbody id="usersTableBody">
                                ${users.map(user => `
                                    <tr data-username="${user.username.toLowerCase()}" data-user-id="${user.id}">
                                        <td>${user.id}</td>
                                        <td>
                                            ${escapeHtml(user.username)}
                                            ${user.username === store.get('user')?.username ? '<span class="badge badge-you">you</span>' : ''}
                                        </td>
                                        <td>${escapeHtml(user.email || 'N/A')}</td>
                                        <td><span class="badge badge-${user.is_admin ? 'admin' : 'user'}">${user.is_admin ? 'Admin' : 'User'}</span></td>
                                        <td>${formatDate(user.created_at)}</td>
                                        <td>${formatDate(user.last_login)}</td>
                                        <td><span class="bot-count-badge">${user.bots_count || 0} bots</span></td>
                                        <td>
                                            ${!user.is_admin ? 
                                                `<button class="btn btn-delete" onclick="adminDeleteUser(${user.id})">🗑 Delete</button>` :
                                                '<span style="color:var(--muted);font-size:11px;">Protected</span>'
                                            }
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        window.filterUsersTable = () => {
            const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
            const rows = document.querySelectorAll('#usersTableBody tr');
            let visible = 0;
            rows.forEach(row => {
                const username = row.getAttribute('data-username') || '';
                const match = username.includes(search);
                row.style.display = match ? '' : 'none';
                if (match) visible++;
            });
            document.getElementById('userCount').textContent = `Showing ${visible} of ${rows.length} users`;
        };
        
        window.adminDeleteUser = async (userId) => {
            if (!confirm('Delete this user and all their bots?')) return;
            try {
                const response = await fetch(`/admin/user/${userId}/delete`, { method: 'POST' });
                if (response.ok) {
                    showToast('User deleted');
                    setTimeout(() => loadAdminUsersView(), 500);
                } else {
                    const data = await response.json();
                    showToast('Failed: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        };
        
        setTimeout(window.filterUsersTable, 100);
    } catch (err) {
        container.innerHTML = `<div class="error-page"><p>Error loading users: ${err.message}</p></div>`;
    }
}

async function loadAdminLogsView() {
    const container = document.getElementById('app');
    try {
        const logs = await fetch('/admin/logs?ajax=1').then(r => r.json()).catch(() => []);
        container.innerHTML = `
            <nav class="admin-nav">
                <div class="nav-brand">🤖 NEXUS <span class="tag">ADMIN</span></div>
                <div class="nav-links">
                    <a href="/admin">📊 Dashboard</a>
                    <a href="/admin/users">👥 Users</a>
                    <a href="/admin/bots">🤖 Bots</a>
                    <a href="/admin/logs" class="active">📋 Logs</a>
                    <a href="/admin/settings">⚙ Settings</a>
                    <span class="welcome">Welcome, ${escapeHtml(store.get('user')?.username || 'Admin')}</span>
                    <a href="/logout" class="logout-btn">🚪 Logout</a>
                </div>
            </nav>
            <div class="container">
                <div class="section">
                    <div class="section-header">
                        <div class="section-title">📋 Activity Logs</div>
                        <div class="filter-bar">
                            <input type="text" class="filter-input" id="searchUser" placeholder="Filter by user…" onkeyup="filterLogsTable()">
                            <input type="text" class="filter-input" id="searchAction" placeholder="Filter by action…" onkeyup="filterLogsTable()">
                            <select id="levelFilter" class="filter-select" onchange="filterLogsTable()">
                                <option value="all">All Levels</option>
                                <option value="info">Info</option>
                                <option value="warning">Warning</option>
                                <option value="error">Error</option>
                            </select>
                            <button class="clear-btn" onclick="clearLogFilters()">Clear</button>
                            <button class="export-btn" onclick="exportLogs()">↓ Export</button>
                        </div>
                    </div>
                    <div class="logs-container" id="logsContainer">
                        ${logs.map(log => `
                            <div class="log-line" data-username="${(log.username || 'system').toLowerCase()}" data-action="${log.action.toLowerCase()}" data-level="${log.level || 'info'}">
                                <span class="log-time">${(log.timestamp || '').slice(0, 19)}</span> |
                                <span class="log-username">${escapeHtml(log.username || 'system')}</span> |
                                <span class="log-action">${escapeHtml(log.action)}</span>
                                <span class="log-level log-level-${log.level || 'info'}">${(log.level || 'INFO').toUpperCase()}</span>
                                ${log.bot_id ? `| <span class="log-bot">🤖 ${log.bot_id.slice(0, 8)}...</span>` : ''}
                                ${log.details ? `| <span>${escapeHtml(log.details.slice(0, 150))}${log.details.length > 150 ? '...' : ''}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                    <div style="margin-top:14px;text-align:center;">
                        <span class="stats-info" id="logCount"></span>
                    </div>
                </div>
            </div>
        `;
        
        window.filterLogsTable = () => {
            const user = document.getElementById('searchUser')?.value.toLowerCase() || '';
            const action = document.getElementById('searchAction')?.value.toLowerCase() || '';
            const level = document.getElementById('levelFilter')?.value || 'all';
            const lines = document.querySelectorAll('.log-line');
            let visible = 0;
            lines.forEach(line => {
                const username = line.getAttribute('data-username') || '';
                const actionAttr = line.getAttribute('data-action') || '';
                const levelAttr = line.getAttribute('data-level') || 'info';
                const match = (!user || username.includes(user)) &&
                             (!action || actionAttr.includes(action)) &&
                             (level === 'all' || levelAttr === level);
                line.style.display = match ? '' : 'none';
                if (match) visible++;
            });
            document.getElementById('logCount').textContent = `Showing ${visible} of ${lines.length} logs`;
        };
        
        window.clearLogFilters = () => {
            document.getElementById('searchUser').value = '';
            document.getElementById('searchAction').value = '';
            document.getElementById('levelFilter').value = 'all';
            window.filterLogsTable();
        };
        
        window.exportLogs = () => {
            const lines = document.querySelectorAll('.log-line:not([style*="display: none"])');
            let text = '# NEXUS BotHost Activity Logs\n';
            text += `# Exported: ${new Date().toISOString()}\n\n`;
            lines.forEach(line => {
                text += line.textContent.trim() + '\n';
            });
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `logs_export_${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('📥 Logs exported');
        };
        
        setTimeout(window.filterLogsTable, 100);
    } catch (err) {
        container.innerHTML = `<div class="error-page"><p>Error loading logs: ${err.message}</p></div>`;
    }
}

function loadAdminSettingsView() {
    const container = document.getElementById('app');
    container.innerHTML = `
        <nav class="admin-nav">
            <div class="nav-brand">🤖 NEXUS <span class="tag">ADMIN</span></div>
            <div class="nav-links">
                <a href="/admin">📊 Dashboard</a>
                <a href="/admin/users">👥 Users</a>
                <a href="/admin/bots">🤖 Bots</a>
                <a href="/admin/logs">📋 Logs</a>
                <a href="/admin/settings" class="active">⚙ Settings</a>
                <span class="welcome">Welcome, ${escapeHtml(store.get('user')?.username || 'Admin')}</span>
                <a href="/logout" class="logout-btn">🚪 Logout</a>
            </div>
        </nav>
        <div class="container">
            <div class="section">
                <div class="section-title">⚙️ Platform Settings</div>
                <div class="info-text">Settings panel coming soon. Configure:</div>
                <ul class="settings-list">
                    <li><span class="icon">▸</span> Bot execution limits</li>
                    <li><span class="icon">▸</span> Resource allocation</li>
                    <li><span class="icon">▸</span> Logging configuration</li>
                    <li><span class="icon">▸</span> Security policies</li>
                </ul>
            </div>
        </div>
    `;
}

// ─── ADMIN NAVIGATION HELPERS ─────────────────────
// These are exposed globally for onclick handlers
window.adminControlBot = async (botId, action) => {
    try {
        const response = await fetch(`/admin/bot/${botId}/${action}`, { method: 'POST' });
        if (response.ok) {
            showToast(`Bot ${action}ed successfully`);
            setTimeout(() => router.navigate(window.location.pathname, false), 500);
        } else {
            showToast(`Failed to ${action} bot`, 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
};

window.adminDeleteBot = async (botId) => {
    if (!confirm('Delete this bot permanently?')) return;
    try {
        const response = await fetch(`/admin/bot/${botId}/delete`, { method: 'POST' });
        if (response.ok) {
            showToast('Bot deleted');
            setTimeout(() => router.navigate(window.location.pathname, false), 500);
        } else {
            showToast('Failed to delete bot', 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
};

// ─── KEYBOARD SHORTCUTS ───────────────────────────
document.addEventListener('keydown', (e) => {
    // Ctrl+S: Save file if editor is open
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const editor = document.getElementById('editorArea');
        if (editor && editor.style.display !== 'none') {
            e.preventDefault();
            const botId = consoleState.botId;
            if (botId) saveFile(botId);
        }
    }
    
    // Ctrl+L: Clear console
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        const viewport = document.getElementById('consoleViewport');
        if (viewport) {
            e.preventDefault();
            clearConsole();
        }
    }
    
    // Escape: Close modals and editor
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => m.remove());
        closeEditor();
    }
});

// ─── INITIALIZATION ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Create app container
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    
    // Add global styles if not present
    if (!document.getElementById('app-styles')) {
        const style = document.createElement('style');
        style.id = 'app-styles';
        style.textContent = `
            /* Base styles for SPA */
            .error-page { text-align: center; padding: 60px 20px; }
            .error-page h1 { font-size: 48px; color: var(--accent); }
            .error-page a { color: var(--accent2); text-decoration: none; }
            .error-page a:hover { text-decoration: underline; }
            
            .toast {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: var(--panel);
                color: var(--text);
                padding: 12px 20px;
                border-radius: 4px;
                border-left: 3px solid var(--green);
                box-shadow: 0 4px 16px rgba(0,0,0,.5);
                font-family: var(--font-mono);
                font-size: 13px;
                z-index: 1001;
                animation: slideIn 0.3s ease;
                max-width: 400px;
            }
            
            @keyframes slideIn {
                from { opacity: 0; transform: translateX(20px); }
                to { opacity: 1; transform: translateX(0); }
            }
            
            .modal {
                display: none;
                position: fixed;
                top: 0; left: 0;
                width: 100%; height: 100%;
                background: rgba(0,0,0,.8);
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }
            .modal-content {
                background: var(--panel);
                padding: 28px;
                border-radius: 6px;
                width: 90%;
                max-width: 500px;
                border: 1px solid var(--border-hi);
                max-height: 90vh;
                overflow-y: auto;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Start the router
    router.navigate(window.location.pathname);
});

// ─── EXPOSE GLOBALLY FOR ONCLICK HANDLERS ─────────
window.router = router;
window.showToast = showToast;
window.store = store;