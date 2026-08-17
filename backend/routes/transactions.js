const express = require('express');
const pool = require('../config/db');
const { authenticate, requireSuperAdmin, requireRegionAdminOrAbove, requireZoneAdminOrAbove, canActOnRegion } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');
const { dispatchToRegion, receiveInRegion, dispatchToSite, receiveAtSite, dispatchRegionToRegion, returnStock } = require('../services/stockMovementService');

const { handleRouteError } = require('../utils/errorHandler');

const router = express.Router();
router.use(authenticate);

function buildTransactionListQuery(user, materialId, type, search) {
  let sql = `SELECT t.*, m.name AS material_name, i.barcode_value, i.barcode_value AS serial_number,
                    fr.name AS from_region_name, tr.name AS to_region_name,
                    fr.name AS from_zone_name, tr.name AS to_zone_name,
                    fs.name AS from_site_name, ts.name AS to_site_name,
                    u.full_name AS created_by_name, u.role AS created_by_role,
                    COALESCE(
                      r.oms_ticket_number,
                      substring(t.notes from '\\[OMS Ticket:\\s*([^\\]]+)\\]'),
                      substring(t.notes from 'OMS Ticket:\\s*([^\\s\\]]+)')
                    ) AS oms_ticket_number,
                    COALESCE(
                      r.oms_ticket_number,
                      substring(t.notes from '\\[OMS Ticket:\\s*([^\\]]+)\\]'),
                      substring(t.notes from 'OMS Ticket:\\s*([^\\s\\]]+)')
                    ) AS oms_number,
                    po.po_number,
                    COALESCE(
                      CASE WHEN u.role::text IN ('super_admin', 'region_admin', 'zone_admin') THEN u.full_name END,
                      (SELECT full_name FROM users WHERE id = r.requested_by AND role::text IN ('super_admin', 'region_admin', 'zone_admin')),
                      (SELECT full_name FROM users WHERE id = po.uploaded_by),
                      (SELECT full_name FROM users WHERE role::text IN ('region_admin', 'zone_admin') AND region_id = COALESCE(t.to_region_id, t.from_region_id) AND is_active = true ORDER BY id ASC LIMIT 1),
                      (SELECT full_name FROM users WHERE role = 'super_admin' AND is_active = true ORDER BY id ASC LIMIT 1),
                      'N/A'
                    ) AS admin_name,
                    COALESCE(
                      CASE WHEN u.role::text = 'site_engineer' THEN u.full_name END,
                      (SELECT full_name FROM users WHERE id = r.requested_by AND role::text = 'site_engineer'),
                      (SELECT full_name FROM users WHERE role::text = 'site_engineer' AND site_id = COALESCE(t.to_site_id, t.from_site_id) AND is_active = true ORDER BY id ASC LIMIT 1),
                      (SELECT full_name FROM users WHERE role::text = 'site_engineer' AND region_id = COALESCE(t.to_region_id, t.from_region_id) AND is_active = true ORDER BY id ASC LIMIT 1),
                      'N/A'
                    ) AS site_engineer_name
             FROM transactions t
             JOIN materials m ON t.material_id = m.id
             LEFT JOIN items i ON t.item_id = i.id
             LEFT JOIN regions fr ON t.from_region_id = fr.id
             LEFT JOIN regions tr ON t.to_region_id = tr.id
             LEFT JOIN sites fs ON t.from_site_id = fs.id
             LEFT JOIN sites ts ON t.to_site_id = ts.id
             LEFT JOIN users u ON t.created_by = u.id
             LEFT JOIN requisitions r ON t.reference_requisition_id = r.id
             LEFT JOIN purchase_orders po ON t.reference_po_id = po.id
             WHERE 1=1`;
  const params = [];

  const userRegionId = (user.regionId || user.zoneId) ? Number(user.regionId || user.zoneId) : null;
  const userSiteId = user.siteId ? Number(user.siteId) : null;

  if (['region_admin', 'zone_admin'].includes(user.role)) {
    if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND (t.from_region_id = $${params.length} OR t.to_region_id = $${params.length} OR fs.region_id = $${params.length} OR ts.region_id = $${params.length})`;
    }
  } else if (user.role === 'site_engineer') {
    if (userSiteId && !isNaN(userSiteId)) {
      params.push(userSiteId);
      sql += ` AND (t.from_site_id = $${params.length} OR t.to_site_id = $${params.length})`;
    } else if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND (t.from_region_id = $${params.length} OR t.to_region_id = $${params.length})`;
    }
  }

  const validMatId = (materialId && materialId !== 'all' && materialId !== 'undefined' && !isNaN(Number(materialId)) && Number(materialId) > 0) ? Number(materialId) : null;
  if (validMatId) {
    params.push(validMatId);
    sql += ` AND t.material_id = $${params.length}`;
  }

  const typeStr = (type && typeof type === 'string' && type.trim() && type !== 'all' && type !== 'undefined') ? type.trim() : null;
  if (typeStr) {
    params.push(typeStr);
    sql += ` AND t.transaction_type::text = $${params.length}`;
  }

  const searchStr = (search && typeof search === 'string' && search.trim() && search.trim() !== 'undefined' && search.trim() !== 'null') ? search.trim() : null;
  if (searchStr) {
    params.push(`%${searchStr}%`);
    sql += ` AND (
      m.name ILIKE $${params.length} OR
      i.barcode_value ILIKE $${params.length} OR
      r.oms_ticket_number ILIKE $${params.length} OR
      po.po_number ILIKE $${params.length} OR
      t.notes ILIKE $${params.length} OR
      fr.name ILIKE $${params.length} OR
      tr.name ILIKE $${params.length} OR
      fs.name ILIKE $${params.length} OR
      ts.name ILIKE $${params.length} OR
      u.full_name ILIKE $${params.length}
    )`;
  }
  sql += ' ORDER BY t.created_at DESC LIMIT 500';
  return { sql, params };
}

const getTransactionsSchema = validate({
  query: {
    materialId: v.string({ min: 0, max: 50, required: false }),
    type: v.string({ min: 0, max: 50, required: false }),
    search: v.string({ min: 0, max: 100, required: false }),
    oms_ticket_number: v.string({ min: 0, max: 100, required: false }),
    oms_number: v.string({ min: 0, max: 100, required: false }),
    q: v.string({ min: 0, max: 100, required: false })
  }
});

router.get('/', getTransactionsSchema, async (req, res) => {
  const searchQuery = req.query.search || req.query.oms_ticket_number || req.query.oms_number || req.query.q;
  const { sql, params } = buildTransactionListQuery(req.user, req.query.materialId, req.query.type, searchQuery);
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

const dispatchRegionSchema = validate({
  body: {
    material_id: v.integer({ positive: true, required: false }),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    quantity: v.number({ positive: true, required: false }),
    barcode_values: v.array({ minLength: 0, maxLength: 500, required: false }),
    serial_numbers: v.array({ minLength: 0, maxLength: 500, required: false }),
    notes: v.string({ min: 0, max: 500, required: false }),
    lines: v.array({ minLength: 0, maxLength: 50, required: false }),
    items: v.array({ minLength: 0, maxLength: 50, required: false })
  }
});

const handleDispatchToRegion = async (req, res) => {
  const { material_id, region_id, zone_id, quantity, barcode_values, serial_numbers, notes, lines, items } = req.body;
  const targetRegionId = region_id || zone_id;
  const itemList = Array.isArray(lines) && lines.length > 0 ? lines : (Array.isArray(items) && items.length > 0 ? items : []);
  if (!targetRegionId) return res.status(400).json({ error: 'region_id is required' });
  if (!itemList.length && !material_id) return res.status(400).json({ error: 'material_id or items array is required' });
  const codes = barcode_values || serial_numbers;

  try {
    await dispatchToRegion({ materialId: material_id, regionId: targetRegionId, quantity, barcodeValues: codes, notes, userId: req.user.id, lines: itemList });
    res.status(201).json({ message: 'Dispatch recorded' });
  } catch (err) {
    handleRouteError(res, err, 400);
  }
};

router.post('/dispatch-to-region', requireSuperAdmin, dispatchRegionSchema, handleDispatchToRegion);
router.post('/dispatch-to-zone', requireSuperAdmin, dispatchRegionSchema, handleDispatchToRegion);

const receiveRegionSchema = validate({
  body: {
    material_id: v.integer({ positive: true, required: false }),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    site_id: v.integer({ positive: true, required: false }),
    quantity: v.number({ positive: true, required: false }),
    barcode_values: v.array({ minLength: 0, maxLength: 500, required: false }),
    serial_numbers: v.array({ minLength: 0, maxLength: 500, required: false }),
    notes: v.string({ min: 0, max: 500, required: false }),
    lines: v.array({ minLength: 0, maxLength: 50, required: false }),
    items: v.array({ minLength: 0, maxLength: 50, required: false })
  }
});

const handleReceiveInRegion = async (req, res) => {
  const { barcode_values, serial_numbers, material_id, region_id, zone_id, site_id, quantity, notes, lines, items } = req.body;
  const codes = barcode_values || serial_numbers;
  const itemList = Array.isArray(lines) && lines.length > 0 ? lines : (Array.isArray(items) && items.length > 0 ? items : []);
  try {
    const total = await receiveInRegion(req.user, {
      barcodeValues: Array.isArray(codes) && codes.length > 0 ? codes : undefined,
      materialId: material_id || undefined,
      regionId: region_id || zone_id || undefined,
      siteId: site_id || undefined,
      quantity: parseFloat(quantity || 0) || 0,
      notes: notes || undefined,
      lines: itemList
    });
    res.json({ message: `Receipt confirmed in region (${total} items/units received)` });
  } catch (err) {
    handleRouteError(res, err, 400);
  }
};

router.post('/receive-in-region', requireRegionAdminOrAbove, receiveRegionSchema, handleReceiveInRegion);
router.post('/receive-in-zone', requireZoneAdminOrAbove, receiveRegionSchema, handleReceiveInRegion);

const dispatchSiteSchema = validate({
  body: {
    material_id: v.integer({ positive: true }),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    site_id: v.integer({ positive: true, required: false }),
    quantity: v.number({ positive: true, required: false }),
    barcode_values: v.array({ minLength: 0, maxLength: 500, required: false }),
    serial_numbers: v.array({ minLength: 0, maxLength: 500, required: false }),
    requisition_id: v.integer({ positive: true, required: false }),
    notes: v.string({ min: 0, max: 500, required: false })
  }
});

router.post('/dispatch-to-site', requireRegionAdminOrAbove, dispatchSiteSchema, async (req, res) => {
  const { material_id, region_id, zone_id, site_id, quantity, barcode_values, serial_numbers, requisition_id, notes } = req.body;
  const targetRegionId = region_id || zone_id;
  if (!targetRegionId) {
    return res.status(400).json({ error: 'region_id is required' });
  }
  if (!canActOnRegion(req.user, targetRegionId)) {
    return res.status(403).json({ error: 'You can only dispatch material from your own region' });
  }
  const codes = barcode_values || serial_numbers;
  try {
    await dispatchToSite({
      materialId: material_id, regionId: targetRegionId, siteId: site_id || null, quantity,
      barcodeValues: codes, requisitionId: requisition_id, notes, userId: req.user.id
    });
    res.status(201).json({ message: 'Dispatch to engineer recorded' });
  } catch (err) {
    handleRouteError(res, err, 400);
  }
});

const receiveSiteSchema = validate({
  body: {
    barcode_values: v.array({ minLength: 1, maxLength: 500, required: false }),
    serial_numbers: v.array({ minLength: 1, maxLength: 500, required: false })
  }
});

router.post('/receive-at-site', receiveSiteSchema, async (req, res) => {
  const { barcode_values, serial_numbers } = req.body;
  const codes = barcode_values || serial_numbers;
  if (!Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: 'barcode_values array is required' });
  }
  try {
    await receiveAtSite(req.user, codes);
    res.json({ message: 'Receipt at site confirmed' });
  } catch (err) {
    handleRouteError(res, err, 400);
  }
});

const interRegionDispatchSchema = validate({
  body: {
    material_id: v.integer({ positive: true, required: false }),
    from_region_id: v.integer({ positive: true, required: false }),
    from_zone_id: v.integer({ positive: true, required: false }),
    to_region_id: v.integer({ positive: true, required: false }),
    to_zone_id: v.integer({ positive: true, required: false }),
    quantity: v.number({ positive: true, required: false }),
    barcode_values: v.array({ minLength: 0, maxLength: 500, required: false }),
    serial_numbers: v.array({ minLength: 0, maxLength: 500, required: false }),
    notes: v.string({ min: 0, max: 500, required: false }),
    lines: v.array({ minLength: 0, maxLength: 50, required: false }),
    items: v.array({ minLength: 0, maxLength: 50, required: false })
  }
});

const handleRegionToRegionDispatch = async (req, res) => {
  const { material_id, from_region_id, to_region_id, from_zone_id, to_zone_id, from_site_id, to_site_id, quantity, barcode_values, serial_numbers, notes, lines, items } = req.body;
  const codes = barcode_values || serial_numbers;
  const itemList = Array.isArray(lines) && lines.length > 0 ? lines : (Array.isArray(items) && items.length > 0 ? items : []);
  try {
    await dispatchRegionToRegion(req.user, {
      materialId: material_id,
      fromRegionId: from_region_id || from_zone_id,
      fromSiteId: from_site_id || undefined,
      toRegionId: to_region_id || to_zone_id,
      toSiteId: to_site_id || undefined,
      quantity: parseFloat(quantity || 0) || undefined,
      barcodeValues: Array.isArray(codes) && codes.length > 0 ? codes : undefined,
      notes: notes || undefined,
      lines: itemList
    });
    res.status(201).json({ message: 'Region to region dispatch recorded successfully' });
  } catch (err) {
    handleRouteError(res, err, 400);
  }
};

router.post('/dispatch-region-to-region', requireRegionAdminOrAbove, interRegionDispatchSchema, handleRegionToRegionDispatch);
router.post('/dispatch-zone-to-zone', requireZoneAdminOrAbove, interRegionDispatchSchema, handleRegionToRegionDispatch);

const returnStockSchema = validate({
  body: {
    return_type: v.string({ min: 1, max: 50, required: false }),
    material_id: v.integer({ positive: true, required: false }),
    region_id: v.integer({ positive: true, required: false }),
    from_region_id: v.integer({ positive: true, required: false }),
    from_zone_id: v.integer({ positive: true, required: false }),
    from_site_id: v.integer({ positive: true, required: false }),
    to_region_id: v.integer({ positive: true, required: false }),
    to_zone_id: v.integer({ positive: true, required: false }),
    to_site_id: v.integer({ positive: true, required: false }),
    quantity: v.number({ positive: true, required: false }),
    barcode_values: v.array({ minLength: 0, maxLength: 500, required: false }),
    serial_numbers: v.array({ minLength: 0, maxLength: 500, required: false }),
    notes: v.string({ min: 0, max: 500, required: false }),
    lines: v.array({ minLength: 0, maxLength: 50, required: false }),
    items: v.array({ minLength: 0, maxLength: 50, required: false })
  }
});

router.post('/return-stock', returnStockSchema, async (req, res) => {
  const { return_type, material_id, region_id, from_region_id, zone_id, from_zone_id, from_site_id, to_region_id, to_zone_id, to_site_id, quantity, barcode_values, serial_numbers, notes, lines, items } = req.body;
  const codes = barcode_values || serial_numbers;
  const itemList = Array.isArray(lines) && lines.length > 0 ? lines : (Array.isArray(items) && items.length > 0 ? items : []);
  try {
    await returnStock(req.user, {
      returnType: return_type,
      materialId: material_id,
      fromRegionId: from_region_id || region_id || from_zone_id || zone_id,
      fromSiteId: from_site_id || undefined,
      toRegionId: to_region_id || to_zone_id || undefined,
      toSiteId: to_site_id || undefined,
      quantity: parseFloat(quantity || 0) || undefined,
      barcodeValues: Array.isArray(codes) && codes.length > 0 ? codes : undefined,
      notes: notes || undefined,
      lines: itemList
    });
    res.status(201).json({ message: 'Stock return (reverse flow) recorded successfully' });
  } catch (err) {
    handleRouteError(res, err, 400);
  }
});

module.exports = router;
