const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { buildDashboardSummary, buildAdminAlertsPayload, getRegionStockMonitor } = require('../services/dashboardService');
const { handleRouteError } = require('../utils/errorHandler');

const router = express.Router();
router.use(authenticate);

router.get('/summary', async (req, res) => {
  res.json(await buildDashboardSummary(req.user));
});

const handleRegionStockMonitor = async (req, res) => {
  try {
    const data = await getRegionStockMonitor(req.user);
    res.json(data);
  } catch (err) {
    handleRouteError(res, err, 500);
  }
};

router.get('/region-stock-monitor', handleRegionStockMonitor);
router.get('/zone-stock-monitor', handleRegionStockMonitor);

router.get('/alerts', async (req, res) => {
  const userRegionId = (req.user.regionId || req.user.zoneId) ? Number(req.user.regionId || req.user.zoneId) : null;
  const isSuperAdmin = req.user.role === 'super_admin' || !userRegionId || isNaN(userRegionId);
  const params = isSuperAdmin ? [] : [userRegionId];

  const [lowStockRows, pendingRequisitionRows, pendingPurchaseOrderRows] = await Promise.all([
    pool.query(
      `SELECT sl.*, m.name AS material_name, m.min_stock_level, m.min_stock_level AS reorder_level, reg.name AS region_name, reg.name AS zone_name
       FROM stock_levels sl
       JOIN materials m ON sl.material_id = m.id
       LEFT JOIN regions reg ON sl.region_id = reg.id
       WHERE sl.quantity <= m.min_stock_level ${isSuperAdmin ? '' : 'AND sl.region_id = $1'}
       ORDER BY sl.quantity ASC LIMIT 20`,
      params
    ),
    pool.query(
      `SELECT r.id, r.oms_ticket_number AS oms_ticket_number, r.oms_ticket_number AS oms_number, r.status, m.name AS material_name, s.name AS site_name, reg.name AS region_name, reg.name AS zone_name
       FROM requisitions r
       JOIN materials m ON r.material_id = m.id
       JOIN sites s ON r.site_id = s.id
       JOIN regions reg ON r.region_id = reg.id
       WHERE r.status IN ('PENDING', 'PARTIAL') ${isSuperAdmin ? '' : 'AND r.region_id = $1'}
       ORDER BY r.created_at DESC LIMIT 20`,
      params
    ),
    pool.query(
      `SELECT po.id, po.po_number, po.status, po.entry_mode, reg.name AS region_name, reg.name AS zone_name
       FROM purchase_orders po
       LEFT JOIN regions reg ON po.region_id = reg.id
       WHERE po.status IN ('UPLOADED', 'EXTRACTED') ${isSuperAdmin ? '' : 'AND po.region_id = $1'}
       ORDER BY po.created_at DESC LIMIT 20`,
      params
    )
  ]);

  res.json(buildAdminAlertsPayload({
    lowStockRows: lowStockRows.rows,
    pendingRequisitionRows: pendingRequisitionRows.rows,
    pendingPurchaseOrderRows: pendingPurchaseOrderRows.rows
  }));
});

module.exports = router;