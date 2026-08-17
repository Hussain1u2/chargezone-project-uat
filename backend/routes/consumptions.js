const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');
const { recordConsumption } = require('../services/consumptionService');
const { handleRouteError } = require('../utils/errorHandler');

const router = express.Router();
router.use(authenticate);

function buildConsumptionListQuery(user) {
  let sql = `SELECT c.*, m.name AS material_name, r.name AS region_name, r.name AS zone_name, s.name AS site_name, u.full_name AS created_by_name
             FROM consumptions c
             JOIN materials m ON c.material_id = m.id
             JOIN regions r ON c.region_id = r.id
             JOIN sites s ON c.site_id = s.id
             JOIN users u ON c.created_by = u.id
             WHERE 1=1`;
  const params = [];
  const userRegionId = (user.regionId || user.zoneId) ? Number(user.regionId || user.zoneId) : null;
  const userSiteId = user.siteId ? Number(user.siteId) : null;

  if (['region_admin', 'zone_admin'].includes(user.role)) {
    if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND c.region_id = $${params.length}`;
    }
  } else if (user.role === 'site_engineer') {
    if (userSiteId && !isNaN(userSiteId)) {
      params.push(userSiteId);
      sql += ` AND c.site_id = $${params.length}`;
    } else if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND c.region_id = $${params.length}`;
    }
  }
  sql += ' ORDER BY c.created_at DESC';
  return { sql, params };
}

router.get('/', async (req, res) => {
  const { sql, params } = buildConsumptionListQuery(req.user);
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

const createConsumptionSchema = validate({
  body: {
    site_id: v.integer({ positive: true, required: false }),
    material_id: v.integer({ positive: true, required: false }),
    quantity: v.number({ positive: true, required: false }),
    item_barcode_value: v.string({ min: 0, max: 100, required: false }),
    item_serial_number: v.string({ min: 0, max: 100, required: false }),
    items: v.array({ minLength: 0, maxLength: 50, required: false }),
    lines: v.array({ minLength: 0, maxLength: 50, required: false }),
    notes: v.string({ min: 0, max: 500, required: false })
  }
});

router.post('/', createConsumptionSchema, async (req, res) => {
  const region_id = req.body.region_id || req.body.zone_id || req.user.regionId || req.user.zoneId;
  const site_id = req.body.site_id || req.user.siteId;
  const material_id = req.body.material_id;
  const barcode_val = req.body.item_barcode_value || req.body.item_serial_number;
  const items = req.body.items || req.body.lines;

  const itemList = Array.isArray(items) && items.length > 0 ? items : [];
  if (!itemList.length && !material_id && !barcode_val) {
    return res.status(400).json({ error: 'material_id, items array, or item barcode is required' });
  }
  if (!site_id) {
    return res.status(400).json({ error: 'site_id is required' });
  }

  req.body.region_id = region_id;
  req.body.zone_id = region_id;
  req.body.site_id = site_id;

  try {
    const consumption = await recordConsumption(req.user, req.body);
    res.status(201).json(consumption);
  } catch (err) {
    handleRouteError(res, err, 400);
  }
});

module.exports = router;
