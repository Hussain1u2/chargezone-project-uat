const pool = require('../config/db');

async function getLowStock(isSuperAdmin, regionId) {
  const { rows } = await pool.query(
    `SELECT sl.*, m.name AS material_name, m.min_stock_level, m.min_stock_level AS reorder_level, r.name AS region_name, r.name AS zone_name
     FROM stock_levels sl
     JOIN materials m ON sl.material_id = m.id
     LEFT JOIN regions r ON sl.region_id = r.id
     WHERE sl.quantity <= m.min_stock_level ${isSuperAdmin ? '' : 'AND sl.region_id = $1'}
     ORDER BY sl.quantity ASC LIMIT 20`,
    isSuperAdmin ? [] : [regionId]
  );
  return rows;
}

async function getPendingRequisitionCount(isSuperAdmin, regionId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM requisitions WHERE status IN ('PENDING','PARTIAL') ${isSuperAdmin ? '' : 'AND region_id = $1'}`,
    isSuperAdmin ? [] : [regionId]
  );
  return rows[0].count;
}

async function getRecentTransactions(isSuperAdmin, regionId) {
  const { rows } = await pool.query(
    `SELECT t.*, m.name AS material_name FROM transactions t JOIN materials m ON t.material_id = m.id
     ${isSuperAdmin ? '' : 'WHERE t.from_region_id = $1 OR t.to_region_id = $1'}
     ORDER BY t.created_at DESC LIMIT 10`,
    isSuperAdmin ? [] : [regionId]
  );
  return rows;
}

async function getItemStatusCounts(isSuperAdmin, regionId) {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*) AS count FROM items ${isSuperAdmin ? '' : 'WHERE current_region_id = $1'} GROUP BY status`,
    isSuperAdmin ? [] : [regionId]
  );
  return rows;
}

async function getRegionStockLineCount(isSuperAdmin, regionId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM stock_levels WHERE location_type::text IN ('REGION', 'ZONE') ${isSuperAdmin ? '' : 'AND region_id = $1'}`,
    isSuperAdmin ? [] : [regionId]
  );
  return rows[0].count;
}

async function getRegionStockByRegion(isSuperAdmin, regionId) {
  const params = [];
  let where = "WHERE sl.location_type::text IN ('REGION', 'ZONE')";
  if (!isSuperAdmin) { where += ' AND sl.region_id = $1'; params.push(regionId); }
  const { rows } = await pool.query(
    `SELECT r.id AS region_id, r.id AS zone_id, r.name AS region_name, r.name AS zone_name, SUM(sl.quantity) AS total_quantity
     FROM stock_levels sl
     JOIN regions r ON sl.region_id = r.id
     ${where}
     GROUP BY r.id, r.name
     ORDER BY r.name`,
    params
  );
  return rows;
}

function buildAdminAlertsPayload({ lowStockRows, pendingRequisitionRows, pendingPurchaseOrderRows }) {
  const lowStock = lowStockRows || [];
  const pendingRequisitions = pendingRequisitionRows || [];
  const pendingPurchaseOrders = pendingPurchaseOrderRows || [];

  return {
    low_stock: lowStock,
    pending_requisitions: pendingRequisitions,
    pending_purchase_orders: pendingPurchaseOrders,
    total_alerts: lowStock.length + pendingRequisitions.length + pendingPurchaseOrders.length
  };
}

async function buildDashboardSummary(user) {
  const isSuperAdmin = user.role === 'super_admin';
  const targetRegionId = user.regionId || user.zoneId;
  const [regionStockLines, regionStockByRegion, lowStock, pendingRequisitions, recentTransactions, itemStatusCounts] = await Promise.all([
    getRegionStockLineCount(isSuperAdmin, targetRegionId),
    getRegionStockByRegion(isSuperAdmin, targetRegionId),
    getLowStock(isSuperAdmin, targetRegionId),
    getPendingRequisitionCount(isSuperAdmin, targetRegionId),
    getRecentTransactions(isSuperAdmin, targetRegionId),
    getItemStatusCounts(isSuperAdmin, targetRegionId)
  ]);

  return {
    region_stock_lines: regionStockLines,
    zone_stock_lines: regionStockLines,
    region_stock_by_region: regionStockByRegion,
    zone_stock_by_zone: regionStockByRegion,
    low_stock: lowStock,
    pending_requisitions: pendingRequisitions,
    recent_transactions: recentTransactions,
    item_status_counts: itemStatusCounts
  };
}

async function getRegionStockMonitor(user) {
  const [regionsRes, materialsRes, stockLevelsRes, itemsRes] = await Promise.all([
    pool.query("SELECT id, name, code, is_ho FROM regions WHERE is_ho = FALSE AND UPPER(name) NOT LIKE '%HEAD OFFICE%' ORDER BY id ASC"),
    pool.query('SELECT id, name, category, unit, price, min_stock_level FROM materials ORDER BY name ASC'),
    pool.query('SELECT material_id, location_type, region_id, quantity FROM stock_levels'),
    pool.query('SELECT material_id, status, current_region_id, COUNT(*)::int AS count FROM items GROUP BY material_id, status, current_region_id')
  ]);

  const regions = regionsRes.rows;
  const materials = materialsRes.rows;

  const matrix = materials.map((m) => {
    const regionStock = {};
    regions.forEach((r) => { regionStock[r.id] = 0; });

    let hoStock = 0;
    let siteStock = 0;
    let inTransitCount = 0;
    let consumedCount = 0;
    let repairableCount = 0;
    let scrapCount = 0;

    const hasSerializedItems = itemsRes.rows.some((it) => it.material_id === m.id);

    if (hasSerializedItems) {
      itemsRes.rows.forEach((it) => {
        if (it.material_id === m.id) {
          const itemRegionId = it.current_region_id;
          const count = Number(it.count || 0);

          if ((it.status === 'IN_REGION' || it.status === 'IN_ZONE') && itemRegionId) {
            if (regionStock[itemRegionId] !== undefined) {
              regionStock[itemRegionId] += count;
            } else {
              hoStock += count;
            }
          } else if (it.status === 'IN_SITE' || it.status === 'CONSUMED') {
            siteStock += count;
            if (it.status === 'CONSUMED') consumedCount += count;
          } else if (it.status === 'IN_HO') {
            hoStock += count;
          } else if (it.status === 'IN_TRANSIT_TO_REGION' || it.status === 'IN_TRANSIT_TO_ZONE' || it.status === 'IN_TRANSIT_TO_SITE') {
            inTransitCount += count;
          } else if (it.status === 'REPAIRABLE') {
            repairableCount += count;
          } else if (it.status === 'SCRAP') {
            scrapCount += count;
          }
        }
      });
    } else {
      stockLevelsRes.rows.forEach((sl) => {

        if (sl.material_id === m.id) {
          const qty = Number(sl.quantity || 0);
          if (sl.location_type === 'HO') {
            hoStock += qty;
          } else if ((sl.location_type === 'REGION' || sl.location_type === 'ZONE') && sl.region_id) {
            if (regionStock[sl.region_id] !== undefined) {
              regionStock[sl.region_id] += qty;
            } else {
              hoStock += qty;
            }
          } else if (sl.location_type === 'SITE') {
            siteStock += qty;
          } else if (sl.location_type === 'TRANSIT' || sl.location_type === 'IN_TRANSIT') {
            inTransitCount += qty;
          }
        }
      });
    }

    const totalRegionStock = Object.values(regionStock).reduce((a, b) => a + b, 0);
    const totalActiveStock = hoStock + totalRegionStock + siteStock + inTransitCount;

    let status = 'HEALTHY';
    if (totalActiveStock <= Number(m.min_stock_level || 0)) {
      status = totalActiveStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
    }

    return {
      id: m.id,
      name: m.name,
      category: m.category || 'General',
      unit: m.unit || 'pcs',
      price: Number(m.price || 0),
      min_stock_level: Number(m.min_stock_level || 0),
      barcode_prefix: m.barcode_prefix || '',
      ho_stock: hoStock,
      region_stock: regionStock,
      zone_stock: regionStock,
      total_region_stock: totalRegionStock,
      total_zone_stock: totalRegionStock,
      site_stock: siteStock,
      in_transit_stock: inTransitCount,
      consumed_count: consumedCount,
      repairable_count: repairableCount,
      scrap_count: scrapCount,
      total_active_stock: totalActiveStock,
      status
    };
  });

  return {
    regions,
    zones: regions,
    materials: matrix
  };
}

const getZoneStockMonitor = getRegionStockMonitor;

module.exports = { buildDashboardSummary, buildAdminAlertsPayload, getRegionStockMonitor, getZoneStockMonitor };
