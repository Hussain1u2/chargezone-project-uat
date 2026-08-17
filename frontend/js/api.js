let envConfig = null;
let envPromise = null;

function getDefaultApiBase() {
  return '/api';
}

function parseEnvText(text) {
  const envObj = {};
  if (!text) return envObj;
  text.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        envObj[key] = val;
      } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
        envObj['API_BASE'] = trimmed;
      }
    }
  });
  return envObj;
}

async function loadEnvConfig() {
  if (window.ENV && typeof window.ENV === 'object') {
    envConfig = window.ENV;
    return envConfig;
  }
  try {
    const res = await fetch('.env');
    if (res.ok) {
      const text = await res.text();
      if (text && !text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
        envConfig = parseEnvText(text);
        return envConfig;
      }
    }
  } catch (e) {
    // Ignore fetch errors and rely on fallbacks
  }
  return null;
}

envPromise = loadEnvConfig();

function getApiBase() {
  if (window.ENV && (window.ENV.API_BASE || window.ENV.API_BASE_URL)) {
    return window.ENV.API_BASE || window.ENV.API_BASE_URL;
  }
  if (envConfig && (envConfig.API_BASE || envConfig.API_BASE_URL)) {
    return envConfig.API_BASE || envConfig.API_BASE_URL;
  }
  if (window.API_BASE) return window.API_BASE;
  return getDefaultApiBase();
}

const Auth = {
  getToken() { return localStorage.getItem('cz_token'); },
  setToken(t) { localStorage.setItem('cz_token', t); },
  clearToken() { localStorage.removeItem('cz_token'); },
  getUser() {
    const raw = localStorage.getItem('cz_user');
    return raw ? JSON.parse(raw) : null;
  },
  setUser(u) { localStorage.setItem('cz_user', JSON.stringify(u)); },
  clearUser() { localStorage.removeItem('cz_user'); }
};

const globalDataChangeListeners = [];
function onGlobalDataChange(fn) {
  if (typeof fn === 'function') globalDataChangeListeners.push(fn);
}
function notifyGlobalDataChange(path, method) {
  globalDataChangeListeners.forEach(fn => {
    try { fn(path, method); } catch (e) { console.error('Data change listener error:', e); }
  });
}

async function apiRequest(method, path, body, isFormData = false) {
  if (envPromise) {
    try { await envPromise; } catch (e) {}
  }
  const baseUrl = getApiBase();
  const headers = {};
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined
  });

  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }

  if (!res.ok) {
    if (res.status === 401 && !path.includes('/auth/login')) {
      Auth.clearToken();
      Auth.clearUser();
      if (typeof showLogin === 'function') showLogin();
    }
    const message = (data && data.error) ? data.error : `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()) && !path.includes('/auth/login')) {
    setTimeout(() => notifyGlobalDataChange(path, method), 120);
  }

  return data;
}


const Api = {
  login: (email, password) => apiRequest('POST', '/auth/login', { email, password }),
  forgotPassword: (identifier, newPassword) => apiRequest('POST', '/auth/forgot-password', { identifier, phone_number: identifier, newPassword }),
  setPermanentPassword: (newPassword) => apiRequest('POST', '/auth/set-permanent-password', { new_password: newPassword }),
  me: () => apiRequest('GET', '/auth/me'),
  updateProfile: (payload) => apiRequest('PUT', '/auth/profile', payload),
  dashboardSummary: () => apiRequest('GET', '/dashboard/summary'),
  regionStockMonitor: () => apiRequest('GET', '/dashboard/region-stock-monitor'),
  zoneStockMonitor: () => apiRequest('GET', '/dashboard/region-stock-monitor'),

  regions: () => apiRequest('GET', '/regions'),
  zones: () => apiRequest('GET', '/regions'),
  sites: (regionId) => apiRequest('GET', `/regions/${regionId}/sites`),
  createRegion: (payload) => apiRequest('POST', '/regions', payload),
  createZone: (payload) => apiRequest('POST', '/regions', payload),
  updateRegion: (regionId, payload) => apiRequest('PUT', `/regions/${regionId}`, payload),
  updateZone: (regionId, payload) => apiRequest('PUT', `/regions/${regionId}`, payload),
  deleteRegion: (regionId) => apiRequest('DELETE', `/regions/${regionId}`),
  deleteZone: (regionId) => apiRequest('DELETE', `/regions/${regionId}`),
  createSite: (regionId, payload) => apiRequest('POST', `/regions/${regionId}/sites`, payload),
  updateSite: (regionId, siteId, payload) => apiRequest('PUT', `/regions/${regionId}/sites/${siteId}`, payload),
  deleteSite: (regionId, siteId) => apiRequest('DELETE', `/regions/${regionId}/sites/${siteId}`),

  materials: (search) => apiRequest('GET', `/materials${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createMaterial: (payload) => apiRequest('POST', '/materials', payload),
  updateMaterial: (id, payload) => apiRequest('PUT', `/materials/${id}`, payload),
  deleteMaterial: (id) => apiRequest('DELETE', `/materials/${id}`),

  purchaseOrders: () => apiRequest('GET', '/purchase-orders'),
  purchaseOrder: (id) => apiRequest('GET', `/purchase-orders/${id}`),
  uploadPO: (formData) => apiRequest('POST', '/purchase-orders/upload', formData, true),
  manualPO: (payload) => apiRequest('POST', '/purchase-orders/manual', payload),
  addPOItem: (id, payload) => apiRequest('POST', `/purchase-orders/${id}/items`, payload),
  updatePOItem: (id, itemId, payload) => apiRequest('PUT', `/purchase-orders/${id}/items/${itemId}`, payload),
  deletePOItem: (id, itemId) => apiRequest('DELETE', `/purchase-orders/${id}/items/${itemId}`),
  matchPOItem: (id, itemId, materialId) => apiRequest('POST', `/purchase-orders/${id}/items/${itemId}/match`, { material_id: materialId }),
  confirmPO: (id, payload) => apiRequest('POST', `/purchase-orders/${id}/confirm`, payload),
  approvePO: (id) => apiRequest('POST', `/purchase-orders/${id}/approve`),
  rejectPO: (id, reason) => apiRequest('POST', `/purchase-orders/${id}/reject`, { reason }),

  items: (params) => apiRequest('GET', `/items${params ? `?${params}` : ''}`),
  itemByBarcodeValue: (code) => apiRequest('GET', `/items/barcode-value/${encodeURIComponent(code)}`),
  itemBySerial: (code) => apiRequest('GET', `/items/barcode-value/${encodeURIComponent(code)}`),
  lookupItemOrMaterial: (query, materialId) => {
    let url = '/items/lookup';
    const params = [];
    if (query) params.push(`q=${encodeURIComponent(query)}`);
    if (materialId) params.push(`materialId=${encodeURIComponent(materialId)}`);
    if (params.length) url += `?${params.join('&')}`;
    return apiRequest('GET', url);
  },

  transactions: (params) => apiRequest('GET', `/transactions${params ? `?${params}` : ''}`),
  dispatchToRegion: (payload) => apiRequest('POST', '/transactions/dispatch-to-region', payload),
  dispatchToZone: (payload) => apiRequest('POST', '/transactions/dispatch-to-region', payload),
  dispatchRegionToRegion: (payload) => apiRequest('POST', '/transactions/dispatch-region-to-region', payload),
  dispatchZoneToZone: (payload) => apiRequest('POST', '/transactions/dispatch-region-to-region', payload),
  receiveInRegion: (payload) => apiRequest('POST', '/transactions/receive-in-region', payload),
  receiveInZone: (payload) => apiRequest('POST', '/transactions/receive-in-region', payload),
  dispatchToSite: (payload) => apiRequest('POST', '/transactions/dispatch-to-site', payload),
  receiveAtSite: (payload) => apiRequest('POST', '/transactions/receive-at-site', payload),
  returnStock: (payload) => apiRequest('POST', '/transactions/return-stock', payload),

  requisitions: (status) => apiRequest('GET', `/requisitions${status ? `?status=${status}` : ''}`),
  createRequisition: (payload) => apiRequest('POST', '/requisitions', payload),
  cancelRequisition: (id) => apiRequest('PATCH', `/requisitions/${id}/cancel`),
  approveRequisition: (id) => apiRequest('PATCH', `/requisitions/${id}/approve`),
  rejectRequisition: (id, reason) => apiRequest('PATCH', `/requisitions/${id}/reject`, { reason }),

  replacements: () => apiRequest('GET', '/replacements'),
  createReplacement: (payload) => apiRequest('POST', '/replacements', payload),
  markRepaired: (id, payload) => apiRequest('POST', `/replacements/${id}/mark-repaired`, payload),
  approveScrap: (id, payload) => apiRequest('PATCH', `/replacements/${id}/approve-scrap`, payload),
  rejectScrap: (id, reason) => apiRequest('PATCH', `/replacements/${id}/reject-scrap`, { reason }),

  consumptions: () => apiRequest('GET', '/consumptions'),
  createConsumption: (payload) => apiRequest('POST', '/consumptions', payload),

  adminAlerts: () => apiRequest('GET', '/dashboard/alerts'),

  users: () => apiRequest('GET', '/users'),
  createUser: (payload) => apiRequest('POST', '/users', payload),
  updateUser: (id, payload) => apiRequest('PUT', `/users/${id}`, payload),
  deactivateUser: (id) => apiRequest('PATCH', `/users/${id}/deactivate`),
  reactivateUser: (id) => apiRequest('PATCH', `/users/${id}/reactivate`),
  deleteUser: (id) => apiRequest('DELETE', `/users/${id}`),

  getApiBase: () => getApiBase(),
  loadEnvConfig: () => loadEnvConfig()
};
