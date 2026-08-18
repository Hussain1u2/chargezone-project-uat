const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../config/db');
const { authenticate, requireRegionAdminOrAbove, canActOnRegion } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');
const { canManagePO, createFromUpload, createManual, confirmPurchaseOrder, autoResolveMaterial } = require('../services/purchaseOrderService');
const { handleRouteError } = require('../utils/errorHandler');

const router = express.Router();
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const isPdfExt = path.extname(file.originalname || '').toLowerCase() === '.pdf';
    const isPdfMime = !file.mimetype || file.mimetype.includes('pdf') || file.mimetype === 'application/octet-stream';
    if (isPdfExt && isPdfMime) {
      cb(null, true);
    } else {
      cb(new Error('Only valid PDF documents (.pdf) are accepted'));
    }
  },
  limits: { fileSize: 15 * 1024 * 1024 }
});

async function loadPOOrFail(req, res) {
  const { rows } = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
  const po = rows[0];
  if (!po) {
    res.status(404).json({ error: 'Purchase order not found' });
    return null;
  }
  if (!canManagePO(req.user, po)) {
    res.status(403).json({ error: 'You do not have permission to modify this purchase order' });
    return null;
  }
  return po;
}

router.get('/', async (req, res) => {
  let sql = `SELECT po.*, po.region_id AS zone_id, r.name AS region_name, r.name AS zone_name, u.full_name AS uploaded_by_name
             FROM purchase_orders po
             LEFT JOIN regions r ON po.region_id = r.id
             LEFT JOIN users u ON po.uploaded_by = u.id`;
  const params = [];
  const userRegionId = (req.user.regionId || req.user.zoneId) ? Number(req.user.regionId || req.user.zoneId) : null;
  if (req.user.role !== 'super_admin' && userRegionId && !isNaN(userRegionId)) {
    sql += " WHERE po.region_id = $1 OR po.destination_type = 'HO'";
    params.push(userRegionId);
  }
  sql += ' ORDER BY po.created_at DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

const poIdSchema = validate({
  params: {
    id: v.integer({ positive: true })
  }
});

router.get('/:id', poIdSchema, async (req, res) => {
  const { rows: poRows } = await pool.query(
    'SELECT po.*, po.region_id AS zone_id, r.name AS region_name, r.name AS zone_name FROM purchase_orders po LEFT JOIN regions r ON po.region_id = r.id WHERE po.id = $1',
    [req.params.id]
  );
  const po = poRows[0];
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  const poRegionId = po.region_id || po.zone_id;
  if (['REGION', 'ZONE'].includes(po.destination_type) && !canActOnRegion(req.user, poRegionId)) {
    return res.status(403).json({ error: 'You do not have access to this purchase order' });
  }

  const { rows: unmapped } = await pool.query('SELECT * FROM po_items WHERE po_id = $1 AND material_id IS NULL', [req.params.id]);

  for (const item of unmapped) {
    const matId = await autoResolveMaterial(pool, item.material_name_raw);
    await pool.query('UPDATE po_items SET material_id = $1 WHERE id = $2', [matId, item.id]);
  }

  const { rows: items } = await pool.query(
    `SELECT poi.*, m.name AS matched_material_name
     FROM po_items poi LEFT JOIN materials m ON poi.material_id = m.id WHERE poi.po_id = $1`,
    [req.params.id]
  );

  const { rows: generated_barcodes } = await pool.query(
    `SELECT i.id, i.barcode_value, i.status, i.material_id, m.name AS material_name, poi.id AS po_item_id, poi.material_name_raw
     FROM items i
     JOIN materials m ON i.material_id = m.id
     JOIN po_items poi ON i.po_item_id = poi.id
     WHERE poi.po_id = $1
     ORDER BY i.id ASC`,
    [req.params.id]
  );

  res.json({ ...po, items, generated_barcodes });
});

router.post('/upload', requireRegionAdminOrAbove, (req, res, next) => {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload PDF file' });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'A valid PDF file is required (field name: pdf)' });

  if (req.file.size > 15 * 1024 * 1024) {
    return res.status(400).json({ error: 'Uploaded file size exceeds the 15MB maximum limit' });
  }

  const magicHeader = req.file.buffer.slice(0, 5).toString('ascii');
  if (magicHeader !== '%PDF-') {
    return res.status(400).json({ error: 'Invalid file content. Uploaded file is not a genuine PDF document.' });
  }


  const { destination_type, region_id, zone_id, ocrText } = req.body;
  const userRegionId = req.user.regionId || req.user.zoneId;
  const targetRegionId = region_id || zone_id || (req.user.role !== 'super_admin' ? userRegionId : null);
  const destType = (req.user.role !== 'super_admin' || destination_type === 'ZONE' || destination_type === 'REGION') ? 'REGION' : 'HO';

  if (destType === 'REGION' && !targetRegionId) {
    return res.status(400).json({ error: 'Please select a region for stock upload' });
  }

  if (destType === 'REGION' && !canActOnRegion(req.user, targetRegionId)) {
    return res.status(403).json({ error: 'You do not have permission to upload purchase orders for this region' });
  }

  try {
    const { poId, note, raw_text } = await createFromUpload(req.user, req.file, destType, targetRegionId, null, ocrText);
    const { rows: poRows } = await pool.query('SELECT *, region_id AS zone_id FROM purchase_orders WHERE id = $1', [poId]);
    const { rows: items } = await pool.query('SELECT * FROM po_items WHERE po_id = $1', [poId]);
    res.status(201).json({ ...poRows[0], items, extraction_note: note });
  } catch (err) {
    handleRouteError(res, err, 500);
  }
});

const manualPOSchema = validate({
  body: {
    po_number: v.string({ min: 3, max: 100 }),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    notes: v.string({ min: 1, max: 500 }),
    items: v.array({ minLength: 1, maxLength: 100 })
  }
});

const handleManualPO = async (req, res) => {
  const { po_number, region_id, zone_id, notes, items } = req.body;
  const targetRegionId = region_id || zone_id;
  if (!targetRegionId) {
    return res.status(400).json({ error: 'region_id is required' });
  }
  if (!canActOnRegion(req.user, targetRegionId)) {
    return res.status(403).json({ error: 'You can only create manual purchases for your own region' });
  }

  try {
    const poId = await createManual(req.user, po_number, targetRegionId, notes.trim(), items);
    const { rows: poRows } = await pool.query('SELECT *, region_id AS zone_id FROM purchase_orders WHERE id = $1', [poId]);
    const { rows: itemRows } = await pool.query('SELECT * FROM po_items WHERE po_id = $1', [poId]);
    res.status(201).json({ ...poRows[0], items: itemRows });
  } catch (err) {
    handleRouteError(res, err, 500);
  }
};

router.post('/manual', requireRegionAdminOrAbove, manualPOSchema, handleManualPO);

const addPOItemSchema = validate({
  params: {
    id: v.integer({ positive: true })
  },
  body: {
    material_name_raw: v.string({ min: 1, max: 255 }),
    quantity: v.number({ positive: true }),
    unit_price: v.number({ min: 0, required: false }),
    material_id: v.integer({ positive: true, required: false })
  }
});

router.post('/:id/items', addPOItemSchema, async (req, res) => {
  const po = await loadPOOrFail(req, res);
  if (!po) return;

  let { material_name_raw, quantity, unit_price, material_id } = req.body;
  const resolvedMatId = material_id || await autoResolveMaterial(pool, material_name_raw);

  const { rows } = await pool.query(
    `INSERT INTO po_items (po_id, material_id, material_name_raw, quantity, unit_price)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [po.id, resolvedMatId, material_name_raw, quantity, unit_price || 0]
  );
  res.status(201).json(rows[0]);
});

const updatePOItemSchema = validate({
  params: {
    id: v.integer({ positive: true }),
    itemId: v.integer({ positive: true })
  },
  body: {
    material_name_raw: v.string({ min: 1, max: 255, required: false }),
    quantity: v.number({ positive: true, required: false }),
    unit_price: v.number({ min: 0, required: false }),
    material_id: v.integer({ positive: true, required: false })
  }
});

router.put('/:id/items/:itemId', updatePOItemSchema, async (req, res) => {
  const po = await loadPOOrFail(req, res);
  if (!po) return;

  const { material_name_raw, quantity, unit_price, material_id } = req.body;
  const { rows } = await pool.query(
    `UPDATE po_items
     SET material_name_raw = COALESCE($1, material_name_raw),
         quantity          = COALESCE($2, quantity),
         unit_price        = COALESCE($3, unit_price),
         material_id       = $4
     WHERE id = $5 AND po_id = $6 RETURNING *`,
    [material_name_raw, quantity, unit_price, material_id || null, req.params.itemId, po.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
  res.json(rows[0]);
});

const deletePOItemSchema = validate({
  params: {
    id: v.integer({ positive: true }),
    itemId: v.integer({ positive: true })
  }
});

router.delete('/:id/items/:itemId', deletePOItemSchema, async (req, res) => {
  const po = await loadPOOrFail(req, res);
  if (!po) return;

  await pool.query('DELETE FROM po_items WHERE id = $1 AND po_id = $2', [req.params.itemId, po.id]);
  res.status(204).send();
});

const matchPOItemSchema = validate({
  params: {
    id: v.integer({ positive: true }),
    itemId: v.integer({ positive: true })
  },
  body: {
    material_id: v.integer({ positive: true })
  }
});

router.post('/:id/items/:itemId/match', matchPOItemSchema, async (req, res) => {
  const po = await loadPOOrFail(req, res);
  if (!po) return;

  const { material_id } = req.body;
  const { rows: matRows } = await pool.query('SELECT id FROM materials WHERE id = $1', [material_id]);
  if (!matRows[0]) return res.status(404).json({ error: 'Material master not found' });

  const { rows } = await pool.query(
    'UPDATE po_items SET material_id = $1 WHERE id = $2 AND po_id = $3 RETURNING *',
    [material_id, req.params.itemId, po.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'PO line item not found' });
  res.json(rows[0]);
});

router.post('/:id/confirm', poIdSchema, async (req, res) => {
  try {
    const serialsByItemId = req.body?.serials || req.body?.serialsByItemId || req.body?.serials_by_item || {};
    const updatedPO = await confirmPurchaseOrder(req.user, req.params.id, serialsByItemId);
    res.json(updatedPO);
  } catch (err) {
    handleRouteError(res, err, 500);
  }
});

router.post('/:id/approve', requireRegionAdminOrAbove, poIdSchema, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
  const po = rows[0];
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  const poRegionId = po.region_id || po.zone_id;
  if (['REGION', 'ZONE'].includes(po.destination_type) && !canActOnRegion(req.user, poRegionId)) {
    return res.status(403).json({ error: 'You do not have permission to approve this purchase order' });
  }

  const { rows: updated } = await pool.query(
    "UPDATE purchase_orders SET status = 'APPROVED' WHERE id = $1 RETURNING *, region_id AS zone_id",
    [req.params.id]
  );
  res.json(updated[0]);
});

const rejectPOSchema = validate({
  params: {
    id: v.integer({ positive: true })
  },
  body: {
    reason: v.string({ min: 0, max: 500, required: false }),
    reject_reason: v.string({ min: 0, max: 500, required: false })
  }
});

router.post('/:id/reject', requireRegionAdminOrAbove, rejectPOSchema, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
  const po = rows[0];
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  const poRegionId = po.region_id || po.zone_id;
  if (['REGION', 'ZONE'].includes(po.destination_type) && !canActOnRegion(req.user, poRegionId)) {
    return res.status(403).json({ error: 'You do not have permission to reject this purchase order' });
  }

  const reason = req.body?.reason || req.body?.reject_reason || null;
  const { rows: updated } = await pool.query(
    "UPDATE purchase_orders SET status = 'REJECTED', reject_reason = $1 WHERE id = $2 RETURNING *, region_id AS zone_id",
    [reason, req.params.id]
  );
  res.json(updated[0]);
});

module.exports = router;
