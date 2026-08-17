const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');
const { recordReplacement, markRepaired, approveScrap, rejectScrap } = require('../services/replacementService');
const { handleRouteError } = require('../utils/errorHandler');

const router = express.Router();
router.use(authenticate);

function buildReplacementListQuery(user) {
  let sql = `SELECT rp.*, om.name AS old_material_name, nm.name AS new_material_name,
                    oi.barcode_value AS old_barcode_value, ni.barcode_value AS new_barcode_value,
                    oi.barcode_value AS old_serial, ni.barcode_value AS new_serial,
                    r.name AS region_name, s.name AS site_name, u.full_name AS created_by_name
             FROM replacements rp
             JOIN materials om ON rp.old_material_id = om.id
             JOIN materials nm ON rp.new_material_id = nm.id
             LEFT JOIN items oi ON rp.old_item_id = oi.id
             LEFT JOIN items ni ON rp.new_item_id = ni.id
             JOIN regions r ON rp.region_id = r.id
             JOIN sites s ON rp.site_id = s.id
             JOIN users u ON rp.created_by = u.id
             WHERE 1=1`;
  const params = [];
  const userRegionId = (user.regionId || user.zoneId) ? Number(user.regionId || user.zoneId) : null;
  const userSiteId = user.siteId ? Number(user.siteId) : null;

  if (['region_admin', 'zone_admin'].includes(user.role)) {
    if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND rp.region_id = $${params.length}`;
    }
  } else if (user.role === 'site_engineer') {
    if (userSiteId && !isNaN(userSiteId)) {
      params.push(userSiteId);
      sql += ` AND rp.site_id = $${params.length}`;
    } else if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND rp.region_id = $${params.length}`;
    }
  }
  sql += ' ORDER BY rp.created_at DESC';
  return { sql, params };
}

router.get('/', async (req, res) => {
  const { sql, params } = buildReplacementListQuery(req.user);
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

const createReplacementSchema = validate({
  body: {
    site_id: v.integer({ positive: true, required: false }),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    installed_material_id: v.integer({ positive: true, required: false }),
    removed_material_id: v.integer({ positive: true, required: false }),
    removed_barcode_value: v.string({ min: 0, max: 100, required: false }),
    new_barcode_value: v.string({ min: 0, max: 100, required: false }),
    disposition: v.enum(['REPAIRABLE', 'SCRAP', 'MISSING_NOT_FOUND', 'MISSING', 'PHYSICALLY_DAMAGED', 'WARRANTY_RETURN', 'REPAIRED_IN_STOCK', 'SCRAP_PENDING_APPROVAL', 'SCRAP_REJECTED']),
    notes: v.string({ min: 0, max: 500, required: false })
  }
});

router.post('/', createReplacementSchema, async (req, res) => {
  const site_id = req.body.site_id || req.user.siteId;
  const region_id = req.body.region_id || req.body.zone_id || req.user.regionId || req.user.zoneId;
  const disposition = req.body.disposition;

  if (!site_id) {
    return res.status(400).json({ error: 'site_id is required' });
  }

  req.body.site_id = site_id;
  req.body.region_id = region_id;
  req.body.zone_id = region_id;

  try {
    const replacement = await recordReplacement(req.user, req.body);
    res.status(201).json(replacement);
  } catch (err) {
    handleRouteError(res, err, 400);
  }
});

const markRepairedSchema = validate({
  params: {
    id: v.integer({ positive: true })
  },
  body: {
    destination_type: v.enum(['HO', 'REGION', 'ZONE'], { required: false }),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    notes: v.string({ min: 0, max: 500, required: false })
  }
});

router.post('/:id/mark-repaired', markRepairedSchema, async (req, res) => {
  try {
    const result = await markRepaired(req.user, {
      replacement_id: req.params.id,
      destination_type: req.body.destination_type || 'REGION',
      region_id: req.body.region_id || undefined,
      zone_id: req.body.zone_id || undefined,
      notes: req.body.notes || undefined
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err, 400);
  }
});

const approveScrapSchema = validate({
  params: {
    id: v.integer({ positive: true })
  },
  body: {
    e_waste: v.boolean({ required: false })
  }
});

router.patch('/:id/approve-scrap', approveScrapSchema, async (req, res) => {
  try {
    const result = await approveScrap(req.user, req.params.id, req.body.e_waste);
    res.json(result);
  } catch (err) {
    handleRouteError(res, err, 400);
  }
});

const rejectScrapSchema = validate({
  params: {
    id: v.integer({ positive: true })
  },
  body: {
    reason: v.string({ min: 0, max: 500, required: false })
  }
});

router.patch('/:id/reject-scrap', rejectScrapSchema, async (req, res) => {
  try {
    const result = await rejectScrap(req.user, req.params.id, req.body.reason);
    res.json(result);
  } catch (err) {
    handleRouteError(res, err, 400);
  }
});

module.exports = router;
