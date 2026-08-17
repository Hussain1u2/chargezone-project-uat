const State = {
  regions: [],
  zones: [],
  sitesByRegion: {},
  sitesByZone: {},
  materials: [],
  user: null
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
const escapeHTML = escapeHtml;

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function money(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }

function fmtTxType(status) {
  if (status === 'DISPATCH_RE') return 'DISPATCH RE (Region -> Engineer)';
  if (status === 'CONSUME') return 'ENGINEER CONSUMED';
  if (status === 'MISSING_NOT_FOUND' || status === 'MISSING') return 'MISSING / NOT FOUND';
  return status;
}

function statusPillClass(status) {
  const ok = ['IN_HO', 'IN_ZONE', 'IN_REGION', 'IN_SITE', 'FULFILLED', 'CONFIRMED', 'REPAIRABLE', 'WARRANTY_RETURN', 'REPAIRED_IN_STOCK', 'CONSUME'];
  const warn = ['IN_TRANSIT_TO_ZONE', 'IN_TRANSIT_TO_REGION', 'IN_TRANSIT_TO_SITE', 'PENDING', 'PARTIAL', 'EXTRACTED', 'UPLOADED', 'PHYSICALLY_DAMAGED', 'SCRAP_PENDING_APPROVAL', 'DISPATCH_RE', 'DISPATCH_HR'];
  const danger = ['SCRAP', 'CANCELLED', 'MISSING_NOT_FOUND', 'MISSING'];
  if (ok.includes(status)) return 'ok';
  if (warn.includes(status)) return 'warn';
  if (danger.includes(status)) return 'danger';
  return 'neutral';
}
function pill(status) { return `<span class="status-pill ${statusPillClass(status)}">${fmtTxType(status)}</span>`; }

async function loadMaterials() {
  try {
    State.materials = await Api.materials();
  } catch (err) {
    console.error('Failed to load materials', err);
    State.materials = [];
  }
}

async function loadRegionsAndSites() {
  State.regions = await Api.regions ? await Api.regions() : [];
  State.zones = State.regions;
  State.sitesByRegion = State.sitesByRegion || {};
  State.sitesByZone = State.sitesByRegion;
  for (const r of State.regions) {
    try {
      const sites = await Api.sites(r.id);
      State.sitesByRegion[r.id] = sites;
      State.sitesByZone[r.id] = sites;
    } catch (e) {
      State.sitesByRegion[r.id] = [];
      State.sitesByZone[r.id] = [];
    }
  }
}
const loadZonesAndSites = loadRegionsAndSites;

function regionOptions(selectedId, placeholder = '') {
  const regions = State.regions || [];
  const promptText = placeholder || 'Select Region';
  const defaultOpt = `<option value="" ${!selectedId ? 'selected disabled' : ''}>-- ${promptText} --</option>`;
  return defaultOpt + regions.map((r) => `<option value="${r.id}" ${r.id == selectedId ? 'selected' : ''}>${r.name}</option>`).join('');
}
const zoneOptions = regionOptions;

function siteOptions(regionId, selectedId, placeholder = '') {
  const regId = regionId || (State.user ? State.user.regionId || State.user.zoneId : null);
  const sites = (State.sitesByRegion && State.sitesByRegion[regId]) || (State.sitesByZone && State.sitesByZone[regId]) || [];
  const promptText = placeholder || 'Select Site';
  const defaultOpt = `<option value="" ${!selectedId ? 'selected disabled' : ''}>-- ${promptText} --</option>`;
  return defaultOpt + sites.map((s) => `<option value="${s.id}" ${s.id == selectedId ? 'selected' : ''}>${s.name}</option>`).join('');
}

function materialOptions(selectedId, placeholder = '') {
  const materials = State.materials || [];
  const promptText = placeholder || 'Select Material';
  const defaultOpt = `<option value="" ${!selectedId ? 'selected disabled' : ''}>-- ${promptText} --</option>`;
  const sorted = [...materials].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return defaultOpt + sorted.map((m) => {
    const categoryLabel = m.category ? ` (${m.category})` : '';
    return `<option value="${m.id}" ${m.id == selectedId ? 'selected' : ''}>${m.name}${categoryLabel}</option>`;
  }).join('');
}

function makeSearchableSelect(selectEl) {
  if (!selectEl || selectEl.dataset.searchableUpgraded) return;
  selectEl.dataset.searchableUpgraded = 'true';
  selectEl.style.display = 'none';

  const wrapper = document.createElement('div');
  wrapper.className = 'searchable-select';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'searchable-select-input';
  input.placeholder = (selectEl.options[selectEl.selectedIndex] && selectEl.options[selectEl.selectedIndex].text) || 'Type to search...';
  input.value = (selectEl.options[selectEl.selectedIndex] && selectEl.options[selectEl.selectedIndex].text) || '';
  input.autocomplete = 'off';

  const dropdown = document.createElement('div');
  dropdown.className = 'searchable-select-dropdown';
  dropdown.hidden = true;

  wrapper.appendChild(input);
  wrapper.appendChild(dropdown);
  selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

  function renderOptions(filterText = '') {
    const term = filterText.toLowerCase().trim();
    const options = Array.from(selectEl.options);
    const matches = options.filter(opt => !term || opt.text.toLowerCase().includes(term) || String(opt.value).toLowerCase().includes(term));

    if (!matches.length) {
      dropdown.innerHTML = `<div class="searchable-select-item empty">No matching options</div>`;
    } else {
      dropdown.innerHTML = matches.map(opt => `
        <div class="searchable-select-item ${opt.selected ? 'selected' : ''}" data-value="${opt.value}">${opt.text}</div>
      `).join('');
    }
  }

  function adjustDropdownPosition() {
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 240 && rect.top > 240) {
      dropdown.classList.add('drop-up');
    } else {
      dropdown.classList.remove('drop-up');
    }
  }

  input.addEventListener('focus', () => {
    input.select();
    renderOptions('');
    adjustDropdownPosition();
    dropdown.hidden = false;
  });

  input.addEventListener('input', (e) => {
    renderOptions(e.target.value);
    adjustDropdownPosition();
    dropdown.hidden = false;
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.searchable-select-item');
    if (!item || item.classList.contains('empty')) return;
    const val = item.dataset.value;
    selectEl.value = val;
    input.value = item.textContent.trim();
    dropdown.hidden = true;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      dropdown.hidden = true;
      const selectedOpt = selectEl.options[selectEl.selectedIndex];
      if (selectedOpt) input.value = selectedOpt ? selectedOpt.text : '';
    }
  });

  const observer = new MutationObserver(() => {
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    if (selectedOpt) input.value = selectedOpt ? selectedOpt.text : '';
  });
  observer.observe(selectEl, { childList: true, subtree: true });
}

function enableSearchableSelects(root = document) {
  setTimeout(() => {
    (root || document).querySelectorAll('select').forEach(makeSearchableSelect);
  }, 50);
}

if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    enableSearchableSelects(document.body);
  });
  const globalSelectObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            if (node.tagName === 'SELECT') makeSearchableSelect(node);
            else if (node.querySelectorAll) node.querySelectorAll('select').forEach(makeSearchableSelect);
          }
        });
      }
    }
  });
  if (document.body) {
    globalSelectObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function downloadInventoryCSV(materials, regions) {
  const regionNames = (regions || []).map(r => r.name);
  const headers = ['Material Name', 'Category', 'Barcode Prefix', 'Unit Price (INR)', 'Min Stock', 'Unit', 'HO Stock', ...regionNames, 'Total Region Stock', 'Site Deployed Stock', 'In Transit Stock', 'Consumed Qty', 'Scrap Qty', 'Total Active Stock', 'Total Stock Value (INR)', 'Status'];

  const rows = (materials || []).map(m => {
    const regionQtys = (regions || []).map(r => Number(m.region_stock ? m.region_stock[r.id] || 0 : (m.zone_stock ? m.zone_stock[r.id] || 0 : 0)));
    const price = Number(m.price || 0);
    const totalVal = Number(m.total_active_stock || 0) * price;
    return [
      `"${(m.name || '').replace(/"/g, '""')}"`,
      `"${(m.category || '').replace(/"/g, '""')}"`,
      `"${(m.barcode_prefix || '').replace(/"/g, '""')}"`,
      price.toFixed(2),
      m.min_stock_level || 0,
      `"${m.unit || 'pcs'}"`,
      m.ho_stock || 0,
      ...regionQtys,
      m.total_region_stock || m.total_zone_stock || 0,
      m.site_stock || 0,
      m.in_transit_stock || 0,
      m.consumed_count || 0,
      m.scrap_count || 0,
      m.total_active_stock || 0,
      totalVal.toFixed(2),
      m.status || 'UNKNOWN'
    ];
  });

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `ChargeZone_Live_Inventory_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadInventoryPDF(materials, regions) {
  const win = window.open('', '_blank');
  const regionHeaders = (regions || []).map(r => `<th>${r.name}</th>`).join('');
  const timestamp = fmtDate(new Date());

  const totalActive = (materials || []).reduce((acc, m) => acc + Number(m.total_active_stock || 0), 0);
  const lowStockCount = (materials || []).filter(m => m.status !== 'HEALTHY').length;

  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ChargeZone - Real-Time Inventory Report</title>
      <style>
        body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 20px; color: #0f172a; background: #fff; line-height: 1.4; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }
        .brand { font-size: 24px; font-weight: 700; color: #1e3a8a; }
        .sub { font-size: 13px; color: #64748b; margin-top: 4px; }
        .meta { text-align: right; font-size: 12px; color: #64748b; }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; text-align: center; }
        .kpi-val { font-size: 20px; font-weight: 700; color: #0f172a; }
        .kpi-lbl { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        th { background-color: #f1f5f9; font-weight: 600; color: #334155; }
        .num { text-align: right; font-family: monospace; }
        .badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; text-align: center; display: inline-block; }
        .healthy { background: #dcfce7; color: #166534; }
        .low { background: #fef3c7; color: #92400e; }
        .out { background: #fee2e2; color: #991b1b; }
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body { margin: 0; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="brand">ChargeZone Inventory Control</div>
          <div class="sub">Real-Time Overall Inventory Summary Report</div>
        </div>
        <div class="meta">
          <div>Generated: ${timestamp}</div>
          <div>Report Type: Live System Export</div>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-val">${(materials || []).length}</div><div class="kpi-lbl">Total Materials</div></div>
        <div class="kpi-card"><div class="kpi-val">${(regions || []).length}</div><div class="kpi-lbl">Regions</div></div>
        <div class="kpi-card"><div class="kpi-val">${totalActive.toLocaleString()}</div><div class="kpi-lbl">Total Active Stock</div></div>
        <div class="kpi-card"><div class="kpi-val" style="color:${lowStockCount > 0 ? '#dc2626' : '#16a34a'}">${lowStockCount}</div><div class="kpi-lbl">Stock Alerts</div></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Material Name</th>
            <th>Category</th>
            <th>Min Stock</th>
            <th>HO Stock</th>
            ${regionHeaders}
            <th>Total Region</th>
            <th>Deployed (Site)</th>
            <th>In Transit</th>
            <th>Total Active</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${(materials || []).map(m => {
    const regCells = (regions || []).map(r => `<td class="num">${m.region_stock ? m.region_stock[r.id] || 0 : (m.zone_stock ? m.zone_stock[r.id] || 0 : 0)}</td>`).join('');
    let badgeClass = 'healthy';
    if (m.status === 'LOW_STOCK') badgeClass = 'low';
    if (m.status === 'OUT_OF_STOCK') badgeClass = 'out';

    return `<tr>
              <td><strong>${m.name}</strong>${m.barcode_prefix ? `<br/><small style="color:#64748b">Prefix: ${m.barcode_prefix}</small>` : ''}</td>
              <td>${m.category}</td>
              <td class="num">${m.min_stock_level} ${m.unit}</td>
              <td class="num"><strong>${m.ho_stock}</strong></td>
              ${regCells}
              <td class="num"><strong>${m.total_region_stock || m.total_zone_stock || 0}</strong></td>
              <td class="num">${m.site_stock}</td>
              <td class="num">${m.in_transit_stock}</td>
              <td class="num"><strong>${m.total_active_stock}</strong></td>
              <td><span class="badge ${badgeClass}">${m.status}</span></td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `);
  win.document.close();
}

async function renderDashboard() {
  const el = document.getElementById('view-dashboard');
  el.innerHTML = `<div class="empty-state">Loading dashboard and real-time inventory report…</div>`;
  try {
    const [s, liveData] = await Promise.all([
      Api.dashboardSummary(),
      Api.regionStockMonitor().catch(() => ({ regions: [], materials: [] }))
    ]);

    const statusCounts = {};
    (s.item_status_counts || []).forEach((r) => { statusCounts[r.status] = r.count; });
    const liveMaterials = liveData.materials || [];
    const liveRegions = liveData.regions || liveData.zones || [];

    const totalActiveUnits = liveMaterials.reduce((acc, m) => acc + Number(m.total_active_stock || 0), 0);
    const totalHoStock = liveMaterials.reduce((acc, m) => acc + Number(m.ho_stock || 0), 0);
    const totalRegionStock = liveMaterials.reduce((acc, m) => acc + Number(m.total_region_stock || m.total_zone_stock || 0), 0);
    const totalSiteStock = liveMaterials.reduce((acc, m) => acc + Number(m.site_stock || 0), 0);
    const totalInTransitStock = liveMaterials.reduce((acc, m) => acc + Number(m.in_transit_stock || 0), 0);
    const totalRepairable = liveMaterials.reduce((acc, m) => acc + Number(m.repairable_count || 0), 0);
    const totalScrap = liveMaterials.reduce((acc, m) => acc + Number(m.scrap_count || 0), 0);

    const totalSystemValuation = liveMaterials.reduce((acc, m) => acc + (Number(m.total_active_stock || 0) * Number(m.price || 0)), 0);

    const regionValuations = liveRegions.map((r) => {
      const qty = liveMaterials.reduce((acc, m) => acc + Number(m.region_stock ? m.region_stock[r.id] || 0 : (m.zone_stock ? m.zone_stock[r.id] || 0 : 0)), 0);
      const val = liveMaterials.reduce((acc, m) => acc + (Number(m.region_stock ? m.region_stock[r.id] || 0 : (m.zone_stock ? m.zone_stock[r.id] || 0 : 0)) * Number(m.price || 0)), 0);
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        quantity: qty,
        valuation: val
      };
    });

    const hoValuation = liveMaterials.reduce((acc, m) => acc + (Number(m.ho_stock || 0) * Number(m.price || 0)), 0);
    const siteValuation = liveMaterials.reduce((acc, m) => acc + (Number(m.site_stock || 0) * Number(m.price || 0)), 0);
    const inTransitValuation = liveMaterials.reduce((acc, m) => acc + (Number(m.in_transit_stock || 0) * Number(m.price || 0)), 0);

    const healthyCount = liveMaterials.filter(m => m.status === 'HEALTHY').length;
    const lowStockCount = liveMaterials.filter(m => m.status === 'LOW_STOCK').length;
    const outOfStockCount = liveMaterials.filter(m => m.status === 'OUT_OF_STOCK').length;
    const totalAlertsCount = lowStockCount + outOfStockCount;

    const safeTotal = totalActiveUnits > 0 ? totalActiveUnits : 1;
    const hoPct = Math.round((totalHoStock / safeTotal) * 100);
    const regPct = Math.round((totalRegionStock / safeTotal) * 100);
    const sitePct = Math.round((totalSiteStock / safeTotal) * 100);
    const transitPct = Math.min(100 - (hoPct + regPct + sitePct), Math.round((totalInTransitStock / safeTotal) * 100));

    const categories = Array.from(new Set(liveMaterials.map(m => m.category).filter(Boolean))).sort();

    const regionHeaders = liveRegions.map((r) => `<th>${r.name}</th>`).join('');

    el.innerHTML = `
      <!-- Interactive Quick Actions & System Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:12px;background:var(--surface,#fff);padding:14px 18px;border-radius:var(--radius,10px);border:1px solid var(--border,#e2e8f0);box-shadow:var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05))">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:10px;height:10px;border-radius:50%;background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,0.2)"></div>
          <span style="font-size:13px;font-weight:600">Live Inventory System Active</span>
          <span class="badge" style="font-size:11px">${liveRegions.length} Regions · ${liveMaterials.length} Materials</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="dash-quick-btn" id="dashGoReq" type="button">Raise Requisition</button>
          <button class="dash-quick-btn" id="dashGoDispatch" type="button">Scan &amp; Move Stock</button>
          <button class="dash-quick-btn" id="dashGoPO" type="button">New PO</button>
          <button class="dash-quick-btn" id="dashToggleAutoSync" type="button" style="border-color:var(--brand);color:var(--brand)">Auto-Sync (Live)</button>
        </div>
      </div>

      <!-- Executive KPI Cards Grid (Clickable Filters) -->
      <div class="dash-kpi-grid" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));margin-bottom:20px">
        <div class="card stat-card accent interactive" data-card-filter="all" title="Click to view all active system stock">
          <div class="stat-value">${totalActiveUnits.toLocaleString()}</div>
          <div class="stat-label">Total Active System Stock</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">Across All Facilities &amp; Sites</div>
        </div>

        <div class="card stat-card success interactive" data-card-filter="valuation" style="border-left-color:var(--brand)" title="Click to view full inventory valuation breakdown">
          <div class="stat-value" style="color:var(--brand);font-size:22px">${money(totalSystemValuation)}</div>
          <div class="stat-label">Total Inventory Valuation</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">Combined Active System Value</div>
        </div>

        <div class="card stat-card info interactive" data-card-filter="ho" title="Click to filter materials with Head Office stock">
          <div class="stat-value">${totalHoStock.toLocaleString()}</div>
          <div class="stat-label">Head Office Stock</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">Central Warehouse Reserve</div>
        </div>

        <div class="card stat-card interactive" data-card-filter="region" title="Click to view regional hub stock">
          <div class="stat-value">${totalRegionStock.toLocaleString()}</div>
          <div class="stat-label">Regional Stock</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">${liveRegions.length} Active Regional Hubs</div>
        </div>

        <div class="card stat-card success interactive" data-card-filter="site" title="Click to filter site deployed stock">
          <div class="stat-value">${totalSiteStock.toLocaleString()}</div>
          <div class="stat-label">Site Deployed Stock</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">Installed at Charge Points</div>
        </div>

        <div class="card stat-card warn interactive" data-card-filter="transit" title="Click to filter in-transit equipment">
          <div class="stat-value">${totalInTransitStock.toLocaleString()}</div>
          <div class="stat-label">In-Transit Equipment</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">En Route Shipments</div>
        </div>

        <div class="card stat-card ${totalAlertsCount > 0 ? 'danger' : 'success'} interactive" data-card-filter="alerts" title="Click to view stock alert items (Low Stock / Out of Stock)">
          <div class="stat-value" style="color:${totalAlertsCount > 0 ? 'var(--danger)' : 'var(--success)'}">${totalAlertsCount}</div>
          <div class="stat-label">Inventory Stock Alerts</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">${lowStockCount} Low · ${outOfStockCount} Out of Stock</div>
        </div>
      </div>

      <!-- Region-Wise Current Stock Quantity & Price Summary Card -->
      <div class="card" style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0">Region-Wise Stock Quantity &amp; Price Summary</h3>
            <p class="muted" style="margin:4px 0 0 0;font-size:12.5px">Real-time breakdown of current stock quantity and total valuation (price) for each region (click any row to filter matrix)</p>
          </div>
          <div style="font-size:13.5px;font-weight:600;background:var(--brand-dim, rgba(37,99,235,0.08));padding:6px 12px;border-radius:var(--radius);border:1px solid var(--brand-border, rgba(37,99,235,0.2))">
            Total Inventory Value: <strong class="mono" style="color:var(--brand);font-size:15px;margin-left:4px">${money(totalSystemValuation)}</strong>
          </div>
        </div>

        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Region Name</th>
                <th>Stock Quantity</th>
                <th>Total Stock Price Valuation</th>
                <th>Valuation Share</th>
              </tr>
            </thead>
            <tbody>
              ${regionValuations.map((rv) => {
      const pct = totalSystemValuation > 0 ? ((rv.valuation / totalSystemValuation) * 100).toFixed(1) : '0.0';
      return `<tr class="region-summary-row" data-region-filter="${rv.id}" title="Click to filter inventory report for ${rv.name}">
                  <td><strong>${rv.name}</strong> ${rv.code ? `<span class="muted">(${rv.code})</span>` : ''}</td>
                  <td class="mono"><strong>${rv.quantity.toLocaleString()}</strong> units</td>
                  <td class="mono" style="color:var(--brand);font-weight:600">${money(rv.valuation)}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:10px">
                      <div style="flex:1;background:var(--bg-subtle, #f1f5f9);height:8px;border-radius:4px;overflow:hidden">
                        <div style="width:${pct}%;background:var(--brand, #2563eb);height:100%"></div>
                      </div>
                      <span class="mono" style="font-size:11.5px;min-width:42px">${pct}%</span>
                    </div>
                  </td>
                </tr>`;
    }).join('')}
              <tr class="region-summary-row" data-region-filter="ho" style="background:var(--bg-subtle, #f8fafc);font-weight:600" title="Click to filter HO Warehouse stock">
                <td>Head Office Warehouse</td>
                <td class="mono"><strong>${totalHoStock.toLocaleString()}</strong> units</td>
                <td class="mono" style="color:var(--brand)">${money(hoValuation)}</td>
                <td class="mono">${totalSystemValuation > 0 ? ((hoValuation / totalSystemValuation) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
              <tr class="region-summary-row" data-region-filter="site" style="background:var(--bg-subtle, #f8fafc);font-weight:600" title="Click to filter Deployed Sites stock">
                <td>Deployed Sites (Installed)</td>
                <td class="mono"><strong>${totalSiteStock.toLocaleString()}</strong> units</td>
                <td class="mono" style="color:var(--brand)">${money(siteValuation)}</td>
                <td class="mono">${totalSystemValuation > 0 ? ((siteValuation / totalSystemValuation) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
              <tr class="region-summary-row" data-region-filter="transit" style="background:var(--bg-subtle, #f8fafc);font-weight:600" title="Click to filter In-Transit equipment">
                <td>In-Transit Equipment</td>
                <td class="mono"><strong>${totalInTransitStock.toLocaleString()}</strong> units</td>
                <td class="mono" style="color:var(--warn, #d97706)">${money(inTransitValuation)}</td>
                <td class="mono">${totalSystemValuation > 0 ? ((inTransitValuation / totalSystemValuation) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Network Visualizers & Overview Cards -->
      <div class="dash-split-grid">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0">Network Inventory Location Breakdown</h3>
            <span class="badge role-badge">Live Split</span>
          </div>
          <p class="muted" style="font-size:12.5px;margin:0 0 12px 0">Distribution of active stock units across Head Office, Regions, Sites, and In-Transit</p>
          
          <div class="dash-progress-wrapper">
            <div class="dash-progress-bar">
              <div class="dash-progress-segment ho" style="width:${hoPct}%" title="HO: ${hoPct}%"></div>
              <div class="dash-progress-segment region" style="width:${regPct}%" title="Region: ${regPct}%"></div>
              <div class="dash-progress-segment site" style="width:${sitePct}%" title="Site: ${sitePct}%"></div>
              <div class="dash-progress-segment transit" style="width:${Math.max(0, transitPct)}%" title="Transit: ${transitPct}%"></div>
            </div>
          </div>

          <div class="dash-legend">
            <div class="dash-legend-item"><span class="dash-legend-dot ho"></span> HO Warehouse: <strong>${totalHoStock.toLocaleString()}</strong> (${hoPct}%)</div>
            <div class="dash-legend-item"><span class="dash-legend-dot region"></span> Regional Hubs: <strong>${totalRegionStock.toLocaleString()}</strong> (${regPct}%)</div>
            <div class="dash-legend-item"><span class="dash-legend-dot site"></span> Deployed Sites: <strong>${totalSiteStock.toLocaleString()}</strong> (${sitePct}%)</div>
            <div class="dash-legend-item"><span class="dash-legend-dot transit"></span> In Transit: <strong>${totalInTransitStock.toLocaleString()}</strong> (${Math.max(0, transitPct)}%)</div>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0">Inventory Health &amp; Asset Status</h3>
            <span class="badge">Asset Control</span>
          </div>
          <p class="muted" style="font-size:12.5px;margin:0 0 14px 0">Summary of stock health thresholds, serialized items, and maintenance pipeline</p>
          
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;text-align:center">
            <div style="background:var(--success-dim);border:1px solid var(--success-border);border-radius:var(--radius);padding:10px;cursor:pointer" id="dashFilterHealthy">
              <div style="font-size:20px;font-weight:700;color:var(--success);font-family:var(--font-mono)">${healthyCount}</div>
              <div style="font-size:11px;font-weight:600;color:var(--success);text-transform:uppercase;margin-top:2px">Healthy</div>
            </div>
            <div style="background:var(--warn-dim);border:1px solid var(--warn-border);border-radius:var(--radius);padding:10px;cursor:pointer" id="dashFilterLow">
              <div style="font-size:20px;font-weight:700;color:var(--warn);font-family:var(--font-mono)">${lowStockCount}</div>
              <div style="font-size:11px;font-weight:600;color:var(--warn);text-transform:uppercase;margin-top:2px">Low Stock</div>
            </div>
            <div style="background:var(--danger-dim);border:1px solid var(--danger-border);border-radius:var(--radius);padding:10px;cursor:pointer" id="dashFilterOut">
              <div style="font-size:20px;font-weight:700;color:var(--danger);font-family:var(--font-mono)">${outOfStockCount}</div>
              <div style="font-size:11px;font-weight:600;color:var(--danger);text-transform:uppercase;margin-top:2px">Out of Stock</div>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--border-soft);font-size:12px">
            <div>Pending Requisitions: <strong style="color:var(--brand)">${s.pending_requisitions ?? 0}</strong></div>
            <div>Repairable Items: <strong style="color:var(--warn)">${totalRepairable}</strong></div>
            <div>Scrap Items: <strong style="color:var(--danger)">${totalScrap}</strong></div>
          </div>
        </div>
      </div>

      <!-- Real-Time Overall Inventory Summary Report Section -->
      <div class="card" id="dashSummaryCard" style="margin-bottom: 24px">
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0">Real-Time Overall Inventory Summary Report</h3>
            <p class="muted" style="margin:4px 0 0 0;font-size:13px">Live material counts across Head Office, Regions, Sites (Deployed), and In-Transit (click any row for full item breakdown)</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn-primary" id="dashExportCsv" type="button">Export CSV</button>
            <button class="btn-primary" id="dashExportPdf" type="button">Export PDF</button>
            <button class="btn-secondary" id="dashRefreshLive" type="button">Refresh</button>
          </div>
        </div>

        <!-- Active Filter Indicator Banner -->
        <div id="dashActiveFilterBanner" style="display:none;background:var(--brand-dim, rgba(227,30,36,0.08));border:1px solid var(--brand-border, rgba(227,30,36,0.2));padding:8px 14px;border-radius:var(--radius-sm,6px);margin-bottom:14px;font-size:13px;align-items:center;justify-content:space-between">
          <div>Active Dashboard Filter: <strong id="dashActiveFilterText" style="color:var(--brand)">--</strong></div>
          <button id="dashClearActiveFilter" class="btn-ghost small" style="color:var(--brand);font-weight:600">&times; Clear Filter</button>
        </div>

        <!-- Filter Controls Toolbar -->
        <div class="zsm-toolbar" style="border-radius:var(--radius);margin-bottom:16px">
          <div class="zsm-filter-group">
            <input type="text" id="dashSearch" placeholder="Search material name or barcode prefix..." style="min-width:240px" />
            <select id="dashCategoryFilter">
              <option value="">All Categories (${categories.length})</option>
              ${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
            </select>
            <select id="dashStatusFilter">
              <option value="">All Stock Statuses</option>
              <option value="HEALTHY">Healthy Only</option>
              <option value="LOW_STOCK">Low Stock Only</option>
              <option value="OUT_OF_STOCK">Out of Stock Only</option>
            </select>
          </div>
          <div style="font-size:12.5px;color:var(--text-muted)" id="dashFilteredCount">
            Showing <strong>${liveMaterials.length}</strong> of <strong>${liveMaterials.length}</strong> materials
          </div>
        </div>

        <div id="dashMatrixContainer">
          ${renderMatrixTableHtml(liveMaterials, liveRegions, regionHeaders)}
        </div>
      </div>

      <div style="margin-top: 16px">
        <div class="section-header"><h3 style="margin:0">Recent Inventory Activity &amp; Movements</h3></div>
        <div class="card">
          ${s.recent_transactions.length ? `
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Material</th>
                  <th>Qty</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${s.recent_transactions.map((t) => `<tr>
                  <td>${pill(t.transaction_type)}</td>
                  <td class="non-mono"><strong>${t.material_name}</strong></td>
                  <td class="mono"><strong>${t.quantity}</strong></td>
                  <td class="mono-date">${fmtDate(t.created_at)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          ` : `<div class="empty-state">No recent inventory movements recorded.</div>`}
        </div>
      </div>
    `;

    let activeCardFilter = null;

    function filterMatrix() {
      const query = (document.getElementById('dashSearch')?.value || '').trim().toLowerCase();
      const catVal = document.getElementById('dashCategoryFilter')?.value || '';
      const statusVal = document.getElementById('dashStatusFilter')?.value || '';

      const filtered = liveMaterials.filter((m) => {
        const matchesQuery = !query ||
          (m.name || '').toLowerCase().includes(query) ||
          (m.barcode_prefix || '').toLowerCase().includes(query) ||
          (m.category || '').toLowerCase().includes(query);
        const matchesCat = !catVal || m.category === catVal;
        const matchesStatus = !statusVal || m.status === statusVal;

        let matchesCard = true;
        if (activeCardFilter === 'ho') matchesCard = Number(m.ho_stock || 0) > 0;
        else if (activeCardFilter === 'region') matchesCard = Number(m.total_region_stock || m.total_zone_stock || 0) > 0;
        else if (activeCardFilter === 'site') matchesCard = Number(m.site_stock || 0) > 0;
        else if (activeCardFilter === 'transit') matchesCard = Number(m.in_transit_stock || 0) > 0;
        else if (activeCardFilter === 'alerts') matchesCard = m.status === 'LOW_STOCK' || m.status === 'OUT_OF_STOCK';
        else if (activeCardFilter === 'healthy') matchesCard = m.status === 'HEALTHY';
        else if (activeCardFilter === 'low') matchesCard = m.status === 'LOW_STOCK';
        else if (activeCardFilter === 'out') matchesCard = m.status === 'OUT_OF_STOCK';
        else if (typeof activeCardFilter === 'number') {
          const regQty = m.region_stock ? m.region_stock[activeCardFilter] || 0 : (m.zone_stock ? m.zone_stock[activeCardFilter] || 0 : 0);
          matchesCard = Number(regQty) > 0;
        }

        return matchesQuery && matchesCat && matchesStatus && matchesCard;
      });

      const countEl = document.getElementById('dashFilteredCount');
      if (countEl) {
        countEl.innerHTML = `Showing <strong>${filtered.length}</strong> of <strong>${liveMaterials.length}</strong> materials`;
      }

      const container = document.getElementById('dashMatrixContainer');
      if (container) {
        container.innerHTML = renderMatrixTableHtml(filtered, liveRegions, regionHeaders);
        bindMatrixRowClickListeners(filtered);
      }
    }

    function bindMatrixRowClickListeners(materialsList) {
      document.querySelectorAll('#dashMatrixContainer tr[data-mat-id]').forEach((row) => {
        row.addEventListener('click', () => {
          const matId = row.dataset.matId;
          const matObj = materialsList.find(m => String(m.id) === String(matId));
          if (matObj) showMaterialDetailModal(matObj);
        });
      });
    }

    function applyCardFilter(filterKey, labelText) {
      activeCardFilter = filterKey;
      const banner = document.getElementById('dashActiveFilterBanner');
      const text = document.getElementById('dashActiveFilterText');
      if (banner && text) {
        if (filterKey) {
          text.textContent = labelText;
          banner.style.display = 'flex';
        } else {
          banner.style.display = 'none';
        }
      }

      document.querySelectorAll('.stat-card.interactive').forEach(c => {
        c.classList.toggle('active-filter', c.dataset.cardFilter === filterKey);
      });

      filterMatrix();
      document.getElementById('dashSummaryCard')?.scrollIntoView({ behavior: 'smooth' });
    }

    document.getElementById('dashGoReq')?.addEventListener('click', () => switchView('requisitions'));
    document.getElementById('dashGoDispatch')?.addEventListener('click', () => switchView('stockMove'));
    document.getElementById('dashGoPO')?.addEventListener('click', () => switchView('purchaseOrders'));

    let autoSyncTimer = null;
    document.getElementById('dashToggleAutoSync')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
        btn.textContent = 'Enable Auto-Sync';
        btn.style.borderColor = '';
        btn.style.color = '';
        toast('Live Auto-Sync disabled');
      } else {
        autoSyncTimer = setInterval(() => {
          renderDashboard();
        }, 30000);
        btn.textContent = 'Auto-Syncing (30s)';
        btn.style.borderColor = 'var(--ok, #10b981)';
        btn.style.color = 'var(--ok, #10b981)';
        toast('Live Auto-Sync enabled (refreshes every 30 seconds)');
      }
    });

    el.querySelectorAll('.stat-card.interactive').forEach((card) => {
      card.addEventListener('click', () => {
        const key = card.dataset.cardFilter;
        if (key === 'all' || key === 'valuation') applyCardFilter(null, '');
        else if (key === 'ho') applyCardFilter('ho', 'Head Office Warehouse Stock');
        else if (key === 'region') applyCardFilter('region', 'Regional Hubs Stock');
        else if (key === 'site') applyCardFilter('site', 'Site Deployed Stock');
        else if (key === 'transit') applyCardFilter('transit', 'In-Transit Equipment');
        else if (key === 'alerts') applyCardFilter('alerts', 'Stock Alerts (Low & Out of Stock)');
      });
    });

    document.getElementById('dashFilterHealthy')?.addEventListener('click', () => applyCardFilter('healthy', 'Healthy Stock Only'));
    document.getElementById('dashFilterLow')?.addEventListener('click', () => applyCardFilter('low', 'Low Stock Items Only'));
    document.getElementById('dashFilterOut')?.addEventListener('click', () => applyCardFilter('out', 'Out of Stock Items Only'));

    el.querySelectorAll('.region-summary-row').forEach((row) => {
      row.addEventListener('click', () => {
        const regId = row.dataset.regionFilter;
        if (regId === 'ho') applyCardFilter('ho', 'Head Office Warehouse Stock');
        else if (regId === 'site') applyCardFilter('site', 'Site Deployed Stock');
        else if (regId === 'transit') applyCardFilter('transit', 'In-Transit Equipment');
        else {
          const regObj = liveRegions.find(r => String(r.id) === String(regId));
          applyCardFilter(Number(regId), `${regObj ? regObj.name : 'Region'} Regional Stock`);
        }
      });
    });

    document.getElementById('dashClearActiveFilter')?.addEventListener('click', () => {
      applyCardFilter(null, '');
      if (document.getElementById('dashSearch')) document.getElementById('dashSearch').value = '';
      if (document.getElementById('dashCategoryFilter')) document.getElementById('dashCategoryFilter').value = '';
      if (document.getElementById('dashStatusFilter')) document.getElementById('dashStatusFilter').value = '';
      filterMatrix();
    });

    document.getElementById('dashSearch')?.addEventListener('input', filterMatrix);
    document.getElementById('dashCategoryFilter')?.addEventListener('change', filterMatrix);
    document.getElementById('dashStatusFilter')?.addEventListener('change', filterMatrix);

    document.getElementById('dashExportCsv')?.addEventListener('click', () => {
      downloadInventoryCSV(liveMaterials, liveRegions);
      toast('Live Inventory CSV report downloaded');
    });

    document.getElementById('dashExportPdf')?.addEventListener('click', () => {
      downloadInventoryPDF(liveMaterials, liveRegions);
      toast('Preparing PDF print report…');
    });

    document.getElementById('dashRefreshLive')?.addEventListener('click', () => {
      renderDashboard();
      toast('Dashboard live data refreshed');
    });

    bindMatrixRowClickListeners(liveMaterials);

  } catch (err) {
    el.innerHTML = `<div class="empty-state">Could not load dashboard: ${err.message}</div>`;
  }
}

function renderMatrixTableHtml(materials, regions, regionHeaders) {
  if (!materials.length) {
    return `<div class="empty-state">No matching materials found in inventory.</div>`;
  }
  return `
    <div class="table-responsive">
      <table class="zsm-matrix-table">
        <thead>
          <tr>
            <th>Material Info</th>
            <th>Category</th>
            <th>Unit Price</th>
            <th>Min Stock</th>
            <th>HO Stock</th>
            ${regionHeaders}
            <th>Total Region</th>
            <th>Deployed (Site)</th>
            <th>In Transit</th>
            <th>Total Active</th>
            <th>Total Value</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${materials.map((m) => {
    const regCells = regions.map((r) => {
      const qty = Number(m.region_stock ? m.region_stock[r.id] || 0 : (m.zone_stock ? m.zone_stock[r.id] || 0 : 0));
      return `<td><span class="zsm-zone-pill ${qty > 0 ? 'has-stock' : ''}">${qty} ${m.unit}</span></td>`;
    }).join('');

    let statusPill = `<span class="pill pill-success">HEALTHY</span>`;
    if (m.status === 'LOW_STOCK') statusPill = `<span class="pill pill-warning">LOW STOCK</span>`;
    if (m.status === 'OUT_OF_STOCK') statusPill = `<span class="pill pill-danger">OUT OF STOCK</span>`;

    return `<tr data-mat-id="${m.id}" title="Click to view complete stock details for ${m.name}">
              <td>
                <div class="zsm-material-title">${m.name}</div>
                ${m.barcode_prefix ? `<span class="zsm-prefix-tag">Prefix: ${m.barcode_prefix}</span>` : ''}
              </td>
              <td><span class="pill">${m.category}</span></td>
              <td class="mono">${money(m.price)}</td>
              <td class="mono">${m.min_stock_level} ${m.unit}</td>
              <td class="mono"><strong>${m.ho_stock}</strong> ${m.unit}</td>
              ${regCells}
              <td class="mono"><strong style="color:var(--brand)">${m.total_region_stock || m.total_zone_stock || 0}</strong> ${m.unit}</td>
              <td class="mono">${m.site_stock} ${m.unit}</td>
              <td class="mono">${m.in_transit_stock} ${m.unit}</td>
              <td class="mono"><strong>${m.total_active_stock}</strong> ${m.unit}</td>
              <td class="mono" style="color:var(--brand);font-weight:600">${money(Number(m.total_active_stock || 0) * Number(m.price || 0))}</td>
              <td>${statusPill}</td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function showMaterialDetailModal(m) {
  const existing = document.getElementById('matDetailModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'matDetailModal';
  overlay.className = 'modal-overlay';
  const price = Number(m.price || 0);
  const totalVal = Number(m.total_active_stock || 0) * price;

  overlay.innerHTML = `
    <div class="modal-card" style="max-width:620px" role="dialog" aria-modal="true" aria-label="Material Inventory Details">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px">
        <div>
          <h3 style="margin:0">${m.name}</h3>
          <div class="muted" style="font-size:12px; margin-top:2px">Category: <strong>${m.category || 'General'}</strong> ${m.barcode_prefix ? `· Prefix: <code class="mono">${m.barcode_prefix}</code>` : ''}</div>
        </div>
        <button id="closeMatDetailTop" class="btn-ghost small" aria-label="Close modal">&times;</button>
      </div>

      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:16px; text-align:center">
        <div style="background:var(--bg-subtle, #f8fafc); border:1px solid var(--border, #e2e8f0); padding:10px; border-radius:6px">
          <div style="font-size:11px; color:var(--text-muted)">Unit Price</div>
          <div style="font-size:16px; font-weight:700; color:var(--brand)">${money(price)}</div>
        </div>
        <div style="background:var(--bg-subtle, #f8fafc); border:1px solid var(--border, #e2e8f0); padding:10px; border-radius:6px">
          <div style="font-size:11px; color:var(--text-muted)">Total Active Stock</div>
          <div style="font-size:16px; font-weight:700; color:var(--text)">${m.total_active_stock || 0} ${m.unit || 'pcs'}</div>
        </div>
        <div style="background:var(--bg-subtle, #f8fafc); border:1px solid var(--border, #e2e8f0); padding:10px; border-radius:6px">
          <div style="font-size:11px; color:var(--text-muted)">Total Stock Value</div>
          <div style="font-size:16px; font-weight:700; color:var(--brand)">${money(totalVal)}</div>
        </div>
      </div>

      <h4 style="margin:0 0 8px 0; font-size:13px">Location Stock Breakdown</h4>
      <table style="font-size:12px; margin-bottom:16px">
        <thead>
          <tr><th>Location Type</th><th>Location Name</th><th>Available Stock</th></tr>
        </thead>
        <tbody>
          <tr><td>Head Office</td><td>Central Warehouse</td><td class="mono"><strong>${m.ho_stock || 0}</strong> ${m.unit || 'pcs'}</td></tr>
          <tr><td>Site Deployed</td><td>Active Field Sites</td><td class="mono"><strong>${m.site_stock || 0}</strong> ${m.unit || 'pcs'}</td></tr>
          <tr><td>In Transit</td><td>En Route Logistics</td><td class="mono"><strong style="color:var(--warn)">${m.in_transit_stock || 0}</strong> ${m.unit || 'pcs'}</td></tr>
          ${(State.regions || []).map(r => {
    const regQty = m.region_stock ? m.region_stock[r.id] || 0 : (m.zone_stock ? m.zone_stock[r.id] || 0 : 0);
    return `<tr><td>Regional Hub</td><td>${r.name}</td><td class="mono"><strong>${regQty}</strong> ${m.unit || 'pcs'}</td></tr>`;
  }).join('')}
        </tbody>
      </table>

      <div style="display:flex; justify-content:flex-end; gap:8px">
        <button id="closeMatDetailBtn" class="btn-ghost" type="button">Close</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const closeFn = () => overlay.remove();
  overlay.querySelector('#closeMatDetailBtn').addEventListener('click', closeFn);
  overlay.querySelector('#closeMatDetailTop').addEventListener('click', closeFn);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });
}

let poActiveTab = 'list';

async function renderPurchaseOrders() {
  const el = document.getElementById('view-purchaseOrders');
  if (State.user.role === 'site_engineer') {
    el.innerHTML = `<div class="empty-state">Purchase orders are managed by regional admins.</div>`;
    return;
  }
  const isRegionAdminOrAbove = ['super_admin', 'region_admin', 'zone_admin'].includes(State.user.role);

  el.innerHTML = `
    <div class="tab-strip">
      <button class="tab-btn ${poActiveTab === 'list' ? 'active' : ''}" data-po-tab="list">All Purchase Orders</button>
      ${isRegionAdminOrAbove ? `<button class="tab-btn ${poActiveTab === 'upload' ? 'active' : ''}" data-po-tab="upload">Upload PO (PDF)</button>` : ''}
      <button class="tab-btn ${poActiveTab === 'manual' ? 'active' : ''}" data-po-tab="manual">Direct Region Purchase</button>
    </div>
    <div id="poTabContent"></div>
  `;
  el.querySelectorAll('[data-po-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { poActiveTab = btn.dataset.poTab; renderPurchaseOrders(); });
  });

  const content = document.getElementById('poTabContent');
  if (poActiveTab === 'list') return renderPOList(content);
  if (poActiveTab === 'upload') return renderPOUpload(content);
  if (poActiveTab === 'manual') return renderPOManual(content);
}

async function renderPOList(content) {
  content.innerHTML = `<div class="empty-state">Loading…</div>`;
  const pos = await Api.purchaseOrders();
  if (!pos.length) { content.innerHTML = `<div class="empty-state">No purchase orders yet.</div>`; return; }

  const canManagePo = (po) => State.user.role === 'super_admin' || (['zone_admin', 'region_admin'].includes(State.user.role) && po.zone_id === State.user.zoneId);
  const canApprove = (po) => State.user.role === 'super_admin' && !['CONFIRMED', 'REJECTED', 'APPROVED'].includes(po.status);

  content.innerHTML = `<div class="card"><table><thead><tr>
    <th>PO Number</th><th>Destination</th><th>Entry mode</th><th>Status</th><th>Uploaded by</th><th>Date</th><th></th>
  </tr></thead><tbody>
    ${pos.map((po) => `<tr>
      <td class="non-mono">${po.po_number}</td>
      <td>${po.destination_type}${po.zone_name ? ' · ' + po.zone_name : ''}</td>
      <td>${po.entry_mode}</td>
      <td>${pill(po.status)}</td>
      <td class="non-mono">${po.uploaded_by_name || '—'}</td>
      <td>${fmtDate(po.created_at)}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-secondary" data-po-view="${po.id}">${po.status === 'CONFIRMED' ? 'View Details &amp; Barcodes' : 'Review'}</button>
          ${canApprove(po) ? `<button class="btn-primary small" data-po-approve="${po.id}">Approve</button><button class="btn-ghost small" data-po-reject="${po.id}">Reject</button>` : ''}
        </div>
      </td>
    </tr>`).join('')}
  </tbody></table></div>
  <div id="poDetail"></div>`;

  content.querySelectorAll('[data-po-view]').forEach((btn) => {
    btn.addEventListener('click', () => renderPODetail(document.getElementById('poDetail'), btn.dataset.poView));
  });

  content.querySelectorAll('[data-po-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await Api.approvePO(btn.dataset.poApprove);
        toast('Purchase order approved');
        await renderPurchaseOrders();
      } catch (err) { toast(err.message, true); }
    });
  });

  content.querySelectorAll('[data-po-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const reason = window.prompt('Optional rejection reason (leave blank if none):') || '';
        await Api.rejectPO(btn.dataset.poReject, reason.trim() || undefined);
        toast('Purchase order rejected');
        await renderPurchaseOrders();
      } catch (err) { toast(err.message, true); }
    });
  });
}

async function renderPODetail(el, poId) {
  el.innerHTML = `<div class="empty-state">Loading purchase order…</div>`;
  const po = await Api.purchaseOrder(poId);
  const isOwnZonePurchase =
    ['zone_admin', 'region_admin'].includes(State.user.role) &&
    ['REGION', 'ZONE'].includes(po.destination_type) &&
    (Number(po.region_id || po.zone_id) === Number(State.user.regionId || State.user.zoneId));
  const editable = po.status !== 'CONFIRMED' && (isSuperAdmin || isOwnZonePurchase);

  const generatedBarcodesMarkup = po.generated_barcodes && po.generated_barcodes.length ? `
    <div class="section-header" style="margin-top:24px;display:flex;justify-content:space-between;align-items:center">
      <h3>Generated Barcodes &amp; Trackable Units (${po.generated_barcodes.length})</h3>
      <button class="btn-primary small" id="btnPrintPoBarcodes" type="button">Print All Barcodes</button>
    </div>
    <div class="card">
      <p class="muted" style="font-size:12.5px;margin-top:0">The following trackable barcode serials were auto-generated and posted into active stock against this Purchase Order.</p>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th style="width:40px">#</th>
              <th>Barcode / Serial Value</th>
              <th>Material Name</th>
              <th>Stock Status</th>
              <th style="width:120px">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${po.generated_barcodes.map((bItem, idx) => {
    const code = bItem.barcode_value;
    const title = (bItem.material_name || bItem.material_name_raw || 'PO Item').replace(/"/g, '&quot;');
    return `
                <tr>
                  <td class="muted">${idx + 1}</td>
                  <td class="mono" style="font-weight:600;color:var(--brand);font-size:13.5px">${code}</td>
                  <td class="non-mono"><strong>${bItem.material_name || bItem.material_name_raw || '—'}</strong></td>
                  <td>${pill(bItem.status)}</td>
                  <td>
                    <button class="btn-secondary small" data-po-bc="${code}" data-po-mat="${title}" type="button">View / Print</button>
                  </td>
                </tr>
              `;
  }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  ` : (po.status === 'CONFIRMED' ? `
    <div class="card" style="margin-top:20px"><p class="muted">This purchase order has been confirmed and posted into active stock.</p></div>
  ` : '');

  el.innerHTML = `
    <div class="section-header"><h3>${po.po_number} — line items</h3></div>
    <div class="card">
      ${po.extraction_note ? `<p class="muted" style="margin-top:0">${po.extraction_note}</p>` : ''}
      ${po.notes ? `<p class="muted" style="margin-top:0"><strong>Note:</strong> ${po.notes}</p>` : ''}
      <div id="poItemsTable"></div>
      ${editable ? `
        <div class="section-header"><h3>Add a line item</h3></div>
        <div class="form-inline">
          <div class="form-row"><label>Material name</label><input id="newItemName" placeholder="e.g. Power Cable 16sqmm" /></div>
          <div class="form-row"><label>Qty</label><input id="newItemQty" type="number" step="0.01" /></div>
          <div class="form-row"><label>Unit price</label><input id="newItemPrice" type="number" step="0.01" /></div>
          <div class="form-row" style="justify-content:flex-end"><label>&nbsp;</label><button class="btn-secondary" id="addItemBtn">Add item</button></div>
        </div>
        <div class="section-header"><h3>Confirm &amp; post to stock</h3></div>
        <p class="muted">Materials are automatically fetched from the Purchase Order. Barcodes will be auto-generated in ascending order for all units upon confirmation, or you can customize barcode prefixes / custom serials below.</p>
        <div id="serialInputs"></div>
        <button class="btn-primary" id="confirmPoBtn">Confirm purchase order &amp; generate barcodes</button>
      ` : ''}
    </div>
    ${generatedBarcodesMarkup}
  `;

  await renderPOItemsTable(document.getElementById('poItemsTable'), po, editable);

  const printPoBtn = el.querySelector('#btnPrintPoBarcodes');
  if (printPoBtn && po.generated_barcodes) {
    printPoBtn.addEventListener('click', () => {
      showBatchBarcodeModal(po.generated_barcodes);
    });
  }

  el.querySelectorAll('[data-po-bc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showBarcodeModal(btn.dataset.poBc, btn.dataset.poMat, { is_serialized: true });
    });
  });

  const canApprovePo = State.user.role === 'super_admin';
  if (canApprovePo && !['CONFIRMED', 'REJECTED', 'APPROVED'].includes(po.status)) {
    const btnHtml = `<div style="margin-top:10px"><button class="btn-primary" id="approvePoBtn">Approve</button><button class="btn-ghost" id="rejectPoBtn">Reject</button></div>`;
    el.querySelector('.card').insertAdjacentHTML('beforeend', btnHtml);
    document.getElementById('approvePoBtn').addEventListener('click', async () => {
      try { await Api.approvePO(po.id); toast('Purchase order accepted'); renderPODetail(el, poId); }
      catch (err) { toast(err.message, true); }
    });
    document.getElementById('rejectPoBtn').addEventListener('click', async () => {
      try {
        const reason = window.prompt('Optional rejection reason (leave blank if none):') || '';
        await Api.rejectPO(po.id, reason.trim() || undefined);
        toast('Purchase order rejected'); renderPODetail(el, poId);
      } catch (err) { toast(err.message, true); }
    });
  }

  if (editable) {
    const serialContainer = document.getElementById('serialInputs');
    const allItems = po.items || [];
    if (allItems.length) {
      serialContainer.innerHTML = allItems.map((i) => {
        const qty = Math.round(i.quantity || 1);
        const matId = i.material_id || i.id;
        const defaultPrefix = `MAT${matId}-PO${po.id}-`;
        const startStr = `${defaultPrefix}0001`;
        const endStr = `${defaultPrefix}${String(qty).padStart(4, '0')}`;
        return `
          <div class="card" style="margin-bottom:14px;padding:14px;background:var(--surface-raised, #f8fafc);border:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <strong>${i.material_name_raw || i.matched_material_name || 'Material Item'}</strong>
              <span class="badge" style="background:var(--brand-dim, rgba(227,30,36,0.1));color:var(--brand);font-weight:600">Qty: ${qty} units</span>
            </div>
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px">
              <div>
                <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Custom Barcode Prefix</label>
                <input data-prefix-for="${i.id}" value="${defaultPrefix}" style="font-family:var(--font-mono, monospace);padding:6px 10px;width:100%;font-size:13px;border-radius:var(--radius);border:1px solid var(--border)" placeholder="e.g. CZ-MUM-CABLE- or MAT001-" />
              </div>
              <div>
                <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Start Number</label>
                <input type="number" min="1" data-startnum-for="${i.id}" value="1" style="font-family:var(--font-mono, monospace);padding:6px 10px;width:100%;font-size:13px;border-radius:var(--radius);border:1px solid var(--border)" placeholder="1" />
              </div>
              <div>
                <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Digit Padding</label>
                <input type="number" min="1" max="10" data-padlen-for="${i.id}" value="4" style="font-family:var(--font-mono, monospace);padding:6px 10px;width:100%;font-size:13px;border-radius:var(--radius);border:1px solid var(--border)" placeholder="4" />
              </div>
            </div>
            <div style="margin-bottom:8px">
              <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Manual Serials (Optional override, comma-separated)</label>
              <input data-serial-for="${i.id}" placeholder="SN-0001, SN-0002..." style="padding:6px 10px;width:100%;font-size:13px;border-radius:var(--radius);border:1px solid var(--border)" />
            </div>
            <div class="muted" data-preview-for="${i.id}" style="font-size:12px;padding:6px 10px;background:var(--surface);border-radius:var(--radius-sm, 4px);border:1px solid var(--border-soft)">
              Barcode Range Preview (${qty} units): <strong style="color:var(--brand);font-family:var(--font-mono)">${startStr}</strong> &rarr; <strong style="color:var(--brand);font-family:var(--font-mono)">${endStr}</strong>
            </div>
          </div>
        `;
      }).join('');

      allItems.forEach((itemObj) => {
        const itemId = itemObj.id;
        const prefixInput = serialContainer.querySelector(`[data-prefix-for="${itemId}"]`);
        const startNumInput = serialContainer.querySelector(`[data-startnum-for="${itemId}"]`);
        const padLenInput = serialContainer.querySelector(`[data-padlen-for="${itemId}"]`);
        const previewLbl = serialContainer.querySelector(`[data-preview-for="${itemId}"]`);
        const qty = Math.round(itemObj.quantity || 1);

        function updateRangePreview() {
          const matId = itemObj.material_id || itemObj.id;
          const prefixVal = (prefixInput && prefixInput.value.trim() !== '') ? prefixInput.value.trim() : `MAT${matId}-PO${po.id}-`;
          const rawStart = startNumInput ? parseInt(startNumInput.value, 10) : 1;
          const startSeq = (!isNaN(rawStart) && rawStart >= 0) ? rawStart : 1;
          const rawPad = padLenInput ? parseInt(padLenInput.value, 10) : 4;
          const padLen = (!isNaN(rawPad) && rawPad >= 1) ? Math.max(rawPad, String(startSeq + qty - 1).length) : Math.max(4, String(startSeq + qty - 1).length);

          const startStr = `${prefixVal}${String(startSeq).padStart(padLen, '0')}`;
          const endStr = `${prefixVal}${String(startSeq + qty - 1).padStart(padLen, '0')}`;

          if (previewLbl) {
            previewLbl.innerHTML = `Barcode Range Preview (${qty} units): <strong style="color:var(--brand);font-family:var(--font-mono)">${startStr}</strong> &rarr; <strong style="color:var(--brand);font-family:var(--font-mono)">${endStr}</strong>`;
          }
        }

        prefixInput?.addEventListener('input', updateRangePreview);
        startNumInput?.addEventListener('input', updateRangePreview);
        padLenInput?.addEventListener('input', updateRangePreview);
      });
    } else {
      serialContainer.innerHTML = `<p class="muted">Add line items to configure barcodes for this purchase order.</p>`;
    }

    document.getElementById('addItemBtn').addEventListener('click', async () => {
      try {
        await Api.addPOItem(po.id, {
          material_name_raw: document.getElementById('newItemName').value,
          quantity: parseFloat(document.getElementById('newItemQty').value),
          unit_price: parseFloat(document.getElementById('newItemPrice').value || 0)
        });
        toast('Line item added');
        renderPODetail(el, poId);
      } catch (err) { toast(err.message, true); }
    });

    document.getElementById('confirmPoBtn').addEventListener('click', async () => {
      const serials = {};
      serialContainer.querySelectorAll('[data-prefix-for]').forEach((prefixInput) => {
        const itemId = prefixInput.dataset.prefixFor;
        const manualInput = serialContainer.querySelector(`[data-serial-for="${itemId}"]`);
        const startNumInput = serialContainer.querySelector(`[data-startnum-for="${itemId}"]`);
        const padLenInput = serialContainer.querySelector(`[data-padlen-for="${itemId}"]`);
        const manualList = manualInput ? manualInput.value.split(',').map((s) => s.trim()).filter(Boolean) : [];

        if (manualList.length) {
          serials[itemId] = manualList;
        } else {
          serials[itemId] = {
            prefix: prefixInput.value.trim() || undefined,
            startNum: (startNumInput && startNumInput.value !== '') ? parseInt(startNumInput.value, 10) : undefined,
            padLen: (padLenInput && padLenInput.value !== '') ? parseInt(padLenInput.value, 10) : undefined
          };
        }
      });
      try {
        await Api.confirmPO(po.id, { serials });
        toast(`${po.po_number} confirmed and trackable barcodes generated`);
        renderPurchaseOrders();
      } catch (err) { toast(err.message, true); }
    });
  }
}

async function renderPOItemsTable(el, po, editable) {
  let materialsList = [];
  if (editable) {
    try { materialsList = await Api.materials(); } catch (e) { materialsList = []; }
  }

  el.innerHTML = `<table>
    <thead>
      <tr>
        <th>Material Name (PO)</th>
        <th>Matched Material Master</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Total</th>
        ${editable ? '<th>Actions</th>' : ''}
      </tr>
    </thead>
    <tbody>
      ${po.items.map((i) => {
    const rawTitle = i.material_name_raw || '—';
    const matchedTitle = i.matched_material_name ? `<span class="badge success" style="font-weight:600">${i.matched_material_name}</span>` : `<span class="badge warning">Unmatched</span>`;

    let matchSelectHtml = '';
    if (editable && materialsList.length > 0) {
      matchSelectHtml = `
            <select data-match-item="${i.id}" style="padding:4px 8px;font-size:12px;border-radius:4px;border:1px solid var(--border);max-width:180px">
              <option value="">Auto-matched: ${i.matched_material_name || 'Select Master...'}</option>
              ${materialsList.map(m => `<option value="${m.id}" ${Number(m.id) === Number(i.material_id) ? 'selected' : ''}>${m.name} (${m.category || 'General'})</option>`).join('')}
            </select>`;
    }

    return `<tr>
          <td class="non-mono"><strong>${rawTitle}</strong></td>
          <td class="non-mono">${matchedTitle} ${matchSelectHtml}</td>
          <td>${i.quantity}</td>
          <td>${money(i.unit_price)}</td>
          <td>${money(i.line_total)}</td>
          ${editable ? `<td><button class="btn-ghost small danger" data-remove-item="${i.id}" style="color:var(--danger)">Remove</button></td>` : ''}
        </tr>`;
  }).join('')}
    </tbody>
  </table>`;

  if (editable) {
    el.querySelectorAll('[data-remove-item]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.deletePOItem(po.id, btn.dataset.removeItem);
          toast('Item removed');
          renderPODetail(el.closest('#poDetail'), po.id);
        } catch (err) { toast(err.message, true); }
      });
    });

    el.querySelectorAll('[data-match-item]').forEach((select) => {
      select.addEventListener('change', async () => {
        const itemId = select.dataset.matchItem;
        const selectedMatId = select.value;
        if (!selectedMatId) return;
        try {
          await Api.matchPOItem(po.id, itemId, selectedMatId);
          toast('Material Master re-matched successfully');
          renderPODetail(el.closest('#poDetail'), po.id);
        } catch (err) { toast(err.message, true); }
      });
    });
  }
}

function renderPOUpload(content) {
  const isSuperAdmin = State.user.role === 'super_admin';
  const defaultZoneId = State.user.regionId || State.user.zoneId;

  content.innerHTML = `
    <div class="card">
      <h3>Upload Purchase Order (PDF)</h3>
      <p class="muted" style="margin-top:0">Upload a PDF purchase order to auto-extract PO number and line items for review.</p>
      <form id="poUploadForm" onsubmit="event.preventDefault();">
        <div class="form-row"><label>Destination Location <span class="required">*</span></label>
          <select id="uploadDest">
            ${isSuperAdmin ? '<option value="" selected disabled>-- Select Destination Location --</option><option value="HO">Head Office (HO) Stock</option><option value="ZONE">Direct to a Region Warehouse</option>' : '<option value="ZONE" selected>Direct to your Region Warehouse</option>'}
          </select>
        </div>
        <div class="form-row" id="uploadZoneRow" ${isSuperAdmin ? 'hidden' : ''}>
          <label>Target Region <span class="required">*</span></label>
          <select id="uploadZone">${zoneOptions(defaultZoneId, 'Select Region')}</select>
        </div>
        <div class="form-row">
          <label>PO PDF File <span class="required">*</span></label>
          <input type="file" id="uploadFile" accept=".pdf,application/pdf" />
          <div id="fileSelectedInfo" class="muted" style="font-size:12px;margin-top:4px" hidden></div>
        </div>
        <button type="button" class="btn-primary" id="uploadBtn">Upload &amp; Extract PO Data</button>
      </form>
    </div>
  `;

  if (isSuperAdmin) {
    document.getElementById('uploadDest').addEventListener('change', (e) => {
      document.getElementById('uploadZoneRow').hidden = e.target.value !== 'ZONE';
    });
  }

  const fileInput = document.getElementById('uploadFile');
  const infoEl = document.getElementById('fileSelectedInfo');
  if (fileInput && infoEl) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        infoEl.textContent = `Selected File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        infoEl.hidden = false;
      } else {
        infoEl.hidden = true;
      }
    });
  }

  const handleUploadSubmit = async (e) => {
    if (e) e.preventDefault();

    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) return toast('Please select a PO PDF file to upload', true);

    const destVal = document.getElementById('uploadDest').value;
    if (!destVal) return toast('Please select a destination location', true);

    const targetZoneId = destVal === 'ZONE' ? document.getElementById('uploadZone').value : null;
    if (destVal === 'ZONE' && !targetZoneId) return toast('Please select a target region for stock upload', true);

    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) {
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading & Extracting PDF...';
    }

    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('destination_type', destVal);
    if (destVal === 'ZONE' && targetZoneId) {
      fd.append('zone_id', targetZoneId);
      fd.append('region_id', targetZoneId);
    }

    try {
      const po = await Api.uploadPO(fd);
      toast(`${po.po_number || 'Purchase order'} uploaded — review the extracted line items below`);
      poActiveTab = 'list';
      await renderPurchaseOrders();
      await renderPODetail(document.getElementById('poDetail'), po.id);
      const detailEl = document.getElementById('poDetail');
      if (detailEl) detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(err.message || 'Failed to upload purchase order PDF', true);
    } finally {
      const btn = document.getElementById('uploadBtn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Upload & Extract PO Data';
      }
    }
  };

  document.getElementById('uploadBtn').addEventListener('click', handleUploadSubmit);
  document.getElementById('poUploadForm').addEventListener('submit', handleUploadSubmit);
}

function renderPOManual(content) {
  content.innerHTML = `
    <div class="card">
      <h3>Direct Region Purchase Order Entry</h3>
      <p class="muted" style="margin-top:0">Manually enter a direct region purchase order to post directly to regional stock.</p>
      <div class="form-inline">
        <div class="form-row"><label>PO / reference number</label><input id="manualPoNumber" placeholder="PO-2026-XXXX" /></div>
        <div class="form-row"><label>Region</label><select id="manualZone">${zoneOptions(State.user.zoneId, 'Select Region')}</select></div>
      </div>
      <div class="form-row"><label>Note <span class="required">*</span></label><textarea id="manualPoNotes" rows="3" maxlength="500" required placeholder="Reason or details for this direct purchase"></textarea></div>
      <div id="manualItems"></div>
      <button class="btn-ghost" id="addManualItemRow">+ Add another material</button>
      <div style="margin-top:16px"><button class="btn-primary" id="submitManualPo">Create &amp; post to region stock</button></div>
    </div>
  `;
  const itemsEl = document.getElementById('manualItems');
  const addRow = () => {
    const row = document.createElement('div');
    row.className = 'po-item-row';
    row.innerHTML = `
      <select class="manual-material">${materialOptions()}</select>
      <input class="manual-qty" type="number" step="0.01" placeholder="Qty" />
      <input class="manual-price" type="number" step="0.01" placeholder="Unit price" />
      <span></span>
      <button class="btn-ghost" type="button">Remove</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    itemsEl.appendChild(row);
  };
  addRow();
  document.getElementById('addManualItemRow').addEventListener('click', addRow);

  document.getElementById('submitManualPo').addEventListener('click', async () => {
    const rows = [...itemsEl.querySelectorAll('.po-item-row')];
    const notes = document.getElementById('manualPoNotes').value.trim();
    if (!notes) return toast('A note is required for a direct region purchase', true);
    const items = rows.map((r) => ({
      material_id: r.querySelector('.manual-material').value,
      material_name: State.materials.find((m) => m.id === r.querySelector('.manual-material').value)?.name || '',
      quantity: parseFloat(r.querySelector('.manual-qty').value),
      unit_price: parseFloat(r.querySelector('.manual-price').value || 0)
    }));
    try {
      const po = await Api.manualPO({
        po_number: document.getElementById('manualPoNumber').value,
        zone_id: document.getElementById('manualZone').value,
        notes,
        items
      });
      toast(`${po.po_number} created — review the items below and confirm to post to region stock`);
      poActiveTab = 'list';
      await renderPurchaseOrders();
      renderPODetail(document.getElementById('poDetail'), po.id);
    } catch (err) { toast(err.message, true); }
  });
}

let stockTab = 'lookup';

function renderStockMove() {
  const el = document.getElementById('view-stockMove');
  const role = State.user.role;
  const isSuperAdmin = role === 'super_admin';
  const isZoneAdminUp = role === 'super_admin' || role === 'zone_admin' || role === 'region_admin';

  if (!isZoneAdminUp && ['dispatchZone', 'dispatchZoneToZone', 'receiveZone'].includes(stockTab)) {
    stockTab = 'lookup';
  }

  el.innerHTML = `
    <div class="tab-strip">
      <button class="tab-btn ${stockTab === 'lookup' ? 'active' : ''}" data-stock-tab="lookup">Scan Lookup</button>
      <button class="tab-btn ${stockTab === 'barcodes' ? 'active' : ''}" data-stock-tab="barcodes">Region/Site Barcodes</button>
      ${isSuperAdmin ? `<button class="tab-btn ${stockTab === 'dispatchZone' ? 'active' : ''}" data-stock-tab="dispatchZone">HO → Region Dispatch</button>` : ''}
      ${isZoneAdminUp ? `<button class="tab-btn ${stockTab === 'dispatchZoneToZone' ? 'active' : ''}" data-stock-tab="dispatchZoneToZone">Region → Region Dispatch</button>` : ''}
      ${isZoneAdminUp ? `<button class="tab-btn ${stockTab === 'receiveZone' ? 'active' : ''}" data-stock-tab="receiveZone">Region Receive</button>` : ''}
      <button class="tab-btn ${stockTab === 'consumption' ? 'active' : ''}" data-stock-tab="consumption">Consumption</button>
      <button class="tab-btn ${stockTab === 'returnStock' ? 'active' : ''}" data-stock-tab="returnStock">Return (Reverse Flow)</button>
    </div>
    <div id="stockTabContent"></div>
  `;
  el.querySelectorAll('[data-stock-tab]').forEach((btn) => btn.addEventListener('click', () => { stockTab = btn.dataset.stockTab; renderStockMove(); }));
  const content = document.getElementById('stockTabContent');

  if (stockTab === 'lookup') renderScanLookup(content);
  if (stockTab === 'barcodes') renderRegionalBarcodes(content);
  if (stockTab === 'dispatchZone') renderDispatchZone(content);
  if (stockTab === 'dispatchZoneToZone') renderDispatchZoneToZone(content);
  if (stockTab === 'receiveZone') renderReceiveZone(content);
  if (stockTab === 'consumption') renderConsumption(content);
  if (stockTab === 'returnStock') renderReturnStock(content);
}

async function renderRegionalBarcodes(content) {
  content.innerHTML = `<div class="empty-state">Loading active barcode inventory for your location…</div>`;
  try {
    const items = await Api.items();
    if (!items.length) {
      content.innerHTML = `<div class="card"><div class="empty-state">No barcode items currently recorded for your location.</div></div>`;
      return;
    }

    const userRole = State.user.role;
    const isEngineer = userRole === 'site_engineer';

    content.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div>
            <h3 style="margin:0">${isEngineer ? 'Site Barcode Inventory' : 'Regional Barcode Inventory'}</h3>
            <p class="muted" style="margin:4px 0 0 0;font-size:12.5px">Active trackable barcode serial numbers currently held in your ${isEngineer ? 'assigned site' : 'region'}</p>
          </div>
          <div style="font-size:12.5px;color:var(--text-muted);display:flex;align-items:center;gap:12px">
            <span>Total Tracked Items: <strong class="mono" style="color:var(--brand);font-size:14px">${items.length}</strong></span>
            <button class="btn-primary small" id="btnPrintBatchBc" type="button">Print Barcodes</button>
          </div>
        </div>

        <div class="zsm-toolbar" style="margin-bottom:16px;border-radius:var(--radius)">
          <div class="zsm-filter-group">
            <input type="text" id="bcSearch" placeholder="Search barcode value, serial #, material..." style="min-width:260px" />
            <select id="bcStatusFilter">
              <option value="">All Statuses</option>
              <option value="IN_REGION">In Region Stock</option>
              <option value="IN_SITE">In Site Stock</option>
              <option value="IN_HO">In HO Stock</option>
              <option value="IN_TRANSIT_TO_REGION">In Transit to Region</option>
              <option value="IN_TRANSIT_TO_SITE">In Transit to Site</option>
              <option value="CONSUMED">Consumed</option>
              <option value="REPAIRABLE">Repairable</option>
              <option value="SCRAP">Scrap</option>
            </select>
          </div>
        </div>

        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th style="width:40px">#</th>
                <th>Barcode / Serial Value</th>
                <th>Material Name</th>
                <th>Status</th>
                <th>Region</th>
                <th>Site</th>
                <th style="width:180px">Actions</th>
              </tr>
            </thead>
            <tbody id="bcTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    let currentFiltered = items;

    function renderBcRows() {
      const q = (document.getElementById('bcSearch')?.value || '').trim().toLowerCase();
      const statusFilter = document.getElementById('bcStatusFilter')?.value || '';

      currentFiltered = items.filter((it) => {
        const matchesQ = !q ||
          (it.barcode_value || '').toLowerCase().includes(q) ||
          (it.serial_number || '').toLowerCase().includes(q) ||
          (it.material_name || '').toLowerCase().includes(q);
        const matchesStatus = !statusFilter || it.status === statusFilter;
        return matchesQ && matchesStatus;
      });

      const bodyEl = document.getElementById('bcTableBody');
      if (!bodyEl) return;

      if (!currentFiltered.length) {
        bodyEl.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">No barcodes matching filter criteria.</td></tr>`;
        return;
      }

      bodyEl.innerHTML = currentFiltered.map((it, idx) => `
        <tr>
          <td class="muted">${idx + 1}</td>
          <td class="mono" style="font-weight:600;color:var(--brand);font-size:13.5px">${it.barcode_value || it.serial_number}</td>
          <td class="non-mono"><strong>${it.material_name}</strong></td>
          <td>${pill(it.status)}</td>
          <td class="non-mono">${it.region_name || it.zone_name || '—'}</td>
          <td class="non-mono">${it.site_name || '—'}</td>
          <td style="display:flex;gap:6px">
            <button class="btn-secondary small" data-view-bc="${it.barcode_value || it.serial_number}" data-mat-name="${it.material_name || 'Item'}" type="button">View / Print</button>
            <button class="btn-ghost small" data-copy-bc="${it.barcode_value || it.serial_number}" type="button">Copy</button>
          </td>
        </tr>
      `).join('');

      bodyEl.querySelectorAll('[data-view-bc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const code = btn.dataset.viewBc;
          const title = btn.dataset.matName;
          showBarcodeModal(code, title, { is_serialized: true });
        });
      });

      bodyEl.querySelectorAll('[data-copy-bc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(btn.dataset.copyBc);
          toast(`Copied ${btn.dataset.copyBc} to clipboard`);
        });
      });
    }

    document.getElementById('btnPrintBatchBc')?.addEventListener('click', () => {
      if (!currentFiltered.length) {
        return toast('No barcodes to print', true);
      }
      showBatchBarcodeModal(currentFiltered);
    });

    document.getElementById('bcSearch')?.addEventListener('input', renderBcRows);
    document.getElementById('bcStatusFilter')?.addEventListener('change', renderBcRows);
    renderBcRows();
  } catch (err) {
    content.innerHTML = `<div class="card"><div class="empty-state">Could not load barcode inventory: ${err.message}</div></div>`;
  }
}

function scanBoxHtml(inputId, label = 'QR code value', placeholder = 'Scan or type QR code value(s)') {
  return `<div class="scan-box">
    <div class="form-row" style="flex:1">
      <label>${label}</label>
      <div style="display:flex; gap:8px; align-items:center">
        <input id="${inputId}" placeholder="${placeholder}" style="flex:1" />
        <button class="btn-secondary" id="${inputId}_scanBtn" type="button" style="white-space:nowrap; display:inline-flex; align-items:center; gap:6px">
         Scan QR code
        </button>
      </div>
    </div>
  </div>`;
}

function wireScanBox(inputId) {
  const scanBtn = document.getElementById(`${inputId}_scanBtn`);
  if (!scanBtn) return;
  scanBtn.addEventListener('click', () => {
    Scan.openModal((scannedText) => {
      const input = document.getElementById(inputId);
      if (!input) return;
      if (input.value.trim()) {
        const existing = input.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!existing.includes(scannedText)) {
          existing.push(scannedText);
          input.value = existing.join(', ');
        }
      } else {
        input.value = scannedText;
      }
      toast(`Scanned: ${scannedText}`);
    }, { title: `Camera QR Scanner`, continuous: true });
  });
}

function renderScanLookup(content) {
  const materials = [...(State.materials || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const materialOptions = materials.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.category || 'General')})</option>`).join('');

  let activeMode = 'barcode';

  content.innerHTML = `<div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:12px">
      <h3>Scan QR &amp; Item/Material Lookup</h3>
      <div style="display:flex; gap:8px">
        <button class="btn-secondary active" id="lookupModeBarcodeBtn" type="button">Barcode / Serial Lookup</button>
        <button class="btn-secondary" id="lookupModeMaterialBtn" type="button">Material Name Lookup</button>
      </div>
    </div>
    <p class="muted" id="lookupHelpText">Scan or enter a QR code value, serial number, or master code prefix to view item status and history.</p>

    <div id="barcodeLookupSection">
      ${scanBoxHtml('lookupSerial', 'QR code value / Serial number', 'e.g. MAT001-000001, scan QR code, or material name')}
    </div>

    <div id="materialLookupSection" style="display:none">
      <div class="form-group" style="margin-bottom:12px">
        <label for="lookupMaterialSelect" style="font-weight:600; display:block; margin-bottom:6px">Select Material Name</label>
        <select id="lookupMaterialSelect" class="form-control" style="width:100%; padding:10px; border-radius:var(--radius); border:1px solid var(--border)">
          <option value="">-- Select a Material --</option>
          ${materialOptions}
        </select>
      </div>
    </div>

    <div style="margin-top:14px">
      <button class="btn-primary" id="lookupBtn" type="button">Look up</button>
    </div>

    <div id="lookupResult" style="margin-top:20px"></div>
  </div>`;

  wireScanBox('lookupSerial');

  if (!State.materials || !State.materials.length) {
    loadMaterials().then(() => {
      const select = document.getElementById('lookupMaterialSelect');
      if (select) {
        const updatedMaterials = [...(State.materials || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        select.innerHTML = '<option value="">-- Select a Material --</option>' +
          updatedMaterials.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.category || 'General')})</option>`).join('');
      }
    }).catch(() => { });
  }

  const barcodeBtn = document.getElementById('lookupModeBarcodeBtn');
  const materialBtn = document.getElementById('lookupModeMaterialBtn');
  const barcodeSection = document.getElementById('barcodeLookupSection');
  const materialSection = document.getElementById('materialLookupSection');
  const helpText = document.getElementById('lookupHelpText');
  const materialSelect = document.getElementById('lookupMaterialSelect');

  const setMode = (mode) => {
    activeMode = mode;
    if (mode === 'barcode') {
      barcodeBtn.classList.add('active');
      materialBtn.classList.remove('active');
      barcodeSection.style.display = 'block';
      materialSection.style.display = 'none';
      helpText.textContent = 'Scan or enter a barcode value, serial number, or master barcode prefix to view item status and history.';
    } else {
      materialBtn.classList.add('active');
      barcodeBtn.classList.remove('active');
      materialSection.style.display = 'block';
      barcodeSection.style.display = 'none';
      helpText.textContent = 'Select a material by name to view stock breakdown, unit price, and list of registered barcodes.';
    }
  };

  barcodeBtn.addEventListener('click', () => setMode('barcode'));
  materialBtn.addEventListener('click', () => setMode('material'));

  const renderMaterialLookupResult = (materialsList) => {
    if (!materialsList || !materialsList.length) {
      return `<div class="empty-state">No materials found matching your lookup.</div>`;
    }

    return materialsList.map((itemData) => {
      const mat = itemData.material;
      const items = itemData.items || [];
      const summary = itemData.stockSummary || {};

      const itemsRows = items.map(it => `
        <tr>
          <td><strong>${escapeHtml(it.barcode_value || it.serial_number || '')}</strong></td>
          <td>${pill(it.status)}</td>
          <td class="non-mono">${escapeHtml(it.region_name || it.zone_name || '—')}</td>
          <td class="non-mono">${escapeHtml(it.site_name || '—')}</td>
          <td>${it.updated_at ? new Date(it.updated_at).toLocaleDateString() : '—'}</td>
        </tr>
      `).join('');

      return `
        <div class="card" style="margin-bottom:20px; border-top: 3px solid var(--brand, #E31E24);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:14px">
            <div>
              <h4 style="font-size:18px; font-weight:700; margin:0 0 4px 0">${escapeHtml(mat.name)}</h4>
              <span class="badge" style="background:var(--bg-subtle,#f1f5f9); color:var(--text-muted,#475569)">Category: ${escapeHtml(mat.category || 'General')}</span>
              <span class="badge" style="background:var(--bg-subtle,#f1f5f9); color:var(--text-muted,#475569); margin-left:6px">Unit: ${escapeHtml(mat.unit || 'pcs')}</span>
            </div>
            <div style="text-align:right">
              <div style="font-size:13px; color:var(--text-muted,#64748b)">Unit Price: <strong>₹${parseFloat(mat.price || 0).toLocaleString()}</strong></div>
              <div style="font-size:13px; color:var(--text-muted,#64748b)">Min Stock Level: <strong>${mat.min_stock_level || 0}</strong></div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom:16px">
            <div style="background:var(--bg-subtle,#f8fafc); padding:10px; border-radius:var(--radius); text-align:center; border:1px solid var(--border-soft,#e2e8f0)">
              <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600">HO Stock</div>
              <div style="font-size:18px; font-weight:700; color:var(--brand,#E31E24)">${summary.hoStock || 0}</div>
            </div>
            <div style="background:var(--bg-subtle,#f8fafc); padding:10px; border-radius:var(--radius); text-align:center; border:1px solid var(--border-soft,#e2e8f0)">
              <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600">Regional Stock</div>
              <div style="font-size:18px; font-weight:700">${summary.regionStock || 0}</div>
            </div>
            <div style="background:var(--bg-subtle,#f8fafc); padding:10px; border-radius:var(--radius); text-align:center; border:1px solid var(--border-soft,#e2e8f0)">
              <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600">Site Stock</div>
              <div style="font-size:18px; font-weight:700">${summary.siteStock || 0}</div>
            </div>
            <div style="background:var(--bg-subtle,#f8fafc); padding:10px; border-radius:var(--radius); text-align:center; border:1px solid var(--border-soft,#e2e8f0)">
              <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600">Active Barcodes</div>
              <div style="font-size:18px; font-weight:700">${summary.activeSerializedCount || 0}</div>
            </div>
          </div>

          <h5 style="margin:16px 0 8px 0; font-size:14px; font-weight:600">Serialized Items (${items.length} total barcodes)</h5>
          ${items.length === 0 ? `
            <div class="empty-state" style="padding:16px; font-size:13px">No individual serialized items registered for this material yet.</div>
          ` : `
            <div class="table-responsive" style="max-height:300px; overflow-y:auto">
              <table>
                <thead>
                  <tr>
                    <th>Barcode / Serial</th>
                    <th>Status</th>
                    <th>Region</th>
                    <th>Site</th>
                    <th>Updated At</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;
    }).join('');
  };

  const doLookup = async () => {
    const resultEl = document.getElementById('lookupResult');
    resultEl.innerHTML = `<div class="muted">Looking up…</div>`;

    try {
      if (activeMode === 'material') {
        const materialId = materialSelect.value;
        if (!materialId) return toast('Please select a material from the dropdown', true);
        const res = await Api.lookupItemOrMaterial(null, materialId);
        if (res.resultType === 'material') {
          resultEl.innerHTML = renderMaterialLookupResult(res.materials);
        } else {
          toast('Material not found', true);
          resultEl.innerHTML = '';
        }
      } else {
        const queryText = document.getElementById('lookupSerial').value.trim();
        if (!queryText) return toast('Please enter or scan a barcode number or material name', true);
        const res = await Api.lookupItemOrMaterial(queryText);
        if (res.resultType === 'item') {
          const item = res.item;
          resultEl.innerHTML = `
            <div class="card" style="border:1px solid var(--brand, #E31E24)">
              <h4 style="margin-bottom:12px">Barcode Item Details</h4>
              <table><tbody>
                <tr><th>Material</th><td class="non-mono">${escapeHtml(item.material_name || '')}</td></tr>
                <tr><th>Barcode / Serial</th><td><strong>${escapeHtml(item.barcode_value || item.serial_number || '')}</strong></td></tr>
                <tr><th>Status</th><td>${pill(item.status)}</td></tr>
                <tr><th>Region</th><td class="non-mono">${escapeHtml(item.region_name || item.zone_name || '—')}</td></tr>
                <tr><th>Site</th><td class="non-mono">${escapeHtml(item.site_name || '—')}</td></tr>
                <tr><th>Created At</th><td>${new Date(item.created_at).toLocaleString()}</td></tr>
              </tbody></table>
            </div>`;
        } else if (res.resultType === 'material') {
          resultEl.innerHTML = renderMaterialLookupResult(res.materials);
        } else {
          toast('No item or material found matching your query', true);
          resultEl.innerHTML = '';
        }
      }
    } catch (err) {
      toast(err.message || 'Lookup failed', true);
      resultEl.innerHTML = '';
    }
  };

  document.getElementById('lookupBtn').addEventListener('click', doLookup);
  materialSelect.addEventListener('change', () => {
    if (materialSelect.value) doLookup();
  });

  document.getElementById('lookupSerial').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doLookup();
    }
  });
}

function renderScanMoveMultiMaterialBuilder(containerId, placeholderText = 'Select Material') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="line-items-container">
      <div class="line-items-header">
        <strong>Material Line Items (Add Multiple Materials)</strong>
        <button type="button" class="btn-secondary small sm-add-line-btn">+ Add Another Material</button>
      </div>
      <div class="table-responsive has-dropdowns">
        <table>
          <thead>
            <tr>
              <th style="width:40px; text-align:center">#</th>
              <th>MATERIAL</th>
              <th style="width:150px">BULK QUANTITY</th>
              <th>BARCODE NUMBERS / SERIAL NUMBERS</th>
              <th style="width:70px; text-align:center">ACTION</th>
            </tr>
          </thead>
          <tbody class="sm-lines-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const addLine = (matId = '', qty = '', serials = '') => {
    const tbody = container.querySelector('.sm-lines-tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'sm-item-row';
    tr.innerHTML = `
      <td style="text-align:center; font-weight:600" class="sm-row-num">1</td>
      <td><select class="sm-mat-select">${materialOptions(matId, placeholderText)}</select></td>
      <td><input type="number" step="0.01" class="sm-qty-input" value="${qty}" placeholder="e.g. 10.00" /></td>
      <td>
        <div style="display:flex; gap:6px; align-items:center">
          <input type="text" class="sm-serial-input" value="${serials}" placeholder="e.g. MAT001-000001, MAT001-000002" style="flex:1" />
          <button type="button" class="btn-secondary small sm-scan-btn" title="Scan barcode using camera" style="white-space:nowrap; display:inline-flex; align-items:center; gap:4px">
            Scan
          </button>
        </div>
      </td>
      <td style="text-align:center">
        <button type="button" class="btn-ghost small sm-del-btn" style="color:var(--danger)">Remove</button>
      </td>
    `;

    const scanBtn = tr.querySelector('.sm-scan-btn');
    const serialInput = tr.querySelector('.sm-serial-input');
    const qtyInput = tr.querySelector('.sm-qty-input');

    if (scanBtn && serialInput) {
      scanBtn.addEventListener('click', () => {
        Scan.openModal((scannedCode) => {
          const currentVal = serialInput.value.trim();
          const items = currentVal ? currentVal.split(',').map(s => s.trim()).filter(Boolean) : [];
          if (!items.includes(scannedCode)) {
            items.push(scannedCode);
            serialInput.value = items.join(', ');
            if (qtyInput && (!parseFloat(qtyInput.value) || parseFloat(qtyInput.value) < items.length)) {
              qtyInput.value = items.length;
            }
            toast(`Scanned barcode: ${scannedCode}`);
          } else {
            toast(`Barcode ${scannedCode} already scanned`, true);
          }
        }, { title: 'Scan Line Item Barcodes', continuous: true });
      });
    }

    tr.querySelector('.sm-del-btn').addEventListener('click', () => {
      tr.remove();
      updateRowNumbers();
    });
    tbody.appendChild(tr);
    updateRowNumbers();
    const sel = tr.querySelector('.sm-mat-select');
    if (sel) makeSearchableSelect(sel);
  };

  const updateRowNumbers = () => {
    const rows = container.querySelectorAll('.sm-lines-tbody tr');
    rows.forEach((r, idx) => {
      const numCell = r.querySelector('.sm-row-num');
      if (numCell) numCell.textContent = idx + 1;
      const delBtn = r.querySelector('.sm-del-btn');
      if (delBtn) delBtn.style.display = rows.length > 1 ? '' : 'none';
    });
  };

  addLine();
  container.querySelector('.sm-add-line-btn').addEventListener('click', () => addLine());
}

function getScanMoveMultiMaterialItems(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  const rows = [...container.querySelectorAll('.sm-lines-tbody tr')];
  const rawItems = rows.map(r => {
    const matId = r.querySelector('.sm-mat-select')?.value;
    const qty = parseFloat(r.querySelector('.sm-qty-input')?.value || 0);
    const rawSerials = r.querySelector('.sm-serial-input')?.value || '';
    const barcode_values = rawSerials.split(',').map(s => s.trim()).filter(Boolean);
    return {
      material_id: matId,
      materialId: matId,
      quantity: qty > 0 ? qty : undefined,
      barcode_values: barcode_values.length ? barcode_values : undefined,
      barcodeValues: barcode_values.length ? barcode_values : undefined,
      item_barcode_value: barcode_values.length ? barcode_values[0] : undefined
    };
  }).filter(l => l.material_id && ((l.quantity && l.quantity > 0) || (l.barcode_values && l.barcode_values.length > 0)));

  const consolidatedMap = new Map();
  for (const item of rawItems) {
    const key = String(item.material_id);
    if (!consolidatedMap.has(key)) {
      consolidatedMap.set(key, {
        material_id: item.material_id,
        materialId: item.material_id,
        quantity: item.quantity || 0,
        barcode_values: item.barcode_values ? [...item.barcode_values] : []
      });
    } else {
      const existing = consolidatedMap.get(key);
      existing.quantity = (existing.quantity || 0) + (item.quantity || 0);
      if (item.barcode_values) {
        for (const bc of item.barcode_values) {
          if (!existing.barcode_values.includes(bc)) {
            existing.barcode_values.push(bc);
          }
        }
      }
    }
  }

  return Array.from(consolidatedMap.values()).map(it => ({
    material_id: it.material_id,
    materialId: it.material_id,
    quantity: it.quantity > 0 ? it.quantity : undefined,
    barcode_values: it.barcode_values.length ? it.barcode_values : undefined,
    barcodeValues: it.barcode_values.length ? it.barcode_values : undefined,
    item_barcode_value: it.barcode_values.length ? it.barcode_values[0] : undefined
  }));
}

function renderDispatchZone(content) {
  if (State.user.role !== 'super_admin') { content.innerHTML = `<div class="empty-state">Only the super admin dispatches material from HO.</div>`; return; }
  content.innerHTML = `<div class="card">
    <h3>HO → Region Dispatch</h3>
    <div class="form-row"><label>Destination Region <span style="color:var(--danger)">*</span></label><select id="dzZone">${zoneOptions(null, 'Select Destination Region')}</select></div>
    <div id="dzMultiItemsBox"></div>
    <div class="form-row"><label>Notes / Dispatch Ref</label><input id="dzNotes" placeholder="e.g. Courier dispatch waybill #1234" /></div>
    <button class="btn-primary" id="dzSubmit" style="margin-top:14px">Record dispatch to region</button>
  </div>`;

  renderScanMoveMultiMaterialBuilder('dzMultiItemsBox', 'Select Material to Dispatch');

  document.getElementById('dzSubmit').addEventListener('click', async () => {
    const zoneId = document.getElementById('dzZone').value;
    const items = getScanMoveMultiMaterialItems('dzMultiItemsBox');

    if (!zoneId) return toast('Please select a destination region', true);
    if (!items.length) return toast('Please select at least one material and enter quantity or barcode numbers', true);

    try {
      await Api.dispatchToZone({
        zone_id: zoneId,
        region_id: zoneId,
        lines: items,
        items: items,
        notes: document.getElementById('dzNotes').value.trim() || undefined
      });
      toast('Dispatch to region recorded successfully');
      renderDispatchZone(content);
    } catch (err) { toast(err.message, true); }
  });
}

function renderDispatchZoneToZone(content) {
  if (State.user.role === 'site_engineer') {
    content.innerHTML = `<div class="empty-state">Region → Region dispatch is managed by regional admins.</div>`;
    return;
  }

  const initialFromZoneId = State.user.zoneId || (State.zones[0] && State.zones[0].id);

  content.innerHTML = `<div class="card">
    <h3>Region → Region Dispatch</h3>
    <p class="muted">Transfer material or serialized items directly from your region/site to another region/site location.</p>
    <div class="form-inline">
      <div class="form-row"><label>Source Region (From)</label><select id="dzzFromZone">${zoneOptions(initialFromZoneId, 'Select Source Region')}</select></div>
      <div class="form-row"><label>Source Site (From Site)</label><select id="dzzFromSite">${siteOptions(initialFromZoneId, null, 'Region Warehouse / Unassigned Site (Default)')}</select></div>
    </div>
    <div class="form-inline">
      <div class="form-row"><label>Destination Region (To)</label><select id="dzzToZone">${zoneOptions(null, 'Select Destination Region')}</select></div>
      <div class="form-row"><label>Destination Site (To Site)</label><select id="dzzToSite">${siteOptions(null, null, 'Region Warehouse / Unassigned Site (Default)')}</select></div>
    </div>
    <div id="dzzMultiItemsBox"></div>
    <div class="form-row"><label>Notes / Dispatch Ref</label><input id="dzzNotes" placeholder="e.g. Inter-region stock rebalancing" /></div>
    <button class="btn-primary" id="dzzSubmit" style="margin-top:14px">Record region to region dispatch</button>
  </div>`;

  renderScanMoveMultiMaterialBuilder('dzzMultiItemsBox', 'Select Material to Dispatch');

  const dzzFromZoneEl = document.getElementById('dzzFromZone');
  if (dzzFromZoneEl) {
    dzzFromZoneEl.addEventListener('change', () => {
      const selectedZoneId = dzzFromZoneEl.value;
      const dzzFromSiteEl = document.getElementById('dzzFromSite');
      if (dzzFromSiteEl) {
        dzzFromSiteEl.innerHTML = siteOptions(selectedZoneId, null, 'Region Warehouse / Unassigned Site (Default)');
      }
    });
  }

  const dzzToZoneEl = document.getElementById('dzzToZone');
  if (dzzToZoneEl) {
    dzzToZoneEl.addEventListener('change', () => {
      const selectedZoneId = dzzToZoneEl.value;
      const dzzToSiteEl = document.getElementById('dzzToSite');
      if (dzzToSiteEl) {
        dzzToSiteEl.innerHTML = siteOptions(selectedZoneId, null, 'Region Warehouse / Unassigned Site (Default)');
      }
    });
  }

  document.getElementById('dzzSubmit').addEventListener('click', async () => {
    const fromZoneId = document.getElementById('dzzFromZone').value;
    const fromSiteId = document.getElementById('dzzFromSite')?.value || undefined;
    const toZoneId = document.getElementById('dzzToZone').value;
    const toSiteId = document.getElementById('dzzToSite')?.value || undefined;
    const items = getScanMoveMultiMaterialItems('dzzMultiItemsBox');

    if (!fromZoneId) return toast('Please select a source region', true);
    if (!toZoneId) return toast('Please select a destination region', true);
    if (fromZoneId === toZoneId && fromSiteId === toSiteId) return toast('Source and destination locations must be different', true);
    if (!items.length) return toast('Please select at least one material item to dispatch', true);

    try {
      await Api.dispatchZoneToZone({
        from_zone_id: fromZoneId,
        from_site_id: fromSiteId,
        to_zone_id: toZoneId,
        to_site_id: toSiteId,
        lines: items,
        items: items,
        notes: document.getElementById('dzzNotes').value.trim() || undefined
      });
      toast('Region to Region dispatch recorded successfully');
      renderDispatchZoneToZone(content);
    } catch (err) { toast(err.message, true); }
  });
}

function renderReceiveZone(content) {
  if (State.user.role === 'site_engineer') {
    content.innerHTML = `<div class="empty-state">Region receiving is confirmed by your regional admin.</div>`;
    return;
  }
  const isSuperAdmin = State.user.role === 'super_admin';
  const initialZoneId = isSuperAdmin ? (State.user.zoneId || (State.zones[0] && State.zones[0].id)) : State.user.zoneId;

  content.innerHTML = `<div class="card">
    <h3>Region Stock Receipt</h3>
    <p class="muted" style="margin-top:0">Confirm receipt of items or bulk materials dispatched into your region and specify the receiving site location.</p>
    ${isSuperAdmin ? `<div class="form-row"><label>Receiving Region</label><select id="rzZone">${zoneOptions(State.user.zoneId, 'Select Receiving Region')}</select></div>` : ''}
    <div class="form-row"><label>Receiving Site Location (where material is stocked)</label><select id="rzSite">${siteOptions(initialZoneId, null, 'Region Warehouse / Unassigned Site (Default)')}</select></div>
    <div id="rzMultiItemsBox"></div>
    <div class="form-row"><label>Notes / Remarks</label><input id="rzNotes" placeholder="e.g. Received in good condition at site warehouse" /></div>
    <button class="btn-primary" id="rzSubmit" style="margin-top:14px">Confirm receipt in region</button>
  </div>`;

  renderScanMoveMultiMaterialBuilder('rzMultiItemsBox', 'Select Material Received');

  const rzZoneEl = document.getElementById('rzZone');
  if (rzZoneEl) {
    rzZoneEl.addEventListener('change', () => {
      const selectedZoneId = rzZoneEl.value;
      const rzSiteEl = document.getElementById('rzSite');
      if (rzSiteEl) {
        rzSiteEl.innerHTML = siteOptions(selectedZoneId, null, 'Region Warehouse / Unassigned Site (Default)');
      }
    });
  }

  document.getElementById('rzSubmit').addEventListener('click', async () => {
    const zoneId = isSuperAdmin ? document.getElementById('rzZone')?.value : State.user.zoneId;
    const siteId = document.getElementById('rzSite')?.value;
    const notes = document.getElementById('rzNotes').value.trim();
    const items = getScanMoveMultiMaterialItems('rzMultiItemsBox');

    if (!items.length) {
      return toast('Please select at least one material and enter quantity received or barcode numbers', true);
    }

    try {
      await Api.receiveInZone({
        zone_id: zoneId || undefined,
        site_id: siteId || undefined,
        lines: items,
        items: items,
        notes: notes || undefined
      });
      toast('Stock receipt confirmed in region');
      renderReceiveZone(content);
    } catch (err) { toast(err.message, true); }
  });
}

function renderReturnStock(content) {
  const user = State.user;
  const isSuperAdmin = user.role === 'super_admin';
  const isZoneAdmin = user.role === 'zone_admin' || user.role === 'region_admin';

  const defaultZoneId = user.zoneId || (State.zones[0] && State.zones[0].id);
  const defaultSiteId = user.siteId;

  content.innerHTML = `
    <div class="card">
      <h3>Stock Return (Reverse Flow / Reverse Logistics)</h3>
      <p class="muted" id="retFlowHint" style="margin-top:0">
        Return unused, excess, defective, or decommissioned stock back up the supply chain (Site → Region Warehouse, Region → Region, or Region Warehouse → HO).
      </p>

      <div class="form-row">
        <label>Return Flow Direction</label>
        <select id="retFlowType">
          <option value="" selected disabled>-- Select Return Flow Direction --</option>
          <option value="SITE_TO_ZONE">Site → Region Warehouse (Return from site to region depot)</option>
          ${isSuperAdmin || isZoneAdmin ? `<option value="ZONE_TO_ZONE">Region → Region (Reverse flow transfer between regions)</option>` : ''}
          ${isSuperAdmin || isZoneAdmin ? `<option value="ZONE_TO_HO">Region Warehouse → HO (Return from region to head office)</option>` : ''}
          ${isSuperAdmin ? `<option value="SITE_TO_HO">Site → HO (Direct return from site to head office)</option>` : ''}
        </select>
      </div>

      <div class="form-inline">
        <div class="form-row" id="retFromZoneRow">
          <label id="retFromZoneLabel">Source Region (From Region)</label>
          <select id="retFromZone">${zoneOptions(defaultZoneId, 'Select Source Region')}</select>
        </div>
        <div class="form-row" id="retFromSiteRow">
          <label id="retFromSiteLabel">Source Site (From Site)</label>
          <select id="retFromSite">${siteOptions(defaultZoneId, defaultSiteId, 'Select Source Site')}</select>
        </div>
      </div>

      <div class="form-inline" id="retToContainer">
        <div class="form-row" id="retToZoneRow">
          <label id="retToZoneLabel">Destination Region (To Region)</label>
          <select id="retToZone">${zoneOptions(defaultZoneId, 'Select Destination Region')}</select>
        </div>
        <div class="form-row" id="retToSiteRow">
          <label id="retToSiteLabel">Destination Site (To Site)</label>
          <select id="retToSite">${siteOptions(defaultZoneId, null, 'Region Warehouse / Unassigned Site (Default)')}</select>
        </div>
      </div>

      <div id="retMultiItemsBox"></div>

      <div class="form-row">
        <label>Return Reason / Notes</label>
        <input id="retNotes" placeholder="e.g. Excess material after site completion / Defective RMA return / Decommissioned item" />
      </div>

      <button class="btn-primary" id="retSubmit" style="margin-top:14px">Record stock return (reverse flow)</button>
    </div>

    <div class="section-header">
      <h3>Reverse Flow Return History</h3>
    </div>
    <div id="retHistoryList" class="card">
      <div class="empty-state">Loading return history…</div>
    </div>
  `;

  renderScanMoveMultiMaterialBuilder('retMultiItemsBox', 'Select Material to Return');

  const retFlowTypeEl = document.getElementById('retFlowType');
  const retFlowHintEl = document.getElementById('retFlowHint');
  const retFromZoneEl = document.getElementById('retFromZone');
  const retFromSiteRow = document.getElementById('retFromSiteRow');
  const retFromSiteLabel = document.getElementById('retFromSiteLabel');
  const retToContainer = document.getElementById('retToContainer');
  const retToZoneEl = document.getElementById('retToZone');
  const retToZoneLabel = document.getElementById('retToZoneLabel');
  const retToSiteEl = document.getElementById('retToSite');
  const retToSiteLabel = document.getElementById('retToSiteLabel');

  function updateReturnFormLayout() {
    const flow = retFlowTypeEl.value;
    if (flow === 'ZONE_TO_HO') {
      if (retFlowHintEl) retFlowHintEl.textContent = 'Return stock from a Regional Depot/Warehouse directly to Head Office (HO) Central Warehouse.';
      retFromSiteRow.style.display = 'none';
      retToContainer.style.display = 'none';
    } else if (flow === 'SITE_TO_HO') {
      if (retFlowHintEl) retFlowHintEl.textContent = 'Direct return of material from an Engineering Site back to Head Office (HO) Central Warehouse.';
      retFromSiteRow.style.display = '';
      if (retFromSiteLabel) retFromSiteLabel.textContent = 'Source Site (From Site) *';
      retToContainer.style.display = 'none';
    } else if (flow === 'ZONE_TO_ZONE') {
      if (retFlowHintEl) retFlowHintEl.textContent = 'Reverse flow transfer of inventory between two Regional Hubs/Depots.';
      retFromSiteRow.style.display = '';
      if (retFromSiteLabel) retFromSiteLabel.textContent = 'Source Site Location (Optional / Region Depot)';
      retToContainer.style.display = '';
      if (retToZoneLabel) retToZoneLabel.textContent = 'Destination Region (To Region) *';
      if (retToSiteLabel) retToSiteLabel.textContent = 'Destination Site Location (Optional / Region Depot)';
    } else {
      if (retFlowHintEl) retFlowHintEl.textContent = 'Return unused, excess, or defective material from a Site back to the Regional Warehouse.';
      retFromSiteRow.style.display = '';
      if (retFromSiteLabel) retFromSiteLabel.textContent = 'Source Site (From Site) *';
      retToContainer.style.display = '';
      if (retToZoneLabel) retToZoneLabel.textContent = 'Destination Region (To Region) *';
      if (retToSiteLabel) retToSiteLabel.textContent = 'Destination Site Location (Region Depot / Site)';
    }
  }

  retFlowTypeEl.addEventListener('change', updateReturnFormLayout);
  updateReturnFormLayout();

  retFromZoneEl.addEventListener('change', () => {
    const selectedZoneId = retFromZoneEl.value;
    document.getElementById('retFromSite').innerHTML = siteOptions(selectedZoneId, null, 'Select Source Site');
  });

  if (retToZoneEl) {
    retToZoneEl.addEventListener('change', () => {
      const selectedZoneId = retToZoneEl.value;
      if (retToSiteEl) {
        retToSiteEl.innerHTML = siteOptions(selectedZoneId, null, 'Region Warehouse / Unassigned Site (Default)');
      }
    });
  }

  document.getElementById('retSubmit').addEventListener('click', async () => {
    const flow = retFlowTypeEl.value;
    const fromZoneId = retFromZoneEl.value;
    const fromSiteId = document.getElementById('retFromSite')?.value;
    const toZoneId = document.getElementById('retToZone')?.value;
    const toSiteId = document.getElementById('retToSite')?.value;
    const notes = document.getElementById('retNotes').value.trim();
    const items = getScanMoveMultiMaterialItems('retMultiItemsBox');

    if (!fromZoneId) return toast('Please select source region', true);
    if ((flow === 'SITE_TO_ZONE' || flow === 'SITE_TO_HO') && !fromSiteId) {
      return toast('Please select source site', true);
    }
    if ((flow === 'SITE_TO_ZONE' || flow === 'ZONE_TO_ZONE') && !toZoneId) {
      return toast('Please select destination region', true);
    }
    if (flow === 'ZONE_TO_ZONE' && fromZoneId === toZoneId && (fromSiteId || '') === (toSiteId || '')) {
      return toast('Source and destination locations must be different for region to region return', true);
    }
    if (!items.length) {
      return toast('Please select at least one material to return and enter quantity or barcode numbers', true);
    }

    try {
      await Api.returnStock({
        return_type: flow,
        from_zone_id: fromZoneId,
        from_site_id: fromSiteId || undefined,
        to_zone_id: (flow === 'SITE_TO_ZONE' || flow === 'ZONE_TO_ZONE') ? toZoneId : undefined,
        to_site_id: (flow === 'SITE_TO_ZONE' || flow === 'ZONE_TO_ZONE') ? (toSiteId || undefined) : undefined,
        lines: items,
        items: items,
        notes: notes || undefined
      });
      toast('Stock return recorded successfully');
      renderReturnStock(content);
    } catch (err) {
      toast(err.message, true);
    }
  });

  async function loadReturnHistory() {
    const container = document.getElementById('retHistoryList');
    if (!container) return;
    try {
      const txs = await Api.transactions('type=RETURN');
      if (!txs || !txs.length) {
        container.innerHTML = `<div class="empty-state">No return transactions recorded yet.</div>`;
        return;
      }
      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Material</th>
              <th>Qty / Serials</th>
              <th>From → To Location</th>
              <th>Recorded By</th>
              <th>Notes / Reason</th>
            </tr>
          </thead>
          <tbody>
            ${txs.map((t) => {
        const serialCode = t.barcode_value || t.serial_number;
        const serialText = serialCode ? `<span class="badge monospace-badge">${serialCode}</span>` : '—';
        const fromLoc = t.from_site_name ? `Site: ${t.from_site_name}` : (t.from_zone_name ? `Region: ${t.from_zone_name}` : '—');
        const toLoc = t.to_site_name ? `Site: ${t.to_site_name}` : (t.to_location_type === 'HO' ? 'HO Warehouse' : (t.to_zone_name ? `Region: ${t.to_zone_name}` : '—'));
        return `
                <tr>
                  <td class="mono-date">${fmtDate(t.created_at)}</td>
                  <td class="non-mono"><strong>${t.material_name}</strong></td>
                  <td><div>${t.quantity}</div><div style="margin-top:2px">${serialText}</div></td>
                  <td>
                    <div class="tx-location-flow">
                      <span class="loc-tag">${fromLoc}</span>
                      <span class="flow-arrow">→</span>
                      <span class="loc-tag highlight">${toLoc}</span>
                    </div>
                  </td>
                  <td>${t.created_by_name || 'N/A'} (${t.created_by_role || 'user'})</td>
                  <td>${t.notes || '—'}</td>
                </tr>
              `;
      }).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state">Error loading return history: ${err.message}</div>`;
    }
  }

  loadReturnHistory();
}

async function renderRequisitions() {
  const el = document.getElementById('view-requisitions');
  const userZoneId = State.user.zoneId || (State.zones[0]?.id);
  const userSiteId = State.user.siteId;

  el.innerHTML = `
    <div class="card">
      <h3>Raise a Requisition (OMS Ticket)</h3>
      <p class="muted" style="margin-top:0">Engineers and admins can raise single or multi-material requisitions for site installation or maintenance.</p>
      <div class="form-inline">
        <div class="form-row"><label>OMS Ticket Number <span style="color:var(--danger)">*</span></label><input id="reqOmsTicket" placeholder="e.g. OMS-TICK-1024" required /></div>
        <div class="form-row"><label>Region <span style="color:var(--danger)">*</span></label><select id="reqZone">${zoneOptions(userZoneId, 'Select Region')}</select></div>
        <div class="form-row"><label>Site <span style="color:var(--danger)">*</span></label><select id="reqSite">${siteOptions(userZoneId, userSiteId, 'Select Site')}</select></div>
      </div>
      
      <div id="reqLinesBox" class="line-items-container">
        <div class="line-items-header">
          <strong>Material Line Items (Add Multiple Materials)</strong>
          <button type="button" class="btn-secondary small" id="reqAddLineBtn">+ Add Another Material</button>
        </div>
        <div class="table-responsive has-dropdowns">
          <table>
            <thead>
              <tr>
                <th style="width:40px; text-align:center">#</th>
                <th>MATERIAL <span style="color:var(--danger)">*</span></th>
                <th style="width:180px">QUANTITY REQUESTED <span style="color:var(--danger)">*</span></th>
                <th style="width:70px; text-align:center">ACTION</th>
              </tr>
            </thead>
            <tbody id="reqLinesTbody"></tbody>
          </table>
        </div>
      </div>

      <div class="form-row" style="margin-top:12px">
        <label>Notes / Remarks / Purpose</label>
        <textarea id="reqNotes" rows="2" placeholder="e.g. Required for urgent charger maintenance at Bay 2"></textarea>
      </div>

      <div class="form-actions" style="margin-top:16px">
        <button class="btn-primary" id="reqSubmit">Raise Requisition</button>
      </div>
    </div>
    <div class="section-header"><h3>Requisitions History &amp; Approvals</h3></div>
    <div id="reqList" class="card"><div class="empty-state">Loading…</div></div>
  `;

  const addReqLine = (matId = '', qty = '') => {
    const tbody = document.getElementById('reqLinesTbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'req-item-row';
    tr.innerHTML = `
      <td style="text-align:center; font-weight:600" class="req-row-num">1</td>
      <td><select class="req-mat-select">${materialOptions(matId, 'Select Material')}</select></td>
      <td><input type="number" step="0.01" class="req-qty-input" value="${qty}" placeholder="e.g. 10.00" /></td>
      <td style="text-align:center">
        <button type="button" class="btn-ghost small req-del-btn" style="color:var(--danger)">Remove</button>
      </td>
    `;
    tr.querySelector('.req-del-btn').addEventListener('click', () => {
      tr.remove();
      updateRowNumbers();
    });
    tbody.appendChild(tr);
    updateRowNumbers();
    const sel = tr.querySelector('.req-mat-select');
    if (sel) makeSearchableSelect(sel);
  };

  const updateRowNumbers = () => {
    const rows = document.querySelectorAll('#reqLinesTbody tr');
    rows.forEach((r, idx) => {
      const numCell = r.querySelector('.req-row-num');
      if (numCell) numCell.textContent = idx + 1;
      const delBtn = r.querySelector('.req-del-btn');
      if (delBtn) delBtn.style.display = rows.length > 1 ? '' : 'none';
    });
  };

  addReqLine();
  document.getElementById('reqAddLineBtn').addEventListener('click', () => addReqLine());

  document.getElementById('reqZone').addEventListener('change', (e) => {
    document.getElementById('reqSite').innerHTML = siteOptions(e.target.value, null, 'Select Site');
  });

  document.getElementById('reqSubmit').addEventListener('click', async () => {
    const omsTicketNumber = document.getElementById('reqOmsTicket').value.trim();
    const zoneId = document.getElementById('reqZone').value;
    const siteId = document.getElementById('reqSite').value;
    const notes = document.getElementById('reqNotes').value.trim();

    if (!omsTicketNumber) return toast('Please enter OMS Ticket number', true);
    if (!zoneId) return toast('Please select a zone/region', true);
    if (!siteId) return toast('Please select a site', true);

    const rows = [...document.querySelectorAll('#reqLinesTbody tr')];
    const rawItems = rows.map(r => ({
      material_id: r.querySelector('.req-mat-select')?.value,
      quantity_requested: parseFloat(r.querySelector('.req-qty-input')?.value || 0)
    })).filter(l => l.material_id && l.quantity_requested > 0);

    if (!rawItems.length) return toast('Please select at least one material and enter requested quantity', true);

    const itemMap = new Map();
    for (const it of rawItems) {
      const key = String(it.material_id);
      if (itemMap.has(key)) {
        itemMap.get(key).quantity_requested += it.quantity_requested;
      } else {
        itemMap.set(key, { ...it });
      }
    }
    const items = Array.from(itemMap.values());

    try {
      await Api.createRequisition({
        oms_ticket_number: omsTicketNumber,
        oms_number: omsTicketNumber,
        zone_id: zoneId,
        site_id: siteId,
        notes: notes || undefined,
        items
      });
      toast('Requisition raised successfully');
      document.getElementById('reqOmsTicket').value = '';
      document.getElementById('reqNotes').value = '';
      document.getElementById('reqLinesTbody').innerHTML = '';
      addReqLine();
      loadReqList();
    } catch (err) { toast(err.message, true); }
  });

  loadReqList();
}

async function loadReqList() {
  const listEl = document.getElementById('reqList');
  const isZoneAdminUp = State.user.role === 'super_admin' || State.user.role === 'zone_admin' || State.user.role === 'region_admin';
  const reqs = await Api.requisitions();
  if (!reqs.length) { listEl.innerHTML = `<div class="empty-state">No requisitions yet.</div>`; return; }

  listEl.innerHTML = `<table><thead><tr><th>OMS Ticket</th><th>Material</th><th>Site</th><th>Requested by</th><th>Requested</th><th>Fulfilled</th><th>Notes / Remarks</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${reqs.map((r) => {
    const isPending = ['PENDING', 'PARTIAL'].includes(r.status);
    const canApprove = isZoneAdminUp && isPending;
    const canCancel = (r.requested_by === State.user.id || isZoneAdminUp) && isPending;

    return `<tr>
        <td class="non-mono">${r.oms_ticket_number || r.oms_number}</td>
        <td class="non-mono">${r.material_name}</td>
        <td class="non-mono">${r.site_name}</td>
        <td class="non-mono">${r.requested_by_name || '—'}</td>
        <td><strong>${r.quantity_requested}</strong></td>
        <td><span style="font-weight:600; color:${Number(r.quantity_fulfilled || 0) >= r.quantity_requested ? 'var(--ok)' : (Number(r.quantity_fulfilled || 0) > 0 ? 'var(--brand)' : 'inherit')}">${Number(r.quantity_fulfilled || 0)}</span></td>
        <td class="non-mono muted" style="max-width:180px; font-size:12px">${r.notes || '—'}</td>
        <td>${pill(r.status)}</td>
        <td class="action-cell">
          <button class="btn-secondary small" data-view-req="${r.id}">View</button>
          ${canApprove ? ` <button class="btn-primary small" data-approve-req="${r.id}">Approve / Fulfill</button> <button class="btn-ghost small" data-reject-req="${r.id}">Reject</button>` : ''}
          ${canCancel ? ` <button class="btn-ghost small" data-cancel-req="${r.id}">Cancel</button>` : ''}
        </td>
      </tr>`;
  }).join('')}
  </tbody></table>`;

  listEl.querySelectorAll('[data-view-req]').forEach((btn) => btn.addEventListener('click', () => {
    const reqId = btn.dataset.viewReq;
    const reqObj = reqs.find((r) => String(r.id) === String(reqId));
    if (reqObj) showViewRequisitionModal(reqObj);
  }));

  listEl.querySelectorAll('[data-approve-req]').forEach((btn) => btn.addEventListener('click', () => {
    const reqId = btn.dataset.approveReq;
    const reqObj = reqs.find((r) => String(r.id) === String(reqId));
    if (!reqObj) return;

    showApproveFulfillRequisitionModal(reqObj, async (data) => {
      try {
        if (data.action === 'approve_only') {
          await Api.approveRequisition(reqObj.id);
          toast('Requisition approved successfully');
        } else {
          if (reqObj.status === 'PENDING') {
            await Api.approveRequisition(reqObj.id).catch(() => { });
          }

          const codes = data.serial ? [data.serial] : undefined;
          await Api.dispatchToSite({
            material_id: reqObj.material_id,
            region_id: reqObj.region_id || reqObj.zone_id || State.user.regionId || State.user.zoneId,
            site_id: reqObj.site_id,
            quantity: data.quantity,
            barcode_values: codes,
            requisition_id: reqObj.id,
            notes: data.notes || `Fulfilled for OMS Ticket #${reqObj.oms_ticket_number || reqObj.oms_number}`
          });
          toast(`Requisition items fulfilled (${data.quantity} units dispatched to site)`);
        }
        loadReqList();
      } catch (err) { toast(err.message, true); }
    });
  }));

  listEl.querySelectorAll('[data-reject-req]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      const reason = window.prompt('Optional rejection reason (leave blank if none):') || '';
      await Api.rejectRequisition(btn.dataset.rejectReq, reason.trim() || undefined);
      toast('Requisition rejected'); loadReqList();
    } catch (err) { toast(err.message, true); }
  }));

  listEl.querySelectorAll('[data-cancel-req]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await Api.cancelRequisition(btn.dataset.cancelReq); toast('Requisition cancelled'); loadReqList(); }
    catch (err) { toast(err.message, true); }
  }));
}

function showViewRequisitionModal(req) {
  const existing = document.getElementById('viewRequisitionModal');
  if (existing) existing.remove();

  const ticketNo = req.oms_ticket_number || req.oms_number || 'N/A';
  const overlay = document.createElement('div');
  overlay.id = 'viewRequisitionModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:540px" role="dialog" aria-modal="true" aria-label="Requisition Details">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px">
        <h3 style="margin:0">Requisition Details</h3>
        <button id="closeViewReqTop" class="btn-ghost small" aria-label="Close modal">&times;</button>
      </div>

      <div class="card" style="margin-bottom:16px; padding:14px; background:var(--bg-subtle, #f8fafc)">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
          <div>
            <strong style="font-size:16px; color:var(--brand)">${ticketNo}</strong>
            <div class="muted" style="font-size:12px; margin-top:2px">Created on ${fmtDate(req.created_at)}</div>
          </div>
          <div>${pill(req.status)}</div>
        </div>

        <table>
          <tbody>
            <tr><th style="width:140px">Material</th><td class="non-mono"><strong>${req.material_name || '—'}</strong></td></tr>
            <tr><th>Region / Zone</th><td class="non-mono">${req.region_name || req.zone_name || '—'}</td></tr>
            <tr><th>Site</th><td class="non-mono">${req.site_name || '—'}</td></tr>
            <tr><th>Requested By</th><td class="non-mono">${req.requested_by_name || '—'}</td></tr>
            <tr><th>Qty Requested</th><td><strong>${req.quantity_requested}</strong></td></tr>
            <tr><th>Qty Fulfilled</th><td><span style="font-weight:700; color:${Number(req.quantity_fulfilled || 0) >= req.quantity_requested ? 'var(--ok)' : 'var(--brand)'}">${Number(req.quantity_fulfilled || 0)}</span></td></tr>
            <tr><th>Notes / Remarks</th><td class="non-mono">${req.notes || '—'}</td></tr>
            ${req.reject_reason ? `<tr><th>Rejection Reason</th><td class="non-mono" style="color:var(--danger)">${req.reject_reason}</td></tr>` : ''}
          </tbody>
        </table>
      </div>

      <div class="modal-actions" style="display:flex; justify-content:flex-end; gap:8px">
        <button id="closeViewReq" class="btn-ghost">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeFn = () => overlay.remove();
  overlay.querySelector('#closeViewReq').addEventListener('click', closeFn);
  overlay.querySelector('#closeViewReqTop').addEventListener('click', closeFn);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });
}

function showApproveFulfillRequisitionModal(req, onConfirm) {
  const existing = document.getElementById('reqApproveFulfillModal');
  if (existing) existing.remove();

  const ticketNo = req.oms_ticket_number || req.oms_number || 'N/A';
  const qtyRequested = parseFloat(req.quantity_requested || 0);
  const qtyFulfilled = parseFloat(req.quantity_fulfilled || 0);
  const qtyRemaining = Math.max(0, qtyRequested - qtyFulfilled);

  const overlay = document.createElement('div');
  overlay.id = 'reqApproveFulfillModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:520px" role="dialog" aria-modal="true" aria-label="Requisition Approval & Item Fulfillment">
      <div style="display:flex;justify-space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">Requisition Approval &amp; Item Fulfillment</h3>
        <span class="badge role-badge">Ticket: ${ticketNo}</span>
      </div>
      <p class="muted" style="margin-top:0;font-size:13px">Review requested material details and choose to fulfill items now or approve for later dispatch.</p>
      
      <div style="background:var(--bg-card-subtle,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div>Material: <strong>${req.material_name || 'N/A'}</strong></div>
          <div>Site: <strong>${req.site_name || 'N/A'}</strong></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding-top:8px;border-top:1px solid var(--border-soft,#cbd5e1);text-align:center">
          <div><span style="font-size:11px;color:var(--text-muted);display:block">Requested</span><strong>${qtyRequested}</strong></div>
          <div><span style="font-size:11px;color:var(--text-muted);display:block">Fulfilled</span><strong style="color:var(--brand,#E31E24)">${qtyFulfilled}</strong></div>
          <div><span style="font-size:11px;color:var(--text-muted);display:block">Remaining</span><strong style="color:#d97706">${qtyRemaining}</strong></div>
        </div>
      </div>

      <div class="form-row">
        <label>Fulfillment Action <span class="required">*</span></label>
        <select id="popReqAction">
          <option value="" selected disabled>-- Select Fulfillment Action --</option>
          <option value="fulfill">Approve &amp; Fulfill Items Now (Dispatch Stock)</option>
          <option value="approve_only">Approve Requisition Only (Dispatch Later)</option>
        </select>
      </div>

      <div id="popFulfillSection">
        <div class="form-row">
          <label>Scanned Barcode / Serial Number (for serialized items)</label>
          <input id="popReqSerial" placeholder="e.g. MAT001-000001 (leave blank for bulk material)" />
        </div>
        <div class="form-row">
          <label>Quantity to Fulfill / Dispatch <span class="required">*</span></label>
          <input id="popReqQty" type="number" step="0.01" value="${qtyRemaining > 0 ? qtyRemaining : 1}" placeholder="e.g. ${qtyRemaining}" />
        </div>
        <div class="form-row">
          <label>Dispatch Notes / Reference</label>
          <input id="popReqNotes" placeholder="e.g. Dispatched against OMS ticket #${ticketNo}" />
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
        <button id="cancelReqModalBtn" class="btn-ghost" type="button">Cancel</button>
        <button id="confirmReqModalBtn" class="btn-primary" type="button">Confirm &amp; Execute</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const actionSelect = overlay.querySelector('#popReqAction');
  const fulfillSec = overlay.querySelector('#popFulfillSection');
  actionSelect.addEventListener('change', () => {
    fulfillSec.style.display = actionSelect.value === 'approve_only' ? 'none' : '';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#cancelReqModalBtn').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#confirmReqModalBtn').addEventListener('click', () => {
    const action = actionSelect.value;
    if (action === 'approve_only') {
      overlay.remove();
      onConfirm({ action: 'approve_only' });
    } else {
      const serialVal = overlay.querySelector('#popReqSerial').value.trim();
      const qty = parseFloat(overlay.querySelector('#popReqQty').value || 0);
      const notes = overlay.querySelector('#popReqNotes').value.trim();

      if (!serialVal && (!qty || qty <= 0)) {
        return toast('Please enter a valid quantity or scan a serial number to fulfill', true);
      }

      overlay.remove();
      onConfirm({
        action: 'fulfill',
        serial: serialVal || undefined,
        quantity: qty || 1,
        notes: notes || undefined
      });
    }
  });
}

function showRepairableModal(onConfirm) {
  const existing = document.getElementById('repairableModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'repairableModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:480px" role="dialog" aria-modal="true" aria-label="Repairable Material Details">
      <h3>Repairable Material Details</h3>
      <p class="muted" style="margin-top:0">Please specify where the repairable item is stored and its estimated repair cost.</p>
      <div class="form-row">
        <label>Location of Material <span class="required">*</span></label>
        <input id="popRepLocation" placeholder="e.g. Workshop Warehouse, Rack B-12" required />
      </div>
      <div class="form-row">
        <label>After Repair Price / Estimated Cost (₹) <span class="required">*</span></label>
        <input id="popRepPrice" type="number" step="0.01" placeholder="e.g. 1500.00" required />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button id="cancelRepModalBtn" class="btn-ghost" type="button">Cancel</button>
        <button id="confirmRepModalBtn" class="btn-primary" type="button">Confirm &amp; Record</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#cancelRepModalBtn').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#confirmRepModalBtn').addEventListener('click', () => {
    const location = document.getElementById('popRepLocation').value.trim();
    const price = document.getElementById('popRepPrice').value.trim();

    if (!location) return toast('Please enter the location of material', true);
    if (!price) return toast('Please enter the after-repair price', true);

    overlay.remove();
    onConfirm({ location, price });
  });
}

function showScrapModal(onConfirm, defaultReason = '') {
  const existing = document.getElementById('scrapModal');
  if (existing) existing.remove();

  const scrapReasons = [
    'Burnt',
    'Water Damage',
    'Lightning',
    'Physical Damage',
    'Life Expired',
    'Repeated Failure',
    'OEM Rejected',
    'Accidental',
    'Missing Parts'
  ];

  const overlay = document.createElement('div');
  overlay.id = 'scrapModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:480px" role="dialog" aria-modal="true" aria-label="Scrap Material Details">
      <h3>Scrap Material Details</h3>
      <p class="muted" style="margin-top:0">Please specify the scrap reason, quantity, and weight of the scrap material.</p>
      <div class="form-row">
        <label>Scrap Reason <span class="required">*</span></label>
        <select id="popScrapReason" required>
          <option value="" selected disabled>-- Select Scrap Reason --</option>
          ${scrapReasons.map((r) => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Quantity of Scrap Material <span class="required">*</span></label>
        <input id="popScrapQty" type="number" step="0.01" value="1" placeholder="e.g. 1.00" required />
      </div>
      <div class="form-row">
        <label>Weight of Scrap Material <span class="required">*</span></label>
        <input id="popScrapWeight" type="text" placeholder="e.g. 3.5 kg" required />
      </div>
      <div class="form-row">
        <label>Release for E-Waste Disposal? <span class="required">*</span></label>
        <select id="popScrapEWaste" required>
          <option value="" selected disabled>-- Select E-Waste Option --</option>
          <option value="Yes">Yes (Release as E-Waste)</option>
          <option value="No">No (Standard Scrap)</option>
        </select>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button id="cancelScrapModalBtn" class="btn-ghost" type="button">Cancel</button>
        <button id="confirmScrapModalBtn" class="btn-primary" type="button">Confirm &amp; Record</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#cancelScrapModalBtn').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#confirmScrapModalBtn').addEventListener('click', () => {
    const reason = document.getElementById('popScrapReason').value.trim();
    const qty = document.getElementById('popScrapQty').value.trim();
    const weight = document.getElementById('popScrapWeight').value.trim();
    const eWaste = document.getElementById('popScrapEWaste').value;

    if (!reason) return toast('Please select a scrap reason', true);
    if (!qty) return toast('Please enter scrap quantity', true);
    if (!weight) return toast('Please enter weight of scrap material', true);

    overlay.remove();
    onConfirm({ reason, qty, weight, eWaste });
  });
}

function showApproveScrapModal(materialName, onConfirm) {
  const existing = document.getElementById('approveScrapModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'approveScrapModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:460px" role="dialog" aria-modal="true" aria-label="Approve Scrap Material">
      <h3>Approve Scrap Release</h3>
      <p class="muted" style="margin-top:0">Material: <strong>${materialName}</strong></p>
      <div class="form-row">
        <label>Release for E-Waste Disposal? <span class="required">*</span></label>
        <select id="popApproveEWaste" required>
          <option value="" selected disabled>-- Select E-Waste Option --</option>
          <option value="Yes">Yes (Release as E-Waste)</option>
          <option value="No">No (Standard Scrap)</option>
        </select>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button id="cancelApproveScrapBtn" class="btn-ghost" type="button">Cancel</button>
        <button id="confirmApproveScrapBtn" class="btn-primary" type="button">Approve &amp; Release</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#cancelApproveScrapBtn').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#confirmApproveScrapBtn').addEventListener('click', () => {
    const eWaste = overlay.querySelector('#popApproveEWaste').value;
    overlay.remove();
    onConfirm({ e_waste: eWaste });
  });
}

function showMarkRepairedModal(materialName, defaultZoneId, onConfirm) {
  const existing = document.getElementById('markRepairedModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'markRepairedModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:480px" role="dialog" aria-modal="true" aria-label="Restore Repaired Material to Stock">
      <h3>Restore Repaired Material to Stock</h3>
      <p class="muted" style="margin-top:0">Material: <strong>${materialName}</strong></p>
      <p class="muted" style="font-size:13px">Specify which stock location to restore this repaired material into.</p>
      <div class="form-row">
        <label>Target Stock Location <span class="required">*</span></label>
        <select id="popRepairedDestType">
          <option value="" selected disabled>-- Select Target Stock Location --</option>
          <option value="ZONE">Region Warehouse Stock</option>
          <option value="HO">Head Office (HO) Stock</option>
        </select>
      </div>
      <div class="form-row" id="popRepairedZoneRow">
        <label>Target Zone <span class="required">*</span></label>
        <select id="popRepairedZone">${zoneOptions(defaultZoneId, 'Select Target Zone')}</select>
      </div>
      <div class="form-row">
        <label>Repair Notes / Inspection Details</label>
        <input id="popRepairedNotes" placeholder="e.g. Tested OK, restored to active inventory" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button id="cancelMarkRepairedBtn" class="btn-ghost" type="button">Cancel</button>
        <button id="confirmMarkRepairedBtn" class="btn-primary" type="button">Restore &amp; Add to Stock</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const destTypeEl = overlay.querySelector('#popRepairedDestType');
  const zoneRowEl = overlay.querySelector('#popRepairedZoneRow');
  destTypeEl.addEventListener('change', () => {
    zoneRowEl.style.display = destTypeEl.value === 'HO' ? 'none' : '';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#cancelMarkRepairedBtn').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#confirmMarkRepairedBtn').addEventListener('click', () => {
    const destType = destTypeEl.value;
    const zoneId = overlay.querySelector('#popRepairedZone')?.value;
    const notes = overlay.querySelector('#popRepairedNotes')?.value.trim();

    if (destType === 'ZONE' && !zoneId) {
      return toast('Please select a target zone for stock restoration', true);
    }

    overlay.remove();
    onConfirm({ destination_type: destType, zone_id: zoneId || undefined, notes: notes || undefined });
  });
}

async function renderReplacements(container) {
  return renderConsumption(container);
}

let consumeMode = 'stock';

async function renderConsumption(container) {
  const el = container || document.getElementById('stockTabContent') || document.getElementById('view-consumption');
  if (!el) return;
  const zoneId = State.user.role === 'super_admin' ? (State.zones[0]?.id) : State.user.zoneId;

  function renderUnifiedConsumptionView() {
    el.innerHTML = `
      <div class="card" style="margin-bottom: 20px; padding: 20px">
        <div style="margin-bottom: 14px">
          <h3 style="margin: 0">Select Consumption Mode</h3>
          <p class="muted" style="margin: 4px 0 0 0; font-size:13.5px">Choose whether to consume fresh stock directly or replace a faulty/damaged item on site.</p>
        </div>
        <div style="display: flex; gap: 16px; flex-wrap: wrap">
          <label class="radio-card" id="modeRepairableOption" style="flex:1; min-width:260px; padding:16px; border:2px solid ${consumeMode === 'replacement' ? 'var(--brand)' : 'var(--border)'}; border-radius:var(--radius-lg); cursor:pointer; background:${consumeMode === 'replacement' ? 'var(--brand-dim)' : 'var(--surface)'}">
            <div style="display:flex; align-items:center; gap:8px">
              <input type="radio" name="consumeMode" value="replacement" ${consumeMode === 'replacement' ? 'checked' : ''} style="width:auto; margin:0" />
              <span style="font-weight:700; font-size:15px; color:var(--text)">Consume From Repairable / Material Replacement</span>
            </div>
            <div class="muted" style="font-size:12.5px; margin-top:6px; padding-left:24px">Replace faulty/damaged site material with a new barcode item</div>
          </label>
          <label class="radio-card" id="modeStockOption" style="flex:1; min-width:260px; padding:16px; border:2px solid ${consumeMode === 'stock' ? 'var(--brand)' : 'var(--border)'}; border-radius:var(--radius-lg); cursor:pointer; background:${consumeMode === 'stock' ? 'var(--brand-dim)' : 'var(--surface)'}">
            <div style="display:flex; align-items:center; gap:8px">
              <input type="radio" name="consumeMode" value="stock" ${consumeMode === 'stock' ? 'checked' : ''} style="width:auto; margin:0" />
              <span style="font-weight:700; font-size:15px; color:var(--text)">Consume From Stock</span>
            </div>
            <div class="muted" style="font-size:12.5px; margin-top:6px; padding-left:24px">Direct site installation or usage of stock materials</div>
          </label>
        </div>
      </div>
      <div id="consumptionModelContent"></div>
    `;

    el.querySelectorAll('input[name="consumeMode"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        consumeMode = e.target.value;
        renderUnifiedConsumptionView();
      });
    });

    const content = document.getElementById('consumptionModelContent');
    if (consumeMode === 'stock') {
      renderDirectConsumptionForm(content, zoneId);
    } else {
      renderReplacementForm(content, zoneId);
    }
  }

  renderUnifiedConsumptionView();
}

function renderDirectConsumptionForm(content, zoneId) {
  content.innerHTML = `
    <div class="card">
      <h3>Site Material Consumption</h3>
      <p class="muted" style="margin-top:0">Record direct installation or usage of materials at a site location.</p>
      <div class="form-inline">
        <div class="form-row"><label>Region</label><select id="conZone">${zoneOptions(State.user.zoneId, 'Select Region')}</select></div>
        <div class="form-row"><label>Site</label><select id="conSite">${siteOptions(zoneId, null, 'Select Site')}</select></div>
      </div>
      <div id="conMultiItemsBox"></div>
      <div class="form-row"><label>OMS Ticket Number</label><input id="conOmsTicket" placeholder="e.g. OMS-TICK-1024 (Optional)" /></div>
      <div class="form-row"><label>Asset Description (Describe location where material is installed) <span style="color:var(--danger)">*</span></label><input id="conLocation" placeholder="e.g. Charger #2 / Station Bay 3 / Cabinet A" required /></div>
      <button class="btn-primary" id="conSubmit">Record consumption</button>
    </div>
    <div class="section-header"><h3>Consumption history</h3></div>
    <div id="conList" class="card"><div class="empty-state">Loading…</div></div>
  `;

  renderScanMoveMultiMaterialBuilder('conMultiItemsBox', 'Select Consumed Material');

  document.getElementById('conZone').addEventListener('change', (e) => {
    document.getElementById('conSite').innerHTML = siteOptions(e.target.value, null, 'Select Site');
  });

  document.getElementById('conSubmit').addEventListener('click', async () => {
    const siteVal = document.getElementById('conSite').value || (State.user ? State.user.siteId : undefined);
    const regionVal = document.getElementById('conZone').value || (State.user ? State.user.regionId || State.user.zoneId : undefined);
    const omsTicketVal = document.getElementById('conOmsTicket').value.trim();
    const locationVal = document.getElementById('conLocation').value.trim();
    const items = getScanMoveMultiMaterialItems('conMultiItemsBox');

    if (!siteVal) return toast('Please select a site location', true);
    if (!locationVal) return toast('Please enter Asset Description (Describe location where material is installed)', true);
    if (!items.length) return toast('Please select at least one material item to consume', true);

    try {
      await Api.createConsumption({
        items,
        lines: items,
        site_id: siteVal,
        region_id: regionVal,
        zone_id: regionVal,
        oms_ticket_number: omsTicketVal || undefined,
        oms_number: omsTicketVal || undefined,
        installed_location: locationVal
      });
      toast('Consumption recorded successfully');
      renderDirectConsumptionForm(content, zoneId);
    } catch (err) { toast(err.message, true); }
  });

  loadConList();
}

async function renderReplacementForm(content, zoneId) {
  content.innerHTML = `
    <div class="card">
      <h3>Record a material replacement</h3>
      <p class="muted">Scan the old material being removed and the new material being installed on site.</p>
      <div class="form-inline">
        <div class="form-row"><label>Region</label><select id="repZone">${zoneOptions(State.user.zoneId, 'Select Region')}</select></div>
        <div class="form-row"><label>Site</label><select id="repSite">${siteOptions(zoneId, null, 'Select Site')}</select></div>
        <div class="form-row"><label>Engineer Name</label><select id="repEngineer"><option value="">Loading engineers…</option></select></div>
      </div>
      ${scanBoxHtml('repOldSerial', 'Old material barcode number (removed)', 'e.g. MAT001-000001 (old removed barcode)')}
      <div class="form-row"><label>Old material Status / Condition</label>
        <select id="repDisposition">
          <option value="" selected disabled>-- Select Condition / Status --</option>
          <option value="MISSING_NOT_FOUND">Missing/ Not found — Material is missing or not found on site</option>
          <option value="REPAIRABLE">Suspected Repairable — Material looks repairable but requires inspection</option>
          <option value="SCRAP">Suspected Scrap — Engineer believes it cannot be repaired</option>
          <option value="WARRANTY_RETURN">Warranty Return — Under OEM warranty</option>
        </select>
      </div>
      ${scanBoxHtml('repNewSerial', 'New material barcode number (installed)', 'e.g. MAT001-000002 (new replacement barcode)')}
      <div class="form-row"><label>OMS Ticket Number</label><input id="repOmsTicket" placeholder="e.g. OMS-TICK-1024 (Optional)" /></div>
      <div class="form-row"><label>Asset Description (Describe location where material is installed) <span style="color:var(--danger)">*</span></label><input id="repLocation" placeholder="e.g. Charger #2 / Station Bay 3 / Cabinet A" required /></div>
      <div class="form-row"><label>Notes</label><input id="repNotes" placeholder="e.g. Replaced faulty power module" /></div>
      <button class="btn-primary" id="repSubmit">Record replacement</button>
    </div>

    <div class="section-header"><h3>Repairable Materials Inventory &amp; Storage Details</h3></div>
    <div id="repairableStockList" class="card" style="margin-bottom:24px"><div class="empty-state">Loading repairable inventory…</div></div>

    <div class="section-header"><h3>Scrap Material Approvals &amp; Inventory</h3></div>
    <div id="scrapApprovalStockList" class="card" style="margin-bottom:24px"><div class="empty-state">Loading scrap inventory &amp; approvals…</div></div>

    <div class="section-header"><h3>Replacement history</h3></div>
    <div id="repList" class="card"><div class="empty-state">Loading history…</div></div>
  `;

  let users = [];
  try {
    users = await Api.users();
  } catch (err) {
    console.error('Failed to load users for replacement engineer options', err);
  }

  function updateRepEngineerDropdown() {
    const selectedZoneId = Number(document.getElementById('repZone')?.value);
    const selectedSiteId = Number(document.getElementById('repSite')?.value);
    const engSelect = document.getElementById('repEngineer');
    if (!engSelect) return;

    let filtered = users.filter((u) => u.is_active !== false);
    if (selectedZoneId) {
      filtered = filtered.filter((u) => !u.zone_id || Number(u.zone_id) === selectedZoneId);
    }
    if (selectedSiteId) {
      const siteFiltered = filtered.filter((u) => Number(u.site_id) === selectedSiteId);
      if (siteFiltered.length) filtered = siteFiltered;
    }

    if (!filtered.length) {
      engSelect.innerHTML = `<option value="">No engineer found</option>`;
    } else {
      engSelect.innerHTML = `<option value="">-- Select Engineer --</option>` +
        filtered.map((u) => `<option value="${u.id}" data-name="${u.full_name}">${u.full_name} (${u.email})</option>`).join('');
    }
  }

  updateRepEngineerDropdown();

  document.getElementById('repZone').addEventListener('change', (e) => {
    document.getElementById('repSite').innerHTML = siteOptions(e.target.value, null, 'Select Site');
    updateRepEngineerDropdown();
  });
  document.getElementById('repSite').addEventListener('change', () => {
    updateRepEngineerDropdown();
  });

  wireScanBox('repOldSerial');
  wireScanBox('repNewSerial');

  document.getElementById('repSubmit').addEventListener('click', () => {
    const oldBarcode = document.getElementById('repOldSerial').value.trim();
    const newBarcode = document.getElementById('repNewSerial').value.trim();
    const siteId = document.getElementById('repSite').value || (State.user ? State.user.siteId : undefined);
    const zoneId = document.getElementById('repZone').value || (State.user ? State.user.regionId || State.user.zoneId : undefined);
    const disposition = document.getElementById('repDisposition').value;
    const omsTicketVal = document.getElementById('repOmsTicket').value.trim();
    const locationVal = document.getElementById('repLocation').value.trim();

    if (!siteId) return toast('Please select a site location', true);
    if (!disposition) return toast('Please select Old material Status / Condition', true);
    if (!oldBarcode) return toast('Please scan or enter old material barcode', true);
    if (!newBarcode) return toast('Please scan or enter new material barcode', true);
    if (!locationVal) return toast('Please enter Asset Description (Describe location where material is installed)', true);

    const engSelect = document.getElementById('repEngineer');
    const selectedEngOption = engSelect && engSelect.selectedIndex >= 0 ? engSelect.options[engSelect.selectedIndex] : null;
    const engineerName = selectedEngOption && selectedEngOption.dataset.name ? selectedEngOption.dataset.name : '';
    const userNotes = document.getElementById('repNotes').value.trim();

    const executeSubmission = async (popupNotes) => {
      let notes = userNotes;
      if (omsTicketVal) {
        notes = notes ? `[OMS Ticket: ${omsTicketVal}] ${notes}` : `[OMS Ticket: ${omsTicketVal}]`;
      }
      if (locationVal) {
        notes = notes ? `[Asset Description: ${locationVal}] ${notes}` : `[Asset Description: ${locationVal}]`;
      }
      if (popupNotes) {
        notes = notes ? `${popupNotes} | ${notes}` : popupNotes;
      }
      if (engineerName) {
        notes = notes ? `[Engineer: ${engineerName}] ${notes}` : `Replaced by engineer: ${engineerName}`;
      }

      try {
        await Api.createReplacement({
          old_barcode_value: oldBarcode || undefined,
          new_barcode_value: newBarcode || undefined,
          site_id: siteId,
          zone_id: zoneId,
          disposition,
          installed_location: locationVal,
          oms_ticket_number: omsTicketVal || undefined,
          oms_number: omsTicketVal || undefined,
          notes: notes || undefined
        });
        toast('Replacement recorded successfully');
        document.getElementById('repOldSerial').value = '';
        document.getElementById('repNewSerial').value = '';
        document.getElementById('repOmsTicket').value = '';
        document.getElementById('repLocation').value = '';
        document.getElementById('repNotes').value = '';
        loadRepList();
      } catch (err) { toast(err.message, true); }
    };

    if (disposition === 'REPAIRABLE') {
      showRepairableModal(({ location, price }) => {
        executeSubmission(`[Repair Location: ${location}, Price: ₹${price}]`);
      });
    } else if (disposition === 'SCRAP' || disposition === 'PHYSICALLY_DAMAGED') {
      const defaultReason = disposition === 'PHYSICALLY_DAMAGED' ? 'Physical Damage' : '';
      showScrapModal(({ reason, qty, weight, eWaste }) => {
        executeSubmission(`[Scrap Qty: ${qty}, Weight: ${weight}, Reason: ${reason}, E-Waste: ${eWaste}]`);
      }, defaultReason);
    } else {
      executeSubmission('');
    }
  });

  loadRepList();
}

function parseRepairableNotes(notes) {
  let location = '—';
  let price = '—';
  let engineer = '—';

  if (notes) {
    const locMatch = notes.match(/Repair Location:\s*([^,\]]+)/i);
    if (locMatch) location = locMatch[1].trim();

    const priceMatch = notes.match(/Price:\s*₹?\s*([^\]]+)/i);
    if (priceMatch) price = priceMatch[1].trim();

    const engMatch = notes.match(/\[Engineer:\s*([^\]]+)\]/i);
    if (engMatch) engineer = engMatch[1].trim();
  }

  return { location, price, engineer };
}

async function loadRepList() {
  const repListEl = document.getElementById('repList');
  const repairableStockEl = document.getElementById('repairableStockList');

  try {
    const reps = await Api.replacements();

    if (repairableStockEl) {
      const repairables = reps.filter((r) => r.disposition === 'REPAIRABLE');
      if (!repairables.length) {
        repairableStockEl.innerHTML = `<div class="empty-state">No repairable materials currently recorded in stock.</div>`;
      } else {
        repairableStockEl.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Material &amp; Barcode</th>
                <th>Status</th>
                <th>Zone / Site Location</th>
                <th>Storage Spot / Location</th>
                <th>After Repair Price (₹)</th>
                <th>Engineer</th>
                <th>Date Tagged</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${repairables.map((r) => {
          const details = parseRepairableNotes(r.notes);
          const barcodeDisplay = r.old_barcode_value || r.old_serial || '—';
          const engName = details.engineer !== '—' ? details.engineer : (r.created_by_name || '—');
          const priceDisplay = details.price !== '—' ? (details.price.startsWith('₹') ? details.price : `₹${details.price}`) : '—';

          return `<tr>
                  <td class="non-mono">
                    <strong>${r.old_material_name}</strong>
                    <div style="font-size:12px; margin-top:2px"><span class="mono-badge">${barcodeDisplay}</span></div>
                  </td>
                  <td>${pill('REPAIRABLE')}</td>
                  <td class="non-mono">${r.site_name || '—'} <span class="muted" style="font-size:12px">(${r.zone_name || 'Zone'})</span></td>
                  <td class="non-mono"><strong>${details.location}</strong></td>
                  <td><span style="font-weight:600; color:var(--primary, #059669)">${priceDisplay}</span></td>
                  <td class="non-mono">${engName}</td>
                  <td class="mono-date">${fmtDate(r.created_at)}</td>
                  <td>
                    <button class="btn-primary mark-repaired-btn" style="padding:4px 8px;font-size:12px" data-id="${r.id}" data-material="${r.old_material_name}" data-zone="${r.zone_id}">Restore to Stock</button>
                  </td>
                </tr>`;
        }).join('')}
            </tbody>
          </table>
        `;

        repairableStockEl.querySelectorAll('.mark-repaired-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const repId = btn.dataset.id;
            const matName = btn.dataset.material;
            const zoneId = btn.dataset.zone;
            showMarkRepairedModal(matName, zoneId, async (payload) => {
              try {
                await Api.markRepaired(repId, payload);
                toast('Repaired material successfully restored to stock!');
                loadRepList();
              } catch (err) { toast(err.message, true); }
            });
          });
        });
      }
    }

    const scrapApprovalStockEl = document.getElementById('scrapApprovalStockList');
    const isAdmin = State.user.role === 'super_admin' || State.user.role === 'zone_admin' || State.user.role === 'region_admin';

    if (scrapApprovalStockEl) {
      const scraps = reps.filter((r) => ['SCRAP_PENDING_APPROVAL', 'SCRAP', 'SCRAP_REJECTED'].includes(r.disposition));
      if (!scraps.length) {
        scrapApprovalStockEl.innerHTML = `<div class="empty-state">No scrap materials currently recorded or pending approval.</div>`;
      } else {
        scrapApprovalStockEl.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Material &amp; Barcode</th>
                <th>Status</th>
                <th>Zone / Site Location</th>
                <th>Scrap Details (Qty / Weight / Reason)</th>
                <th>Requested By</th>
                <th>Date Tagged</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${scraps.map((r) => {
          const barcodeDisplay = r.old_barcode_value || r.old_serial || '—';
          const engName = r.created_by_name || '—';

          let scrapDetails = '—';
          if (r.notes) {
            const match = r.notes.match(/\[Scrap Qty:[^\]]+\]/);
            if (match) scrapDetails = match[0];
            else scrapDetails = r.notes;
          }

          let actionCell = '—';
          if (r.disposition === 'SCRAP_PENDING_APPROVAL') {
            if (isAdmin) {
              actionCell = `
                  <button class="btn-primary approve-scrap-btn" style="padding:4px 8px;font-size:12px;margin-right:4px" data-id="${r.id}">Approve Scrap</button>
                  <button class="btn-ghost reject-scrap-btn" style="padding:4px 8px;font-size:12px;color:var(--danger, #dc2626)" data-id="${r.id}">Reject</button>
                `;
            } else {
              actionCell = `<span class="muted" style="font-size:12px">Pending Admin Approval</span>`;
            }
          } else if (r.disposition === 'SCRAP') {
            actionCell = `<span style="color:var(--danger, #dc2626);font-weight:600;font-size:12px">Approved Scrap</span>`;
          } else if (r.disposition === 'SCRAP_REJECTED') {
            actionCell = `<span class="muted" style="font-size:12px">Rejected</span>`;
          }

          return `<tr>
                  <td class="non-mono">
                    <strong>${r.old_material_name}</strong>
                    <div style="font-size:12px; margin-top:2px"><span class="mono-badge">${barcodeDisplay}</span></div>
                  </td>
                  <td>${pill(r.disposition)}</td>
                  <td class="non-mono">${r.site_name || '—'} <span class="muted" style="font-size:12px">(${r.zone_name || 'Zone'})</span></td>
                  <td class="non-mono">${scrapDetails}</td>
                  <td class="non-mono">${engName}</td>
                  <td class="mono-date">${fmtDate(r.created_at)}</td>
                  <td>${actionCell}</td>
                </tr>`;
        }).join('')}
            </tbody>
          </table>
        `;

        scrapApprovalStockEl.querySelectorAll('.approve-scrap-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const matName = btn.closest('tr')?.querySelector('td strong')?.textContent || 'Scrap Material';
            showApproveScrapModal(matName, async (payload) => {
              try {
                await Api.approveScrap(id, payload);
                toast('Scrap material approved successfully!');
                loadRepList();
              } catch (err) { toast(err.message, true); }
            });
          });
        });

        scrapApprovalStockEl.querySelectorAll('.reject-scrap-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const reason = prompt('Please enter reason for rejecting scrap request:');
            if (reason === null) return;
            try {
              await Api.rejectScrap(id, reason);
              toast('Scrap material request rejected.');
              loadRepList();
            } catch (err) { toast(err.message, true); }
          });
        });
      }
    }

    if (repListEl) {
      if (!reps.length) {
        repListEl.innerHTML = `<div class="empty-state">No replacements recorded yet.</div>`;
      } else {
        repListEl.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Old material</th>
                <th>New material</th>
                <th>Site</th>
                <th>Engineer</th>
                <th>Disposition &amp; Details</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              ${reps.map((r) => {
          let engName = r.created_by_name || '—';
          if (r.notes && r.notes.includes('[Engineer:')) {
            const match = r.notes.match(/\[Engineer:\s*([^\]]+)\]/);
            if (match) engName = match[1];
          } else if (r.notes && r.notes.includes('Replaced by engineer:')) {
            engName = r.notes.replace('Replaced by engineer:', '').trim();
          }

          let extraDetails = '';
          if (r.notes) {
            const detailsMatch = r.notes.match(/\[(Repair Location|Scrap Qty):[^\]]+\]/);
            if (detailsMatch) {
              extraDetails = `<br/><span class="muted" style="font-size:11px">${detailsMatch[0]}</span>`;
            }
          }

          return `<tr>
                  <td class="non-mono">${r.old_material_name}${(r.old_barcode_value || r.old_serial) ? ' · ' + (r.old_barcode_value || r.old_serial) : ''}</td>
                  <td class="non-mono">${r.new_material_name}${(r.new_barcode_value || r.new_serial) ? ' · ' + (r.new_barcode_value || r.new_serial) : ''}</td>
                  <td class="non-mono">${r.site_name}</td>
                  <td class="non-mono">${engName}</td>
                  <td>${pill(r.disposition)}${extraDetails}</td>
                  <td>${fmtDate(r.created_at)}</td>
                </tr>`;
        }).join('')}
            </tbody>
          </table>
        `;
      }
    }
  } catch (err) {
    if (repairableStockEl) repairableStockEl.innerHTML = `<div class="empty-state">Failed to load repairable stock: ${err.message}</div>`;
    if (repListEl) repListEl.innerHTML = `<div class="empty-state">Failed to load replacements: ${err.message}</div>`;
  }
}

async function loadConList() {
  const listEl = document.getElementById('conList');
  const cons = await Api.consumptions();
  if (!cons.length) { listEl.innerHTML = `<div class="empty-state">No consumption recorded yet.</div>`; return; }
  listEl.innerHTML = `<table><thead><tr><th>Material</th><th>Qty</th><th>Site</th><th>Asset Description</th><th>When</th></tr></thead><tbody>
    ${cons.map((c) => `<tr>
      <td class="non-mono">${c.material_name}</td><td>${c.quantity}</td><td class="non-mono">${c.site_name}</td>
      <td class="non-mono">${c.installed_location || '—'}</td><td>${fmtDate(c.created_at)}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function renderMaterials() {
  const el = document.getElementById('view-materials');
  const isSuperAdmin = State.user.role === 'super_admin';
  el.innerHTML = `
    ${isSuperAdmin ? `<div class="card">
      <h3>Add a material</h3>
      <div class="form-inline">
        <div class="form-row"><label>Name</label><input id="matName" placeholder="Material Name" /></div>
        <div class="form-row"><label>Category</label><input id="matCategory" placeholder="e.g. Chargers, Cables" /></div>
        <div class="form-row"><label>Unit</label><input id="matUnit" value="pcs" /></div>
      </div>
      <div class="form-inline">
        <div class="form-row"><label>Price (₹)</label><input id="matPrice" type="number" step="0.01" value="0.00" placeholder="e.g. 1500.00" /></div>
        <div class="form-row"><label>Minimum stock level</label><input id="matReorder" type="number" value="0" /></div>
        <div class="form-row"><label>Serialized?</label>
          <select id="matSerialized">
            <option value="" selected disabled>-- Select Serialization --</option>
            <option value="false">No (bulk)</option>
            <option value="true">Yes (individually tracked)</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-primary" id="matSubmit">Add material</button>
      </div>
    </div>` : ''}
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <h3>Materials master</h3>
      <input type="text" id="matListSearch" placeholder="Search name or category..." style="min-width:240px;padding:6px 12px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius)" />
    </div>
    <div id="matList" class="card"><div class="empty-state">Loading…</div></div>
  `;
  if (isSuperAdmin) {
    document.getElementById('matSubmit').addEventListener('click', async () => {
      const matName = document.getElementById('matName').value.trim();
      const serializedVal = document.getElementById('matSerialized').value;
      if (!matName) return toast('Please enter a material name', true);
      if (!serializedVal) return toast('Please select whether the material is serialized or bulk', true);
      try {
        await Api.createMaterial({
          name: matName,
          category: document.getElementById('matCategory').value.trim(),
          unit: document.getElementById('matUnit').value.trim() || 'pcs',
          price: parseFloat(document.getElementById('matPrice').value || 0),
          min_stock_level: parseInt(document.getElementById('matReorder').value || 0, 10),
          is_serialized: serializedVal === 'true'
        });
        toast('Material added');
        await loadMaterials();
        loadMatList();
      } catch (err) { toast(err.message, true); }
    });
  }
  loadMatList();
}

async function loadMatList() {
  const listEl = document.getElementById('matList');
  const mats = await Api.materials();
  if (!mats.length) { listEl.innerHTML = `<div class="empty-state">No materials yet.</div>`; return; }

  const canEditGlobally = State.user.role === 'super_admin';

  function renderTableRows(filteredMats) {
    if (!filteredMats.length) {
      return `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No materials matching search criteria.</td></tr>`;
    }
    return filteredMats.map((m) => `<tr>
      <td class="non-mono"><strong>${escapeHtml(m.name)}</strong></td>
      <td class="non-mono">${escapeHtml(m.category || '—')}</td>
      <td>${escapeHtml(m.unit)}</td>
      <td class="mono">₹${Number(m.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td>${m.is_serialized ? '<span class="status-pill ok">individually tracked</span>' : '<span class="status-pill neutral">bulk</span>'}</td>
      <td>${m.min_stock_level !== undefined ? m.min_stock_level : m.reorder_level}</td>
      <td>
        <div style="display:flex;gap:4px">
          ${canEditGlobally ? `<button class="btn-secondary small" data-edit-material="${m.id}">Edit</button>` : ''}
          ${canEditGlobally ? `<button class="btn-ghost small danger" data-delete-material="${m.id}" style="color:var(--danger)">Delete</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
  }

  listEl.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Category</th><th>Unit</th><th>Price (₹)</th><th>Serialized</th><th>Min Stock Level</th><th>Actions</th></tr></thead>
      <tbody id="matTbody">${renderTableRows(mats)}</tbody>
    </table>`;

  const searchInput = document.getElementById('matListSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = mats.filter((m) =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.category || '').toLowerCase().includes(q)
      );
      document.getElementById('matTbody').innerHTML = renderTableRows(filtered);
      wireRowHandlers(filtered);
    });
  }

  function wireRowHandlers(currentMats) {
    listEl.querySelectorAll('[data-edit-material]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.editMaterial;
        const m = currentMats.find((x) => x.id == id);
        if (m) showEditMaterialModal(m);
      });
    });

    listEl.querySelectorAll('[data-delete-material]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteMaterial;
        const m = currentMats.find((x) => x.id == id);
        if (!window.confirm(`Delete material "${m ? m.name : 'this item'}" permanently? This cannot be undone.`)) return;
        try {
          await Api.deleteMaterial(id);
          toast('Material deleted');
          await loadMaterials();
          loadMatList();
        } catch (err) { toast(err.message, true); }
      });
    });
  }

  wireRowHandlers(mats);
}

function showEditMaterialModal(mat) {
  const existing = document.getElementById('editMaterialModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'editMaterialModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:500px" role="dialog" aria-modal="true" aria-label="Edit Material">
      <h3>Edit Material — ${mat.name}</h3>
      <div class="form-row"><label>Name</label><input id="editMatName" value="${mat.name || ''}" /></div>
      <div class="form-row"><label>Category</label><input id="editMatCategory" value="${mat.category || ''}" /></div>
      <div class="form-row"><label>Unit</label><input id="editMatUnit" value="${mat.unit || 'pcs'}" /></div>
      <div class="form-row"><label>Price (₹)</label><input id="editMatPrice" type="number" step="0.01" value="${mat.price !== undefined ? mat.price : 0}" /></div>
      <div class="form-row">
        <label>Minimum Stock Level</label>
        <input id="editMatMinStock" type="number" value="${mat.min_stock_level !== undefined ? mat.min_stock_level : (mat.reorder_level || 0)}" />
      </div>
      <div class="form-row">
        <label>Serialized?</label>
        <select id="editMatSerialized">
          <option value="" ${mat.is_serialized === undefined || mat.is_serialized === null ? 'selected disabled' : ''}>-- Select Serialization --</option>
          <option value="false" ${mat.is_serialized === false || mat.is_serialized === 'false' ? 'selected' : ''}>No (bulk)</option>
          <option value="true" ${mat.is_serialized === true || mat.is_serialized === 'true' ? 'selected' : ''}>Yes (individually tracked)</option>
        </select>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button id="cancelEditMatBtn" class="btn-ghost">Cancel</button>
        <button id="saveEditMatBtn" class="btn-primary">Save Changes</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#cancelEditMatBtn').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#saveEditMatBtn').addEventListener('click', async () => {
    const name = document.getElementById('editMatName').value.trim();
    const category = document.getElementById('editMatCategory').value.trim();
    const unit = document.getElementById('editMatUnit').value.trim();
    const price = parseFloat(document.getElementById('editMatPrice').value || 0);
    const minStock = parseInt(document.getElementById('editMatMinStock').value || 0, 10);
    const isSerialized = document.getElementById('editMatSerialized').value === 'true';

    if (!name) return toast('Name is required', true);

    try {
      await Api.updateMaterial(mat.id, {
        name,
        category: category || null,
        unit: unit || 'pcs',
        price,
        min_stock_level: minStock,
        is_serialized: isSerialized
      });
      toast('Material updated successfully');
      overlay.remove();
      await loadMaterials();
      loadMatList();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function renderQRCodes(root, selector, pixelSize = 128) {
  if (typeof QRCode === 'undefined') return false;
  root.querySelectorAll(selector).forEach((qrEl) => {
    const code = qrEl.dataset.code;
    if (!code) return;
    qrEl.innerHTML = '';
    new QRCode(qrEl, {
      text: code,
      width: pixelSize,
      height: pixelSize,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  });
  return true;
}

function executeBarcodePrint(layout, getStickersHtml) {
  let container = document.getElementById('printableContainer');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'printableContainer';
  container.dataset.printLayout = 'a4-24';
  container.innerHTML = getStickersHtml();

  document.body.appendChild(container);

  renderQRCodes(container, '.print-qr', 256);

  container.querySelectorAll('.print-qr').forEach((qrEl) => {
    const canvas = qrEl.querySelector('canvas');
    if (!canvas) return;
    const image = document.createElement('img');
    image.src = canvas.toDataURL('image/png');
    image.alt = 'Inventory QR code';
    image.width = 256;
    image.height = 256;
    qrEl.replaceChildren(image);
  });

  let pageStyle = document.getElementById('printPageStyle');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'printPageStyle';
    document.head.appendChild(pageStyle);
  }

  pageStyle.textContent = `@media print { @page { size: A4 portrait; margin: 4mm 3mm; } }`;

  setTimeout(() => {
    window.print();
    setTimeout(() => {
      if (container) container.remove();
    }, 1000);
  }, 300);
}

function showBarcodeModal(code, title, mat) {
  const existing = document.getElementById('barcodeModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'barcodeModal';
  overlay.className = 'modal-overlay';
  overlay.dataset.printLayout = 'a4-24';

  const categoryText = (mat && mat.category && mat.category !== 'Region/Site Inventory Item') ? mat.category : '';
  const priceText = mat && mat.price ? `₹${Number(mat.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '';
  const unitText = mat && mat.unit ? ` / ${mat.unit}` : '';
  const metaText = [categoryText, priceText ? `${priceText}${unitText}` : ''].filter(Boolean).join(' • ');

  const renderContent = (layout, copies, theme = 'red', forPrint = false) => {
    let stickersMarkup = '';
    for (let i = 0; i < copies; i++) {
      stickersMarkup += `
        <div class="barcode-label-card theme-${theme}">
          <div class="barcode-label-header">
            <span class="barcode-label-brand">CHARGEZONE INVENTORY</span>
          </div>
          <div class="barcode-label-title">${title || 'Material'}</div>
          ${metaText ? `<div class="barcode-label-meta">${metaText}</div>` : ''}
          <div class="barcode-svg-container qr-code-container">
            <div class="${forPrint ? 'print-qr' : 'qr-code-item'}" data-code="${code}"></div>
          </div>
          <div class="barcode-code-text">${code}</div>
        </div>
      `;
    }
    return stickersMarkup;
  };

  overlay.innerHTML = `
    <div class="modal-card" style="max-width:600px" role="dialog" aria-modal="true" aria-label="QR Label Preview">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3>QR Label — ${title || 'Material'}</h3>
        <button id="closeBarcodeTop" class="btn-ghost small" aria-label="Close modal">&times;</button>
      </div>

      <div class="print-config-panel">
        <div class="print-config-group"><strong>A4 sheet · 24 labels</strong></div>
        <div class="print-config-group">
          <label for="bcColorTheme">Color Theme:</label>
          <select id="bcColorTheme">
            <option value="" selected disabled>-- Select Color Theme --</option>
            <option value="red">ChargeZone Red</option>
            <option value="blue">Navy Blue</option>
            <option value="green">Forest Green</option>
            <option value="purple">Deep Purple</option>
            <option value="orange">Amber Orange</option>
            <option value="black">Monochrome</option>
          </select>
        </div>
        <div class="print-config-group">
          <label for="bcPrintCopies">Copies:</label>
          <input type="number" id="bcPrintCopies" value="1" min="1" max="100" style="width:54px" />
        </div>
      </div>

      <div id="singleStickerWrapper">
        ${renderContent('a4-24', 1, 'red')}
      </div>

      <div class="modal-actions" style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:8px">
        <button id="copyBarcodeBtn" class="btn-ghost small">Copy Code</button>
        <div style="display:flex;gap:8px">
          <button id="downloadBarcode" class="btn-secondary">Download PNG</button>
          <button id="printBarcode" class="btn-primary">Print Label</button>
          <button id="closeBarcode" class="btn-ghost">Close</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const drawBarcodes = () => renderQRCodes(overlay, '.qr-code-item');

  drawBarcodes();

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });

  const themeSelect = overlay.querySelector('#bcColorTheme');
  const copiesInput = overlay.querySelector('#bcPrintCopies');
  const wrapper = overlay.querySelector('#singleStickerWrapper');

  const updateStickers = () => {
    const theme = themeSelect.value;
    const copies = Math.max(1, parseInt(copiesInput.value) || 1);
    wrapper.innerHTML = renderContent('a4-24', copies, theme);
    drawBarcodes();
  };

  themeSelect.addEventListener('change', updateStickers);
  copiesInput.addEventListener('input', updateStickers);

  const closeFn = () => overlay.remove();
  overlay.querySelector('#closeBarcode').addEventListener('click', closeFn);
  overlay.querySelector('#closeBarcodeTop').addEventListener('click', closeFn);

  overlay.querySelector('#copyBarcodeBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(() => toast('QR code value copied to clipboard!'));
  });

  overlay.querySelector('#printBarcode').addEventListener('click', () => {
    const theme = themeSelect.value;
    const copies = Math.max(1, parseInt(copiesInput.value) || 1);
    executeBarcodePrint('a4-24', () => renderContent('a4-24', copies, theme, true));
  });

  overlay.querySelector('#downloadBarcode').addEventListener('click', () => {
    try {
      const canvas = overlay.querySelector('.qr-code-item canvas');
      if (!canvas) return toast('QR code is not available', true);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `qr-${code}.png`;
      a.click();
      toast('QR code PNG downloaded');
    } catch (err) {
      toast(`Export failed: ${err.message}`, true);
    }
  });
}

function showBatchBarcodeModal(itemsList) {
  const existing = document.getElementById('batchBarcodeModal');
  if (existing) existing.remove();

  if (!itemsList || !itemsList.length) {
    return toast('No barcodes selected for batch print', true);
  }

  const overlay = document.createElement('div');
  overlay.id = 'batchBarcodeModal';
  overlay.className = 'modal-overlay';
  overlay.dataset.printLayout = 'a4-24';

  const selectedIndices = new Set(itemsList.map((_, i) => i));

  const renderStickers = (layout, copies, theme = 'red', forPrint = false) => {
    let markup = '';
    itemsList.forEach((it, idx) => {
      if (!selectedIndices.has(idx)) return;
      const code = it.barcode_value || it.serial_number;
      const title = it.material_name || it.material_name_raw || 'Material Item';

      for (let c = 0; c < copies; c++) {
        markup += `
          <div class="barcode-label-card theme-${theme}">
            <div class="barcode-label-header">
              <span class="barcode-label-brand">CHARGEZONE INVENTORY</span>
            </div>
            <div class="barcode-label-title">${title}</div>
            <div class="barcode-svg-container">
              <div class="${forPrint ? 'print-qr' : 'batch-qr'}" data-code="${code}"></div>
            </div>
            <div class="barcode-code-text">${code}</div>
          </div>
        `;
      }
    });
    return markup || `<div class="empty-state" style="grid-column:1/-1;padding:24px">No items selected for printing.</div>`;
  };

  overlay.innerHTML = `
    <div class="modal-card" style="max-width:780px;max-height:85vh;overflow-y:auto" role="dialog" aria-modal="true" aria-label="Batch Barcode Labels">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3>Batch Barcode Labels (${itemsList.length} items)</h3>
        <button id="closeBatchBcTop" class="btn-ghost small" aria-label="Close modal">&times;</button>
      </div>

      <div class="print-config-panel">
        <div class="print-config-group"><strong>A4 sheet · 24 labels</strong></div>
        <div class="print-config-group">
          <label for="batchColorTheme">Color Theme:</label>
          <select id="batchColorTheme">
            <option value="" selected disabled>-- Select Color Theme --</option>
            <option value="red">ChargeZone Red</option>
            <option value="blue">Navy Blue</option>
            <option value="green">Forest Green</option>
            <option value="purple">Deep Purple</option>
            <option value="orange">Amber Orange</option>
            <option value="black">Monochrome</option>
          </select>
        </div>
        <div class="print-config-group">
          <label for="batchPrintCopies">Copies per item:</label>
          <input type="number" id="batchPrintCopies" value="1" min="1" max="50" style="width:54px" />
        </div>
        <div class="print-config-group">
          <button id="toggleSelectAllBc" class="btn-ghost small" type="button">Deselect All</button>
        </div>
      </div>

      <div class="batch-controls-bar">
        <span class="muted" id="batchSelectCountInfo">${selectedIndices.size} of ${itemsList.length} items selected</span>
      </div>

      <div id="batchStickersContainer">
        ${renderStickers('a4-24', 1, 'red')}
      </div>

      <div class="modal-actions" style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:8px">
        <span class="muted" style="font-size:12px" id="batchTotalLabelsInfo">Ready to print</span>
        <div style="display:flex;gap:8px">
          <button id="printBatchBc" class="btn-primary">Print All Labels</button>
          <button id="closeBatchBc" class="btn-ghost">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const drawBarcodes = () => renderQRCodes(overlay, '.batch-qr');

  drawBarcodes();

  const themeSelect = overlay.querySelector('#batchColorTheme');
  const copiesInput = overlay.querySelector('#batchPrintCopies');
  const container = overlay.querySelector('#batchStickersContainer');
  const selectCountInfo = overlay.querySelector('#batchSelectCountInfo');
  const totalLabelsInfo = overlay.querySelector('#batchTotalLabelsInfo');
  const toggleSelectBtn = overlay.querySelector('#toggleSelectAllBc');

  const updateBatchStickers = () => {
    const theme = themeSelect.value;
    const copies = Math.max(1, parseInt(copiesInput.value) || 1);
    container.innerHTML = renderStickers('a4-24', copies, theme);
    drawBarcodes();

    const totalToPrint = selectedIndices.size * copies;
    selectCountInfo.textContent = `${selectedIndices.size} of ${itemsList.length} items selected`;
    totalLabelsInfo.textContent = `${totalToPrint} total sticker label(s) ready to print`;
  };

  themeSelect.addEventListener('change', updateBatchStickers);
  copiesInput.addEventListener('input', updateBatchStickers);

  toggleSelectBtn.addEventListener('click', () => {
    if (selectedIndices.size === itemsList.length) {
      selectedIndices.clear();
      toggleSelectBtn.textContent = `Select All (${itemsList.length})`;
    } else {
      itemsList.forEach((_, i) => selectedIndices.add(i));
      toggleSelectBtn.textContent = `Deselect All`;
    }
    updateBatchStickers();
  });

  updateBatchStickers();

  const closeFn = () => overlay.remove();
  overlay.querySelector('#closeBatchBc').addEventListener('click', closeFn);
  overlay.querySelector('#closeBatchBcTop').addEventListener('click', closeFn);

  overlay.querySelector('#printBatchBc').addEventListener('click', () => {
    if (selectedIndices.size === 0) {
      return toast('Please select at least one item to print', true);
    }
    const theme = themeSelect.value;
    const copies = Math.max(1, parseInt(copiesInput.value) || 1);
    executeBarcodePrint('a4-24', () => renderStickers('a4-24', copies, theme, true));
  });
}

function formatUserPhone(phoneStr) {
  if (!phoneStr) return '—';
  const digits = String(phoneStr).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  } else if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return digits || '—';
}

async function renderUsers() {
  const el = document.getElementById('view-users');
  const role = State.user.role;
  if (role !== 'super_admin' && role !== 'zone_admin' && role !== 'region_admin') {
    el.innerHTML = `<div class="empty-state">Regional admin access required.</div>`;
    return;
  }
  const isSuperAdmin = role === 'super_admin';

  el.innerHTML = `
    <div class="card">
      <h3>${isSuperAdmin ? 'Add a user' : 'Add a site engineer'}</h3>
      <div class="form-inline">
        <div class="form-row"><label>Email</label><input id="uEmail" type="email" placeholder="name@chargezone.com" /></div>
        <div class="form-row"><label>Full name</label><input id="uFullName" /></div>
        <div class="form-row"><label>Phone number</label><input id="uPhone" type="tel" placeholder="e.g. +91 98765 43210" /></div>
        <div class="form-row"><label>Temporary password</label><input id="uPassword" type="password" autocomplete="new-password" placeholder="Temporary password" /></div>
      </div>
      <div class="form-inline">
        ${isSuperAdmin ? `<div class="form-row"><label>Role</label>
          <select id="uRole">
            <option value="" selected disabled>-- Select Role --</option>
            <option value="site_engineer">Site Engineer</option>
            <option value="region_admin">Regional Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>` : ''}
        <div class="form-row" id="uZoneRow" ${isSuperAdmin ? '' : 'hidden'}><label>Region</label><select id="uZone">${zoneOptions(null, 'Select Region')}</select></div>
        <div class="form-row" id="uSiteRow"><label>Site</label><select id="uSite">${siteOptions(isSuperAdmin ? State.zones[0]?.id : State.user.zoneId)}</select></div>
      </div>
      <div class="form-actions">
        <button class="btn-primary" id="uSubmit">${isSuperAdmin ? 'Create user' : 'Create site engineer'}</button>
      </div>
    </div>

    <div class="section-header"><h3>Users</h3></div>
    <div id="userList" class="card"><div class="empty-state">Loading…</div></div>

    <div class="section-header"><h3>${isSuperAdmin ? 'Regions' : 'Your region'}</h3></div>
    <div id="zoneList" class="card"><div class="empty-state">Loading…</div></div>

    <div class="section-header"><h3>Sites</h3></div>
    <div class="card">
      ${isSuperAdmin ? `<div class="form-row" style="max-width:320px"><label>Manage sites for region</label><select id="siteZonePicker">${zoneOptions(null, 'Select Region')}</select></div>` : ''}
      <div class="form-inline" style="margin-top:10px">
        <div class="form-row"><label>New site name</label><input id="newSiteName" /></div>
        <div class="form-row"><label>Address</label><input id="newSiteAddress" /></div>
      </div>
      <div class="form-actions">
        <button class="btn-secondary" id="addSiteBtn">Add site</button>
      </div>
      <div id="siteList" style="margin-top:16px"></div>
    </div>
  `;

  if (isSuperAdmin) {
    document.getElementById('uRole').addEventListener('change', (e) => {
      const roleVal = e.target.value;
      document.getElementById('uZoneRow').hidden = roleVal === 'super_admin';
      document.getElementById('uSiteRow').hidden = roleVal !== 'site_engineer';
    });
    document.getElementById('uZone').addEventListener('change', (e) => {
      document.getElementById('uSite').innerHTML = siteOptions(e.target.value);
    });
  }

  document.getElementById('uSubmit').addEventListener('click', async () => {
    const email = document.getElementById('uEmail').value.trim();
    const password = document.getElementById('uPassword').value;
    const fullName = document.getElementById('uFullName').value.trim();
    const phone = document.getElementById('uPhone').value.trim();
    const roleVal = isSuperAdmin ? document.getElementById('uRole').value : 'site_engineer';

    if (!email) return toast('Please enter an email address', true);
    if (!fullName) return toast('Please enter full name', true);
    if (!password) return toast('Please enter a password', true);
    if (isSuperAdmin && !roleVal) return toast('Please select a user role', true);

    const zoneIdVal = roleVal === 'super_admin' ? null : (isSuperAdmin ? document.getElementById('uZone').value : State.user.zoneId);
    if (roleVal !== 'super_admin' && isSuperAdmin && !zoneIdVal) return toast('Please select a region', true);

    const siteIdVal = roleVal === 'site_engineer' ? document.getElementById('uSite').value : null;
    if (roleVal === 'site_engineer' && !siteIdVal) return toast('Please select a site', true);

    try {
      await Api.createUser({
        email,
        password,
        full_name: fullName,
        phone_number: phone,
        role: roleVal,
        zone_id: zoneIdVal ? Number(zoneIdVal) : null,
        site_id: siteIdVal ? Number(siteIdVal) : null
      });
      toast(`${roleVal === 'site_engineer' ? 'Site engineer' : 'User'} created`);
      loadUserList();
    } catch (err) { toast(err.message, true); }
  });

  loadUserList();
  loadZoneManagementList(isSuperAdmin);
  loadSiteManagementList(isSuperAdmin);

  if (isSuperAdmin) {
    document.getElementById('siteZonePicker').addEventListener('change', () => loadSiteManagementList(true));
  }
}

async function loadUserList() {
  const listEl = document.getElementById('userList');
  const users = await Api.users();
  if (!users.length) { listEl.innerHTML = `<div class="empty-state">No users yet.</div>`; return; }
  const formatRole = (r) => ['region_admin', 'zone_admin'].includes(r) ? 'Regional Admin' : (r === 'super_admin' ? 'Super Admin' : 'Site Engineer');
  listEl.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Region</th><th>Site</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${users.map((u) => `<tr>
      <td class="non-mono">${escapeHtml(u.full_name)}</td>
      <td class="non-mono">${escapeHtml(u.email)}</td>
      <td class="non-mono">${escapeHtml(formatUserPhone(u.phone_number))}</td>
      <td>${formatRole(u.role)}</td>
      <td class="non-mono">${escapeHtml(u.region_name || u.zone_name || 'All regions')}</td>
      <td class="non-mono">${escapeHtml(u.site_name || '—')}</td>
      <td>${u.is_active ? pill('IN_ZONE') : pill('SCRAP')}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn-secondary small" data-edit-user="${u.id}">Edit</button>
          ${u.is_active ? `<button class="btn-ghost small" data-deactivate="${u.id}">Deactivate</button>` : `<button class="btn-ghost small" data-reactivate="${u.id}">Reactivate</button>`}
          <button class="btn-ghost small danger" data-delete-user="${u.id}" style="color:var(--danger)">Delete</button>
        </div>
      </td>
    </tr>`).join('')}
  </tbody></table>`;

  listEl.querySelectorAll('[data-edit-user]').forEach((btn) => btn.addEventListener('click', () => {
    const user = users.find((x) => x.id == btn.dataset.editUser);
    if (user) openEditUserModal(user);
  }));
  listEl.querySelectorAll('[data-deactivate]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await Api.deactivateUser(btn.dataset.deactivate); loadUserList(); } catch (err) { toast(err.message, true); }
  }));
  listEl.querySelectorAll('[data-reactivate]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await Api.reactivateUser(btn.dataset.reactivate); loadUserList(); } catch (err) { toast(err.message, true); }
  }));
  listEl.querySelectorAll('[data-delete-user]').forEach((btn) => btn.addEventListener('click', async () => {
    const user = users.find((x) => x.id == btn.dataset.deleteUser);
    if (!window.confirm(`Delete user "${user ? user.full_name : 'this user'}" permanently? This cannot be undone.`)) return;
    try {
      await Api.deleteUser(btn.dataset.deleteUser);
      toast('User deleted');
      loadUserList();
    } catch (err) { toast(err.message, true); }
  }));
}

function openEditUserModal(user) {
  const existing = document.getElementById('editUserModal');
  if (existing) existing.remove();

  const isSuperAdmin = State.user.role === 'super_admin';
  const overlay = document.createElement('div');
  overlay.id = 'editUserModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:500px">
      <h3>Edit User — ${escapeHtml(user.full_name)}</h3>
      <div class="form-row"><label>Full Name</label><input id="editUFullName" value="${escapeHtml(user.full_name)}" /></div>
      <div class="form-row"><label>Email</label><input id="editUEmail" type="email" value="${escapeHtml(user.email)}" /></div>
      <div class="form-row"><label>Mobile Number</label><input id="editUPhone" type="tel" value="${escapeHtml(user.phone_number || user.phoneNumber || '')}" placeholder="e.g. +91 98765 43210" /></div>
      ${isSuperAdmin ? `
        <div class="form-row"><label>Role</label>
          <select id="editURole">
            <option value="" ${!user.role ? 'selected disabled' : ''}>-- Select Role --</option>
            <option value="site_engineer" ${user.role === 'site_engineer' ? 'selected' : ''}>Site Engineer</option>
            <option value="region_admin" ${['region_admin', 'zone_admin'].includes(user.role) ? 'selected' : ''}>Regional Admin</option>
            <option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
          </select>
        </div>
      ` : ''}
      <div class="form-row" id="editUZoneRow" ${isSuperAdmin && user.role !== 'super_admin' ? '' : (isSuperAdmin ? 'hidden' : '')}>
        <label>Region</label>
        <select id="editUZone">${zoneOptions(user.zone_id)}</select>
      </div>
      <div class="form-row" id="editUSiteRow" ${user.role === 'site_engineer' ? '' : 'hidden'}>
        <label>Site</label>
        <select id="editUSite">${siteOptions(user.zone_id || State.user.zoneId, user.site_id)}</select>
      </div>
      <div class="form-row"><label>New Password (leave blank to keep current)</label><input id="editUPassword" type="password" autocomplete="new-password" placeholder="Optional password reset" /></div>
      <div class="form-row" style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <input type="checkbox" id="editUActive" ${user.is_active ? 'checked' : ''} style="width:auto" />
        <label for="editUActive" style="margin:0">Active Account</label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button id="cancelEditUser" class="btn-ghost" type="button">Cancel</button>
        <button id="saveEditUser" class="btn-primary" type="button">Save Changes</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  if (isSuperAdmin) {
    overlay.querySelector('#editURole')?.addEventListener('change', (e) => {
      const r = e.target.value;
      overlay.querySelector('#editUZoneRow').hidden = r === 'super_admin';
      overlay.querySelector('#editUSiteRow').hidden = r !== 'site_engineer';
    });
    overlay.querySelector('#editUZone')?.addEventListener('change', (e) => {
      overlay.querySelector('#editUSite').innerHTML = siteOptions(e.target.value);
    });
  }

  overlay.querySelector('#cancelEditUser').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#saveEditUser').addEventListener('click', async () => {
    const roleVal = isSuperAdmin ? overlay.querySelector('#editURole').value : 'site_engineer';
    const payload = {
      full_name: overlay.querySelector('#editUFullName').value.trim(),
      email: overlay.querySelector('#editUEmail').value.trim(),
      phone_number: overlay.querySelector('#editUPhone').value.trim(),
      role: roleVal,
      zone_id: roleVal === 'super_admin' ? null : (isSuperAdmin ? overlay.querySelector('#editUZone').value : State.user.zoneId),
      site_id: roleVal === 'site_engineer' ? overlay.querySelector('#editUSite').value : null,
      password: overlay.querySelector('#editUPassword').value || undefined,
      is_active: overlay.querySelector('#editUActive').checked
    };
    try {
      await Api.updateUser(user.id, payload);
      toast('User updated');
      overlay.remove();
      loadUserList();
    } catch (err) { toast(err.message, true); }
  });
}

async function loadZoneManagementList(isSuperAdmin) {
  const el = document.getElementById('zoneList');
  const zones = State.zones;
  el.innerHTML = `<table><thead><tr><th>Name</th><th>Code</th><th>HO?</th>${isSuperAdmin ? '<th>Actions</th>' : ''}</tr></thead><tbody>
    ${zones.map((z) => `<tr>
      <td class="non-mono">${z.name}</td><td>${z.code}</td><td>${z.is_ho ? 'Yes' : 'No'}</td>
      ${isSuperAdmin ? `<td>
        <div style="display:flex;gap:4px">
          <button class="btn-secondary small" data-edit-zone="${z.id}">Edit</button>
          <button class="btn-ghost small danger" data-delete-zone="${z.id}" style="color:var(--danger)">Delete</button>
        </div>
      </td>` : ''}
    </tr>`).join('')}
  </tbody></table>
  ${isSuperAdmin ? `<div class="form-inline" style="margin-top:14px">
    <div class="form-row"><label>New region name</label><input id="newZoneName" /></div>
    <div class="form-row"><label>Code</label><input id="newZoneCode" /></div>
    <button class="btn-secondary" id="addZoneBtn" style="align-self:flex-end">Add region</button>
  </div>` : ''}`;

  if (isSuperAdmin) {
    document.getElementById('addZoneBtn').addEventListener('click', async () => {
      try {
        await Api.createZone({ name: document.getElementById('newZoneName').value, code: document.getElementById('newZoneCode').value, is_ho: false });
        toast('Region created');
        await loadZonesAndSites();
        loadZoneManagementList(true);
      } catch (err) { toast(err.message, true); }
    });
    el.querySelectorAll('[data-edit-zone]').forEach((btn) => btn.addEventListener('click', () => {
      const zone = State.zones.find((x) => x.id == btn.dataset.editZone);
      if (zone) openEditZoneModal(zone);
    }));
    el.querySelectorAll('[data-delete-zone]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('Delete this region? This cannot be undone.')) return;
      try {
        await Api.deleteZone(btn.dataset.deleteZone);
        toast('Region deleted');
        await loadZonesAndSites();
        loadZoneManagementList(true);
      } catch (err) { toast(err.message, true); }
    }));
  }
}

function openEditZoneModal(zone) {
  const existing = document.getElementById('editZoneModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'editZoneModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:420px">
      <h3>Edit Region — ${zone.name}</h3>
      <div class="form-row"><label>Region Name</label><input id="editZName" value="${zone.name}" /></div>
      <div class="form-row"><label>Region Code</label><input id="editZCode" value="${zone.code}" /></div>
      <div class="form-row" style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <input type="checkbox" id="editZIsHo" ${zone.is_ho ? 'checked' : ''} style="width:auto" />
        <label for="editZIsHo" style="margin:0">Head Office (HO)?</label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button id="cancelEditZone" class="btn-ghost" type="button">Cancel</button>
        <button id="saveEditZone" class="btn-primary" type="button">Save Changes</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#cancelEditZone').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#saveEditZone').addEventListener('click', async () => {
    try {
      await Api.updateZone(zone.id, {
        name: overlay.querySelector('#editZName').value,
        code: overlay.querySelector('#editZCode').value,
        is_ho: overlay.querySelector('#editZIsHo').checked
      });
      toast('Region updated');
      overlay.remove();
      await loadZonesAndSites();
      loadZoneManagementList(true);
    } catch (err) { toast(err.message, true); }
  });
}

async function loadSiteManagementList(isSuperAdmin) {
  const el = document.getElementById('siteList');
  const zoneId = isSuperAdmin ? document.getElementById('siteZonePicker').value : State.user.zoneId;
  const sites = await Api.sites(zoneId);

  el.innerHTML = sites.length
    ? `<table><thead><tr><th>Name</th><th>Address</th><th>Actions</th></tr></thead><tbody>
        ${sites.map((s) => `<tr>
          <td class="non-mono">${s.name}</td><td class="non-mono">${s.address || '—'}</td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="btn-secondary small" data-edit-site="${s.id}">Edit</button>
              <button class="btn-ghost small danger" data-delete-site="${s.id}" style="color:var(--danger)">Delete</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody></table>`
    : `<div class="empty-state">No sites in this region yet.</div>`;

  el.querySelectorAll('[data-edit-site]').forEach((btn) => btn.addEventListener('click', () => {
    const site = sites.find((x) => x.id == btn.dataset.editSite);
    if (site) openEditSiteModal(zoneId, site);
  }));
  el.querySelectorAll('[data-delete-site]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this site? This cannot be undone.')) return;
    try {
      await Api.deleteSite(zoneId, btn.dataset.deleteSite);
      toast('Site deleted');
      await loadZonesAndSites();
      loadSiteManagementList(isSuperAdmin);
    } catch (err) { toast(err.message, true); }
  }));

  document.getElementById('addSiteBtn').onclick = async () => {
    const name = document.getElementById('newSiteName').value;
    const address = document.getElementById('newSiteAddress').value;
    if (!name) return;
    const targetZoneId = isSuperAdmin ? document.getElementById('siteZonePicker').value : State.user.zoneId;
    try {
      await Api.createSite(targetZoneId, { name, address });
      toast('Site created');
      await loadZonesAndSites();
      loadSiteManagementList(isSuperAdmin);
    } catch (err) { toast(err.message, true); }
  };
}

async function renderZoneStockMonitor() {
  const el = document.getElementById('view-regionStock') || document.getElementById('view-zoneStock');
  if (!el) return;

  el.innerHTML = `<div class="card"><div class="empty-state">Loading live region stock data…</div></div>`;

  try {
    const data = await Api.zoneStockMonitor();
    const zones = data.zones || [];
    let materials = data.materials || [];

    const totalMaterials = materials.length;
    const totalZones = zones.length;
    const lowStockCount = materials.filter((m) => m.status !== 'HEALTHY').length;
    const totalZoneUnits = materials.reduce((acc, m) => acc + Number(m.total_zone_stock || 0), 0);

    const categories = Array.from(new Set(materials.map((m) => m.category).filter(Boolean))).sort();

    let searchFilter = '';
    let selectedZoneFilter = 'all';
    let selectedCategoryFilter = 'all';
    let selectedStatusFilter = 'all';

    function renderMatrixView() {
      let filtered = materials.filter((m) => {
        const name = (m.name || '').toLowerCase();
        const category = (m.category || '').toLowerCase();
        const prefix = (m.barcode_prefix || '').toLowerCase();
        const matchesSearch = !searchFilter || name.includes(searchFilter) || category.includes(searchFilter) || prefix.includes(searchFilter);

        const matchesStatus = selectedStatusFilter === 'all' ||
          (selectedStatusFilter === 'low' && m.status !== 'HEALTHY') ||
          (selectedStatusFilter === 'healthy' && m.status === 'HEALTHY');

        const matchesCategory = selectedCategoryFilter === 'all' || m.category === selectedCategoryFilter;

        const matchesZone = selectedZoneFilter === 'all' || Number(m.zone_stock[selectedZoneFilter] || 0) > 0;

        return matchesSearch && matchesStatus && matchesCategory && matchesZone;
      });

      const zoneHeaders = zones.map((z) => `<th>${z.name}</th>`).join('');

      el.innerHTML = `
        <div class="zsm-header">
          <div class="zsm-header-text">
            <h2>Region-Wise Live Stock Monitor</h2>
            <p>Real-time material count across Head Office, Regions, and Sites</p>
          </div>
          <div class="zsm-live-badge">
            <span class="zsm-live-dot"></span> Live Backend Sync
          </div>
        </div>

        <div class="grid grid-cols-4" style="margin-bottom:20px">
          <div class="card stat-card accent">
            <div class="stat-value">${totalMaterials}</div>
            <div class="stat-label">Monitored Materials</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">${totalZones}</div>
            <div class="stat-label">Regions</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">${totalZoneUnits.toLocaleString()}</div>
            <div class="stat-label">Total Region Stock Units</div>
          </div>
          <div class="card stat-card ${lowStockCount > 0 ? 'warn' : ''}">
            <div class="stat-value" style="color: ${lowStockCount > 0 ? 'var(--danger)' : 'var(--success)'}">${lowStockCount}</div>
            <div class="stat-label">Stock Alerts</div>
          </div>
        </div>

        <div class="zsm-table-card">
          <div class="zsm-toolbar">
            <div class="zsm-filter-group">
              <input id="zsmSearch" placeholder="Search material, category, or barcode prefix…" value="${searchFilter}" style="min-width:260px;flex:1" />
              <select id="zsmCategoryFilter" style="width:auto">
                <option value="all" ${selectedCategoryFilter === 'all' ? 'selected' : ''}>All Categories</option>
                ${categories.map((c) => `<option value="${c}" ${selectedCategoryFilter === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
              <select id="zsmZoneFilter" style="width:auto">
                <option value="all" ${selectedZoneFilter === 'all' ? 'selected' : ''}>All Regions</option>
                ${zones.map((z) => `<option value="${z.id}" ${Number(selectedZoneFilter) === z.id ? 'selected' : ''}>${z.name}</option>`).join('')}
              </select>
              <select id="zsmStatusFilter" style="width:auto">
                <option value="all" ${selectedStatusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
                <option value="low" ${selectedStatusFilter === 'low' ? 'selected' : ''}>Low / Out of Stock</option>
                <option value="healthy" ${selectedStatusFilter === 'healthy' ? 'selected' : ''}>Healthy Stock</option>
              </select>
            </div>
            <button class="btn-secondary" id="zsmRefreshBtn" type="button">Refresh Live Data</button>
          </div>

          ${!filtered.length ? `<div class="empty-state">No materials found matching criteria.</div>` : `
          <div class="table-responsive">
            <table class="zsm-matrix-table">
              <thead>
                <tr>
                  <th>Material Info</th>
                  <th>Category</th>
                  <th>Min Stock</th>
                  <th>HO Stock</th>
                  ${zoneHeaders}
                  <th>Total Region</th>
                  <th>Deployed</th>
                  <th>In Transit</th>
                  <th>Total Active</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map((m) => {
        const zoneCells = zones.map((z) => {
          const qty = Number(m.zone_stock[z.id] || 0);
          return `<td><span class="zsm-zone-pill ${qty > 0 ? 'has-stock' : ''}">${qty} ${m.unit}</span></td>`;
        }).join('');

        let statusPill = `<span class="pill pill-success">HEALTHY</span>`;
        if (m.status === 'LOW_STOCK') statusPill = `<span class="pill pill-warning">LOW STOCK</span>`;
        if (m.status === 'OUT_OF_STOCK') statusPill = `<span class="pill pill-danger">OUT OF STOCK</span>`;

        return `<tr>
                    <td>
                      <div class="zsm-material-title">${m.name}</div>
                      ${m.barcode_prefix ? `<span class="zsm-prefix-tag">Prefix: ${m.barcode_prefix}</span>` : ''}
                    </td>
                    <td><span class="pill">${m.category}</span></td>
                    <td class="mono">${m.min_stock_level} ${m.unit}</td>
                    <td class="mono"><strong>${m.ho_stock}</strong> ${m.unit}</td>
                    ${zoneCells}
                    <td class="mono"><strong style="color:var(--brand)">${m.total_zone_stock}</strong> ${m.unit}</td>
                    <td class="mono">${m.site_stock} ${m.unit}</td>
                    <td class="mono">${m.in_transit_stock} ${m.unit}</td>
                    <td class="mono"><strong>${m.total_active_stock}</strong> ${m.unit}</td>
                    <td>${statusPill}</td>
                  </tr>`;
      }).join('')}
              </tbody>
            </table>
          </div>`}
        </div>`;

      document.getElementById('zsmSearch')?.addEventListener('input', (e) => {
        searchFilter = e.target.value.toLowerCase().trim();
        renderMatrixView();
      });
      document.getElementById('zsmCategoryFilter')?.addEventListener('change', (e) => {
        selectedCategoryFilter = e.target.value;
        renderMatrixView();
      });
      document.getElementById('zsmZoneFilter')?.addEventListener('change', (e) => {
        selectedZoneFilter = e.target.value;
        renderMatrixView();
      });
      document.getElementById('zsmStatusFilter')?.addEventListener('change', (e) => {
        selectedStatusFilter = e.target.value;
        renderMatrixView();
      });
      document.getElementById('zsmRefreshBtn')?.addEventListener('click', () => {
        renderZoneStockMonitor();
        toast('Live region stock data refreshed');
      });
    }

    renderMatrixView();
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="form-error">Failed to load region stock monitor data: ${err.message}</div></div>`;
  }
}
const renderRegionStockMonitor = renderZoneStockMonitor;

function openEditSiteModal(zoneId, site) {
  const existing = document.getElementById('editSiteModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'editSiteModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:420px">
      <h3>Edit Site — ${site.name}</h3>
      <div class="form-row"><label>Site Name</label><input id="editSName" value="${site.name}" /></div>
      <div class="form-row"><label>Address</label><input id="editSAddress" value="${site.address || ''}" /></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button id="cancelEditSite" class="btn-ghost" type="button">Cancel</button>
        <button id="saveEditSite" class="btn-primary" type="button">Save Changes</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#cancelEditSite').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#saveEditSite').addEventListener('click', async () => {
    try {
      await Api.updateSite(zoneId, site.id, {
        name: overlay.querySelector('#editSName').value,
        address: overlay.querySelector('#editSAddress').value
      });
      toast('Site updated');
      overlay.remove();
      await loadZonesAndSites();
      const isSuperAdmin = State.user.role === 'super_admin';
      loadSiteManagementList(isSuperAdmin);
    } catch (err) { toast(err.message, true); }
  });
}

function toast(message, isError = false) {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${isError ? 'error' : ''}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function openAdminAlertsModal() {
  const existing = document.getElementById('adminAlertsModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'adminAlertsModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">
        <h3>Admin alerts</h3>
        <button class="btn-ghost" id="closeAdminAlertsBtn" type="button">Close</button>
      </div>
      <div id="adminAlertsContent" class="empty-state">Loading alerts…</div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('closeAdminAlertsBtn').addEventListener('click', () => modal.remove());

  try {
    const alerts = await Api.adminAlerts();
    const content = document.getElementById('adminAlertsContent');
    const isSuperAdmin = State.user?.role === 'super_admin';
    if (!alerts.total_alerts) {
      content.innerHTML = '<div class="empty-state">No pending alerts right now.</div>';
      return;
    }

    const lowStockMarkup = alerts.low_stock.length ? `
      <div class="section-header"><h3>Low stock alerts</h3></div>
      <div class="card">
        ${alerts.low_stock.map((item) => `
          <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border-soft)">
            <strong>${item.material_name}</strong><br />
            <span class="muted">Region: ${item.region_name || item.zone_name || 'Unknown'} · Qty: ${item.quantity} · Min Stock: ${item.min_stock_level !== undefined ? item.min_stock_level : item.reorder_level}</span>
          </div>
        `).join('')}
      </div>
    ` : '';

    const requisitionMarkup = alerts.pending_requisitions.length ? `
      <div class="section-header"><h3>New requisitions</h3></div>
      <div class="card">
        ${alerts.pending_requisitions.map((req) => `
          <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border-soft)">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><strong>${req.oms_ticket_number || req.oms_number}</strong><span class="status-pill warn">${req.status}</span></div>
            <div class="muted">${req.material_name} · ${req.site_name} · ${req.region_name || req.zone_name || '—'}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn-secondary small" data-alert-view-requisition="${req.id}" type="button">View</button>
              ${isSuperAdmin ? `<button class="btn-primary small" data-alert-approve-requisition="${req.id}" type="button">Approve</button><button class="btn-ghost small" data-alert-reject-requisition="${req.id}" type="button">Reject</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    const poMarkup = alerts.pending_purchase_orders.length ? `
      <div class="section-header"><h3>New purchase orders</h3></div>
      <div class="card">
        ${alerts.pending_purchase_orders.map((po) => `
          <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border-soft)">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><strong>${po.po_number}</strong><span class="status-pill warn">${po.status}</span></div>
            <div class="muted">${po.entry_mode} · ${po.zone_name || 'HO'}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              ${isSuperAdmin ? `<button class="btn-primary small" data-alert-approve-po="${po.id}" type="button">Approve</button><button class="btn-ghost small" data-alert-reject-po="${po.id}" type="button">Reject</button>` : '<span class="muted">Only the super admin can approve or reject.</span>'}
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    content.innerHTML = `${lowStockMarkup}${requisitionMarkup}${poMarkup}`;

    content.querySelectorAll('[data-alert-view-requisition]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const reqs = await Api.requisitions();
          const reqObj = reqs.find((r) => String(r.id) === String(btn.dataset.alertViewRequisition));
          if (reqObj) showViewRequisitionModal(reqObj);
        } catch (err) { toast(err.message, true); }
      });
    });

    content.querySelectorAll('[data-alert-approve-requisition]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reqId = btn.dataset.alertApproveRequisition;
        try {
          const reqs = await Api.requisitions();
          const reqObj = reqs.find((r) => String(r.id) === String(reqId));
          if (!reqObj) {
            await Api.approveRequisition(reqId);
            toast('Requisition approved');
            openAdminAlertsModal();
            return;
          }
          showApproveFulfillRequisitionModal(reqObj, async (data) => {
            try {
              if (data.action === 'approve_only') {
                await Api.approveRequisition(reqObj.id);
                toast('Requisition approved successfully');
              } else {
                if (reqObj.status === 'PENDING') {
                  await Api.approveRequisition(reqObj.id).catch(() => { });
                }
                const codes = data.serial ? [data.serial] : undefined;
                await Api.dispatchToSite({
                  material_id: reqObj.material_id,
                  region_id: reqObj.region_id || reqObj.zone_id || State.user.regionId || State.user.zoneId,
                  site_id: reqObj.site_id,
                  quantity: data.quantity,
                  barcode_values: codes,
                  requisition_id: reqObj.id,
                  notes: data.notes || `Fulfilled for OMS Ticket #${reqObj.oms_ticket_number || reqObj.oms_number}`
                });
                toast(`Requisition items fulfilled (${data.quantity} units dispatched to site)`);
              }
              openAdminAlertsModal();
              if (typeof loadReqList === 'function') loadReqList();
            } catch (err) { toast(err.message, true); }
          });
        } catch (err) { toast(err.message, true); }
      });
    });

    content.querySelectorAll('[data-alert-reject-requisition]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const reason = window.prompt('Rejection reason (optional):') || '';
          await Api.rejectRequisition(btn.dataset.alertRejectRequisition, reason.trim() || undefined);
          toast('Requisition rejected');
          openAdminAlertsModal();
        } catch (err) { toast(err.message, true); }
      });
    });

    content.querySelectorAll('[data-alert-approve-po]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.approvePO(btn.dataset.alertApprovePo);
          toast('Purchase order approved');
          openAdminAlertsModal();
        } catch (err) { toast(err.message, true); }
      });
    });

    content.querySelectorAll('[data-alert-reject-po]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const reason = window.prompt('Rejection reason (optional):') || '';
          await Api.rejectPO(btn.dataset.alertRejectPo, reason.trim() || undefined);
          toast('Purchase order rejected');
          openAdminAlertsModal();
        } catch (err) { toast(err.message, true); }
      });
    });
  } catch (err) {
    document.getElementById('adminAlertsContent').innerHTML = `<div class="empty-state">Could not load alerts: ${err.message}</div>`;
  }
}

async function renderTransactions() {
  const el = document.getElementById('view-transactions');
  el.innerHTML = `<div class="empty-state">Loading transactions ledger…</div>`;

  try {
    const rawTransactions = await Api.transactions();
    let transactions = Array.isArray(rawTransactions) ? rawTransactions : [];

    function renderView() {
      const typeFilterVal = document.getElementById('txTypeFilter')?.value || '';
      const matFilterVal = document.getElementById('txMaterialFilter')?.value || '';
      const searchVal = (document.getElementById('txSearchInput')?.value || '').toLowerCase().trim();

      const filtered = transactions.filter((t) => {
        if (typeFilterVal) {
          const aliasType = typeFilterVal.replace('_REGION', '_ZONE').replace('_HR', '_HZ').replace('_R', '_Z');
          if (t.transaction_type !== typeFilterVal && t.transaction_type !== aliasType) return false;
        }
        if (matFilterVal && String(t.material_id) !== String(matFilterVal)) return false;
        if (searchVal) {
          let ticketNo = t.oms_ticket_number || t.oms_number;
          if (!ticketNo && t.notes) {
            const match = t.notes.match(/OMS Ticket:\s*([^\]\s]+)/i);
            if (match) ticketNo = match[1];
          }
          const matchText = [
            t.material_name,
            t.serial_number,
            t.barcode_value,
            t.admin_name,
            t.site_engineer_name,
            t.created_by_name,
            t.from_region_name,
            t.from_zone_name,
            t.to_region_name,
            t.to_zone_name,
            t.from_site_name,
            t.to_site_name,
            ticketNo,
            ticketNo ? `oms: ${ticketNo}` : '',
            ticketNo ? `oms ${ticketNo}` : '',
            ticketNo ? `oms-${ticketNo}` : '',
            t.po_number,
            t.po_number ? `po: ${t.po_number}` : '',
            t.notes
          ].filter(Boolean).join(' ').toLowerCase();
          if (!matchText.includes(searchVal)) return false;
        }
        return true;
      });

      const totalCount = filtered.length;
      const totalQty = filtered.reduce((acc, curr) => acc + (parseFloat(curr.quantity) || 0), 0);
      const uniqueAdmins = new Set(filtered.map(t => t.admin_name).filter(n => n && n !== 'N/A')).size;
      const uniqueEngineers = new Set(filtered.map(t => t.site_engineer_name).filter(n => n && n !== 'N/A')).size;

      const tableRowsHtml = filtered.length ? filtered.map((t) => {
        let ticketNo = t.oms_ticket_number || t.oms_number;
        if (!ticketNo && t.notes) {
          const match = t.notes.match(/OMS Ticket:\s*([^\]\s]+)/i);
          if (match) ticketNo = match[1];
        }
        const refBadge = ticketNo
          ? `<span class="badge ref-badge oms-badge">OMS: ${escapeHtml(ticketNo)}</span>`
          : (t.po_number ? `<span class="badge ref-badge po-badge">PO: ${escapeHtml(t.po_number)}</span>` : '—');

        const sn = t.serial_number || t.barcode_value;
        const serialBadge = sn ? `<span class="muted" style="font-family:var(--font-mono)">SN: ${sn}</span>` : '';

        const fromRegionName = t.from_region_name || t.from_zone_name;
        const toRegionName = t.to_region_name || t.to_zone_name;

        const fromLoc = t.from_location_type === 'HO' ? 'HO Warehouse' :
          (t.from_location_type === 'SUPPLIER' ? 'Supplier' :
            (t.from_site_name ? `Site: ${t.from_site_name}` : (fromRegionName ? `Region: ${fromRegionName}` : '—')));

        const toLoc = t.to_location_type === 'HO' ? 'HO Warehouse' :
          (t.to_location_type === 'SUPPLIER' ? 'Supplier' :
            (t.to_site_name ? `Site: ${t.to_site_name}` : (toRegionName ? `Region: ${toRegionName}` : '—')));

        return `
          <tr>
            <td class="mono-date">${fmtDate(t.created_at)}</td>
            <td>${pill(t.transaction_type)}</td>
            <td><strong>${t.material_name}</strong></td>
            <td>
              <div style="font-weight:600">${t.quantity}</div>
              <div style="font-size:12px; margin-top:2px">${serialBadge}</div>
            </td>
            <td>
              <div class="tx-location-flow">
                <span class="loc-tag">${fromLoc}</span>
                <span class="flow-arrow">→</span>
                <span class="loc-tag highlight">${toLoc}</span>
              </div>
            </td>
            <td>
              <span class="user-chip-badge admin-chip">
                ${t.admin_name || 'N/A'}
              </span>
            </td>
            <td>
              <span class="user-chip-badge engineer-chip">
                ${t.site_engineer_name || 'N/A'}
              </span>
            </td>
            <td>${refBadge}</td>
            <td>
              <div style="font-weight:500">${t.created_by_name || 'System'}</div>
              <div class="muted" style="font-size:12px">${t.notes || '—'}</div>
            </td>
          </tr>
        `;
      }).join('') : `<tr><td colspan="9" class="empty-state">No transactions matching criteria.</td></tr>`;

      document.getElementById('txTableBody').innerHTML = tableRowsHtml;
      document.getElementById('txStatTotal').textContent = totalCount;
      document.getElementById('txStatQty').textContent = totalQty.toLocaleString();
      document.getElementById('txStatAdmins').textContent = uniqueAdmins;
      document.getElementById('txStatEngineers').textContent = uniqueEngineers;
    }

    el.innerHTML = `
      <div class="section-header">
        <div>
          <h3>Transactions Ledger</h3>
          <p class="muted" style="font-size:13px; margin-top:4px">Complete audit trail of inventory dispatches, receipts, and site consumptions with assigned Admins and Site Engineers.</p>
        </div>
      </div>

      <div class="grid grid-cols-4" style="margin-bottom:20px">
        <div class="card stat-card accent">
          <div class="stat-value" id="txStatTotal">0</div>
          <div class="stat-label">Total Transactions</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value" id="txStatQty">0</div>
          <div class="stat-label">Units/Items Moved</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value" id="txStatAdmins">0</div>
          <div class="stat-label">Admins Involved</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value" id="txStatEngineers">0</div>
          <div class="stat-label">Site Engineers Involved</div>
        </div>
      </div>

      <div class="zsm-toolbar" style="border-radius: var(--radius-lg); margin-bottom: 20px; border: 1px solid var(--border);">
        <div class="zsm-filter-group">
          <input type="text" id="txSearchInput" placeholder="Search material, serial #, admin, engineer, OMS Ticket..." style="min-width:260px; flex:1" />
          <select id="txTypeFilter" style="width:auto">
            <option value="">All Transaction Types</option>
            <option value="IN">IN (HO Receipt)</option>
            <option value="IN_REGION">IN REGION (Direct Region Receipt)</option>
            <option value="DISPATCH_HR">DISPATCH HR (HO -> Region)</option>
            <option value="RECEIVE_R">RECEIVE R (Region Confirm)</option>
            <option value="DISPATCH_RE">DISPATCH RE (Region -> Engineer)</option>
            <option value="CONSUME">CONSUME (Engineer Consumed)</option>
            <option value="OUT">OUT (Stock Out)</option>
            <option value="RETURN">RETURN (Stock Return)</option>
          </select>
          <select id="txMaterialFilter" style="width:auto">
            ${materialOptions('', 'All Materials')}
          </select>
        </div>
        <button class="btn-secondary" id="txResetBtn" type="button">Reset Filters</button>
      </div>

      <div class="card">
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Type</th>
                <th>Material</th>
                <th>Qty / Serial #</th>
                <th>From -> To Movement</th>
                <th>Admin Name</th>
                <th>Site Engineer Name</th>
                <th>Reference</th>
                <th>Executed By / Notes</th>
              </tr>
            </thead>
            <tbody id="txTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('txSearchInput')?.addEventListener('input', renderView);
    document.getElementById('txTypeFilter')?.addEventListener('change', renderView);
    document.getElementById('txMaterialFilter')?.addEventListener('change', renderView);
    document.getElementById('txResetBtn')?.addEventListener('click', () => {
      document.getElementById('txSearchInput').value = '';
      document.getElementById('txTypeFilter').value = '';
      document.getElementById('txMaterialFilter').value = '';
      renderView();
    });

    renderView();
  } catch (err) {
    el.innerHTML = `<div class="empty-state">Could not load transactions: ${err.message}</div>`;
  }
}

async function renderProfile() {
  const el = document.getElementById('view-profile');
  if (!el) return;

  el.innerHTML = `<div class="empty-state">Loading your profile…</div>`;

  try {
    const user = await Api.me();
    Auth.setUser(user);
    State.user = user;
    if (typeof updateSidebarUser === 'function') updateSidebarUser(user);

    const initials = (user.fullName || user.email || '--').slice(0, 2).toUpperCase();
    const roleName = (user.role || '').replace('_', ' ').toUpperCase();
    const regName = user.regionName || user.zoneName || 'All regions';
    const siteName = user.siteName || '';
    const rawPhone = user.phoneNumber || user.phone_number || '';
    const phoneFormatted = formatUserPhone(rawPhone);

    el.innerHTML = `
      <div class="profile-container">
        <!-- Left Summary Card -->
        <div class="profile-sidebar-card card">
          <div class="profile-avatar-circle">${initials}</div>
          <h3 class="profile-user-name">${escapeHtml(user.fullName || user.email)}</h3>
          <span class="status-pill ok" style="margin-top: 8px; display: inline-block;">${roleName}</span>
          
          <div class="profile-details-list">
            <div class="profile-detail-item">
              <span class="detail-label">Email</span>
              <span class="detail-value">${escapeHtml(user.email)}</span>
            </div>
            <div class="profile-detail-item">
              <span class="detail-label">Region / Zone</span>
              <span class="detail-value">${escapeHtml(regName)}</span>
            </div>
            ${siteName ? `
            <div class="profile-detail-item">
              <span class="detail-label">Assigned Site</span>
              <span class="detail-value">${escapeHtml(siteName)}</span>
            </div>` : ''}
            <div class="profile-detail-item">
              <span class="detail-label">Phone</span>
              <span class="detail-value">${escapeHtml(phoneFormatted !== '—' ? phoneFormatted : 'Not provided')}</span>
            </div>
          </div>
        </div>

        <!-- Right Edit Form Card -->
        <div class="profile-content-card card">
          <div class="profile-tabs">
            <button class="profile-tab-btn active" id="tabBtnPersonal">Personal Information</button>
            <button class="profile-tab-btn" id="tabBtnSecurity">Security</button>
          </div>

          <!-- Personal Info Form -->
          <form id="profilePersonalForm" class="profile-form-section">
            <div class="form-row">
              <label for="profileFullName">Full Name <span class="required">*</span></label>
              <input type="text" id="profileFullName" value="${escapeHtml(user.fullName || '')}" required />
            </div>
            <div class="form-row">
              <label for="profileEmail">Email Address <span class="required">*</span></label>
              <input type="email" id="profileEmail" value="${escapeHtml(user.email || '')}" required />
            </div>
            <div class="form-row">
              <label for="profilePhone">Phone Number</label>
              <input type="tel" id="profilePhone" value="${escapeHtml(rawPhone)}" placeholder="e.g. +91 98765 43210" />
            </div>
            
            <div class="profile-form-actions">
              <button type="submit" class="btn-primary" id="savePersonalBtn">Save Changes</button>
            </div>
          </form>

          <!-- Security Form -->
          <form id="profileSecurityForm" class="profile-form-section" style="display: none;">
            <div class="form-row">
              <label for="profileCurrentPassword">Current Password <span class="required">*</span></label>
              <input type="password" id="profileCurrentPassword" placeholder="Enter current password" minlength="6" />
            </div>
            <div class="form-row">
              <label for="profileNewPassword">New Password <span class="required">*</span></label>
              <input type="password" id="profileNewPassword" placeholder="Minimum 6 characters" minlength="6" />
            </div>
            <div class="form-row">
              <label for="profileConfirmPassword">Confirm New Password <span class="required">*</span></label>
              <input type="password" id="profileConfirmPassword" placeholder="Re-enter new password" minlength="6" />
            </div>
            
            <div class="profile-form-actions">
              <button type="submit" class="btn-primary" id="saveSecurityBtn">Update Password</button>
            </div>
          </form>
          
          <div id="profileError" class="form-error" style="margin-top: 16px;" hidden></div>
          <div id="profileSuccess" style="margin-top: 16px; color: var(--success); font-weight: 500; font-size: 14px;" hidden></div>
        </div>
      </div>
    `;

    const tabPersonal = el.querySelector('#tabBtnPersonal');
    const tabSecurity = el.querySelector('#tabBtnSecurity');
    const formPersonal = el.querySelector('#profilePersonalForm');
    const formSecurity = el.querySelector('#profileSecurityForm');
    const errEl = el.querySelector('#profileError');
    const successEl = el.querySelector('#profileSuccess');

    const clearMessages = () => {
      errEl.hidden = true;
      successEl.hidden = true;
    };

    tabPersonal.onclick = () => {
      tabPersonal.classList.add('active');
      tabSecurity.classList.remove('active');
      formPersonal.style.display = 'block';
      formSecurity.style.display = 'none';
      clearMessages();
    };

    tabSecurity.onclick = () => {
      tabSecurity.classList.add('active');
      tabPersonal.classList.remove('active');
      formPersonal.style.display = 'none';
      formSecurity.style.display = 'block';
      clearMessages();
    };

    formPersonal.onsubmit = async (e) => {
      e.preventDefault();
      clearMessages();
      const saveBtn = el.querySelector('#savePersonalBtn');
      saveBtn.disabled = true;

      const fullName = el.querySelector('#profileFullName').value.trim();
      const email = el.querySelector('#profileEmail').value.trim();
      const phone = el.querySelector('#profilePhone').value.trim();

      try {
        const res = await Api.updateProfile({
          full_name: fullName,
          email,
          phone_number: phone
        });

        Auth.setUser(res.user);
        State.user = res.user;
        if (typeof updateSidebarUser === 'function') updateSidebarUser(res.user);

        await renderProfile();

        const newSuccessEl = document.getElementById('profileSuccess');
        if (newSuccessEl) {
          newSuccessEl.textContent = 'Personal information updated successfully!';
          newSuccessEl.hidden = false;
        }
      } catch (err) {
        errEl.textContent = err.message || 'Failed to update personal details';
        errEl.hidden = false;
      } finally {
        saveBtn.disabled = false;
      }
    };

    formSecurity.onsubmit = async (e) => {
      e.preventDefault();
      clearMessages();
      const saveBtn = el.querySelector('#saveSecurityBtn');

      const currentPassword = el.querySelector('#profileCurrentPassword').value;
      const newPassword = el.querySelector('#profileNewPassword').value;
      const confirmPassword = el.querySelector('#profileConfirmPassword').value;

      if (!currentPassword) {
        errEl.textContent = 'Please enter your current password';
        errEl.hidden = false;
        return;
      }
      if (newPassword.length < 6) {
        errEl.textContent = 'New password must be at least 6 characters long';
        errEl.hidden = false;
        return;
      }
      if (newPassword !== confirmPassword) {
        errEl.textContent = 'New passwords do not match';
        errEl.hidden = false;
        return;
      }

      saveBtn.disabled = true;
      try {
        const res = await Api.updateProfile({
          current_password: currentPassword,
          new_password: newPassword
        });

        Auth.setUser(res.user);
        State.user = res.user;

        el.querySelector('#profileCurrentPassword').value = '';
        el.querySelector('#profileNewPassword').value = '';
        el.querySelector('#profileConfirmPassword').value = '';

        successEl.textContent = 'Password updated successfully!';
        successEl.hidden = false;
      } catch (err) {
        errEl.textContent = err.message || 'Failed to update password';
        errEl.hidden = false;
      } finally {
        saveBtn.disabled = false;
      }
    };

  } catch (err) {
    el.innerHTML = `<div class="empty-state">Could not load profile: ${err.message}</div>`;
  }
}