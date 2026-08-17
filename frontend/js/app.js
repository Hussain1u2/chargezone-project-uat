const Theme = {
  getStored() {
    return localStorage.getItem('cz_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  },
  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cz_theme', theme);
    const sunIcons = document.querySelectorAll('.theme-icon-sun');
    const moonIcons = document.querySelectorAll('.theme-icon-moon');
    if (theme === 'dark') {
      sunIcons.forEach(i => i.removeAttribute('hidden'));
      moonIcons.forEach(i => i.setAttribute('hidden', 'true'));
    } else {
      sunIcons.forEach(i => i.setAttribute('hidden', 'true'));
      moonIcons.forEach(i => i.removeAttribute('hidden'));
    }
  },
  toggle() {
    const current = this.getStored();
    this.setTheme(current === 'dark' ? 'light' : 'dark');
  },
  init() {
    this.setTheme(this.getStored());
    document.addEventListener('click', (e) => {
      if (e.target.closest('.theme-toggle-btn')) {
        e.preventDefault();
        this.toggle();
      }
    });
  }
};
Theme.init();

const VIEW_RENDERERS = {

  dashboard: renderDashboard,
  purchaseOrders: renderPurchaseOrders,
  stockMove: renderStockMove,
  regionStock: renderRegionStockMonitor,
  requisitions: renderRequisitions,
  transactions: renderTransactions,
  materials: renderMaterials,
  users: renderUsers,
  profile: renderProfile
};

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  purchaseOrders: 'Purchase Orders',
  stockMove: 'Scan & Move Stock',
  regionStock: 'Region Stock Monitor',
  requisitions: 'Requisitions',
  transactions: 'Transactions Ledger',
  materials: 'Materials Master',
  users: 'Users & Regions',
  profile: 'My Profile'
};

let currentViewName = 'dashboard';

async function switchView(view) {
  currentViewName = view;
  document.querySelectorAll('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));

  const userChip = document.getElementById('userChip');
  if (userChip) {
    userChip.classList.toggle('active', view === 'profile');
  }

  document.querySelectorAll('.view').forEach((sec) => { sec.hidden = sec.id !== `view-${view}`; });
  document.getElementById('viewTitle').textContent = VIEW_TITLES[view] || view;
  const renderer = VIEW_RENDERERS[view];
  if (renderer) await renderer();
  if (typeof enableSearchableSelects === 'function') enableSearchableSelects(document.getElementById(`view-${view}`));
  updateAdminAlertsBadge();
}

async function refreshGlobalStateAndActiveView() {
  try {
    await Promise.all([
      loadZonesAndSites().catch(() => { }),
      loadMaterials().catch(() => { })
    ]);
    updateAdminAlertsBadge();

    if (currentViewName === 'purchaseOrders' && typeof poActiveTab !== 'undefined' && (poActiveTab === 'upload' || poActiveTab === 'manual')) {

      return;
    }
    const activeEl = document.activeElement;
    if (activeEl && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(activeEl.tagName) && activeEl.id !== 'logoutBtn') {
      return;
    }

    const renderer = VIEW_RENDERERS[currentViewName];
    if (renderer) await renderer();
  } catch (err) {
    console.error('Failed auto state sync:', err);
  }
}

async function updateAdminAlertsBadge() {
  const user = State.user;
  if (!user || !['super_admin', 'region_admin', 'zone_admin'].includes(user.role)) return;
  try {
    const alerts = await Api.adminAlerts();
    const badgeEl = document.getElementById('adminAlertsCountBadge');
    if (badgeEl) {
      const count = alerts.total_alerts || 0;
      badgeEl.textContent = count;
      badgeEl.hidden = count === 0;
    }
  } catch (e) { }
}

function wireNav() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function wireNavToggle() {
  const btn = document.getElementById('navToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
  });
}

function updateSidebarUser(user) {
  if (!user) return;
  const regName = user.regionName || user.zoneName || user.region_name || user.zone_name;
  const fullName = user.fullName || user.full_name || user.email;
  const email = user.email;

  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl) avatarEl.textContent = (fullName || email).slice(0, 2).toUpperCase();

  const nameEl = document.getElementById('userName');
  if (nameEl) nameEl.textContent = fullName;

  const userRegionEl = document.getElementById('userRegion') || document.getElementById('userZone');
  if (userRegionEl) {
    const siteName = user.siteName || user.site_name;
    userRegionEl.textContent = siteName
      ? `${regName} · ${siteName}`
      : (regName || 'All regions');
  }
}

async function bootApp() {
  const user = Auth.getUser();
  if (!user) {
    showLogin();
    return;
  }

  if (user.role === 'zone_admin') user.role = 'region_admin';
  user.zoneId = user.zoneId || user.zone_id || user.regionId || user.region_id;
  user.regionId = user.regionId || user.region_id || user.zoneId || user.zone_id;
  user.siteId = user.siteId || user.site_id;
  State.user = user;

  updateSidebarUser(user);
  document.getElementById('roleBadge').textContent = user.role.replace('_', ' ');
  const alertsBtn = document.getElementById('adminAlertsBtn');
  if (alertsBtn) {
    alertsBtn.hidden = !['super_admin', 'region_admin', 'zone_admin'].includes(user.role);
    alertsBtn.onclick = () => openAdminAlertsModal();
  }

  document.body.classList.remove('role-super_admin', 'role-region_admin', 'role-zone_admin', 'role-site_engineer');

  document.body.classList.add(`role-${user.role}`);
  if (user.role === 'region_admin') document.body.classList.add('role-zone_admin');

  await loadZonesAndSites();
  await loadMaterials();

  wireNav();
  wireNavToggle();

  const userChip = document.getElementById('userChip');
  if (userChip) {
    userChip.onclick = () => switchView('profile');
  }

  if (typeof onGlobalDataChange === 'function') {
    onGlobalDataChange(() => {
      refreshGlobalStateAndActiveView();
    });
  }


  window.addEventListener('focus', () => {
    refreshGlobalStateAndActiveView();
  });

  await switchView('dashboard');

  if (user.mustChangePassword || user.must_change_password) {
    showSetPermanentPasswordModal();
  }
}

function showApp() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appShell').hidden = false;
  bootApp();
}

function showLogin() {
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('appShell').hidden = true;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const { token, user } = await Api.login(email, password);
    Auth.setToken(token);
    Auth.setUser(user);
    showApp();
  } catch (err) {
    let msg = err.message || 'Login failed';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Network Error')) {
      const apiEndpoint = (typeof Api !== 'undefined' && Api.getApiBase) ? Api.getApiBase() : '/api';
      msg = `Cannot connect to backend server. Please ensure backend server is reachable at ${apiEndpoint}`;
    }
    errEl.textContent = msg;
    errEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  Auth.clearToken();
  Auth.clearUser();
  showLogin();
});

const forgotBtn = document.getElementById('forgotPasswordBtn');
if (forgotBtn) {
  forgotBtn.addEventListener('click', () => showForgotPasswordModal());
}

function showForgotPasswordModal() {
  const existing = document.getElementById('forgotPasswordModal');
  if (existing) existing.remove();

  const currentLoginEmail = document.getElementById('loginEmail')?.value.trim() || '';

  const overlay = document.createElement('div');
  overlay.id = 'forgotPasswordModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:440px" role="dialog" aria-modal="true" aria-label="Reset Password">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
        <h3 style="margin:0">Reset Password</h3>
        <button id="closeForgotPwdTop" class="btn-ghost small" aria-label="Close modal">&times;</button>
      </div>
      <p class="muted" style="margin-top:0; font-size:13px">Enter your registered phone number or email address and choose a new password for your account.</p>

      <form id="forgotPasswordForm">
        <div class="form-row">
          <label>Registered Phone Number or Email <span class="required">*</span></label>
          <input type="text" id="forgotIdentifier" value="${currentLoginEmail}" placeholder="e.g. +91 98765 43210 or user@chargezone.com" required />
        </div>
        <div class="form-row">
          <label>New Password <span class="required">*</span></label>
          <input type="password" id="forgotNewPassword" placeholder="Minimum 6 characters" minlength="6" required />
        </div>
        <div class="form-row">
          <label>Confirm New Password <span class="required">*</span></label>
          <input type="password" id="forgotConfirmPassword" placeholder="Re-enter new password" minlength="6" required />
        </div>
        <div id="forgotError" class="form-error" style="margin-bottom:12px" hidden></div>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px">
          <button type="button" id="cancelForgotBtn" class="btn-ghost">Cancel</button>
          <button type="submit" id="submitForgotBtn" class="btn-primary">Reset Password</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(overlay);

  const closeFn = () => overlay.remove();
  overlay.querySelector('#cancelForgotBtn').addEventListener('click', closeFn);
  overlay.querySelector('#closeForgotPwdTop').addEventListener('click', closeFn);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });

  const form = overlay.querySelector('#forgotPasswordForm');
  const errEl = overlay.querySelector('#forgotError');
  const submitBtn = overlay.querySelector('#submitForgotBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const identifier = overlay.querySelector('#forgotIdentifier').value.trim();
    const newPwd = overlay.querySelector('#forgotNewPassword').value;
    const confirmPwd = overlay.querySelector('#forgotConfirmPassword').value;

    if (!identifier) {
      errEl.textContent = 'Please enter your registered phone number or email address';
      errEl.hidden = false;
      return;
    }

    if (!newPwd || newPwd.length < 6) {
      errEl.textContent = 'Password must be at least 6 characters long';
      errEl.hidden = false;
      return;
    }

    if (newPwd !== confirmPwd) {
      errEl.textContent = 'Passwords do not match';
      errEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    try {
      const res = await Api.forgotPassword(identifier, newPwd);
      overlay.remove();
      if (typeof toast === 'function') toast(res.message || 'Password reset successfully! Please sign in with your new password.');
      if (identifier.includes('@')) {
        document.getElementById('loginEmail').value = identifier;
      }
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginPassword').focus();
    } catch (err) {
      errEl.textContent = err.message || 'Failed to reset password';
      errEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function showSetPermanentPasswordModal() {
  const existing = document.getElementById('setPermanentPasswordModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'setPermanentPasswordModal';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '9999';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:440px" role="dialog" aria-modal="true" aria-label="Set Permanent Password">
      <div style="margin-bottom:16px">
        <h3 style="margin:0; color:var(--brand, #E31E24); font-size:18px">Set Permanent Password</h3>
        <p class="muted" style="margin-top:6px; font-size:13px; line-height:1.4">You logged in using a temporary password. Please set up your new permanent password to continue.</p>
      </div>

      <form id="setPermanentPasswordForm">
        <div class="form-row">
          <label>New Permanent Password <span class="required">*</span></label>
          <input type="password" id="permNewPassword" placeholder="Minimum 6 characters" minlength="6" required />
        </div>
        <div class="form-row">
          <label>Confirm Permanent Password <span class="required">*</span></label>
          <input type="password" id="permConfirmPassword" placeholder="Re-enter new password" minlength="6" required />
        </div>
        <div id="permError" class="form-error" style="margin-bottom:12px" hidden></div>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px">
          <button type="submit" id="submitPermBtn" class="btn-primary" style="width:100%">Save Permanent Password</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(overlay);

  const form = overlay.querySelector('#setPermanentPasswordForm');
  const errEl = overlay.querySelector('#permError');
  const submitBtn = overlay.querySelector('#submitPermBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const newPwd = overlay.querySelector('#permNewPassword').value;
    const confirmPwd = overlay.querySelector('#permConfirmPassword').value;

    if (!newPwd || newPwd.length < 6) {
      errEl.textContent = 'Password must be at least 6 characters long';
      errEl.hidden = false;
      return;
    }

    if (newPwd !== confirmPwd) {
      errEl.textContent = 'Passwords do not match';
      errEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    try {
      const res = await Api.setPermanentPassword(newPwd);
      overlay.remove();
      if (res.user) {
        Auth.setUser(res.user);
        State.user = res.user;
      }
      if (typeof toast === 'function') toast('Permanent password set successfully!');
    } catch (err) {
      errEl.textContent = err.message || 'Failed to set permanent password';
      errEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* Global Password Visibility Toggle helper */
const SVG_EYE_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SVG_EYE_CLOSED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function createPasswordToggleBtn() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'password-toggle-btn';
  btn.title = 'Show password';
  btn.setAttribute('aria-label', 'Show password');
  btn.innerHTML = SVG_EYE_OPEN;
  return btn;
}

function setupPasswordFields(container = document) {
  const inputs = container.querySelectorAll('input[type="password"]');
  inputs.forEach(input => {
    if (input.closest('.password-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'password-wrapper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    wrapper.appendChild(createPasswordToggleBtn());
  });
}

document.addEventListener('click', function (e) {
  const btn = e.target.closest('.password-toggle-btn');
  if (!btn) return;

  e.preventDefault();
  const wrapper = btn.closest('.password-wrapper');
  const input = wrapper ? wrapper.querySelector('input') : null;
  if (!input) return;

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = isPassword ? SVG_EYE_CLOSED : SVG_EYE_OPEN;
  btn.title = isPassword ? 'Hide password' : 'Show password';
  btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setupPasswordFields(document));
  } else {
    setupPasswordFields(document);
  }
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.matches && node.matches('input[type="password"]')) {
            setupPasswordFields(node.parentNode || document);
          } else if (node.querySelectorAll) {
            setupPasswordFields(node);
          }
        }
      });
    });
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
}

(function init() {
  setupPasswordFields(document);
  if (Auth.getToken() && Auth.getUser()) {
    showApp();
  } else {
    showLogin();
  }
})();

