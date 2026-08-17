const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRegionAdminOrAbove, canActOnRegion } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');

const router = express.Router();
router.use(authenticate);

function buildRequisitionListQuery(user, status) {
  let sql = `SELECT r.*,
                    COALESCE(r.quantity_fulfilled, 0) AS quantity_fulfilled,
                    r.oms_ticket_number AS oms_ticket_number,
                    r.oms_ticket_number AS oms_number,
                    m.name AS material_name, reg.name AS region_name, reg.name AS zone_name, s.name AS site_name, u.full_name AS requested_by_name
             FROM requisitions r
             JOIN materials m ON r.material_id = m.id
             JOIN regions reg ON r.region_id = reg.id
             JOIN sites s ON r.site_id = s.id
             JOIN users u ON r.requested_by = u.id
             WHERE 1=1`;
  const params = [];
  const userRegionId = (user.regionId || user.zoneId) ? Number(user.regionId || user.zoneId) : null;
  const userSiteId = user.siteId ? Number(user.siteId) : null;
  if (['region_admin', 'zone_admin'].includes(user.role)) {
    if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND r.region_id = $${params.length}`;
    }
  } else if (user.role === 'site_engineer') {
    if (userSiteId && !isNaN(userSiteId)) {
      params.push(userSiteId);
      sql += ` AND r.site_id = $${params.length}`;
    } else if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND r.region_id = $${params.length}`;
    }
  }
  const statusStr = (status && typeof status === 'string' && status.trim() && status !== 'all' && status !== 'undefined') ? status.trim() : null;
  if (statusStr) { params.push(statusStr); sql += ` AND r.status = $${params.length}`; }
  sql += ' ORDER BY r.created_at DESC';
  return { sql, params };
}

const getRequisitionsSchema = validate({
  query: {
    status: v.enum(['PENDING', 'PARTIAL', 'FULFILLED', 'APPROVED', 'REJECTED', 'CANCELLED'], { required: false })
  }
});

router.get('/', getRequisitionsSchema, async (req, res) => {
  const { sql, params } = buildRequisitionListQuery(req.user, req.query.status);
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

const createRequisitionSchema = validate({
  body: {
    oms_ticket_number: v.string({ min: 3, max: 100, required: false }),
    oms_number: v.string({ min: 3, max: 100, required: false }),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    site_id: v.integer({ positive: true, required: false }),
    material_id: v.integer({ positive: true, required: false }),
    quantity_requested: v.number({ positive: true, required: false }),
    items: v.array({ minLength: 0, maxLength: 50, required: false }),
    lines: v.array({ minLength: 0, maxLength: 50, required: false }),
    notes: v.string({ min: 0, max: 500, required: false }),
    remarks: v.string({ min: 0, max: 500, required: false })
  }
});

router.post('/', createRequisitionSchema, async (req, res) => {
  const { oms_ticket_number, oms_number, region_id, zone_id, site_id, material_id, quantity_requested, items, lines, notes, remarks } = req.body;
  const userRegionId = req.user.regionId || req.user.zoneId;
  const targetRegionId = region_id || zone_id || userRegionId;
  const targetSiteId = site_id || req.user.siteId;
  const ticketNumber = oms_ticket_number || oms_number;
  const reqNotes = notes || remarks || null;

  if (!ticketNumber || !targetRegionId || !targetSiteId) {
    return res.status(400).json({ error: 'oms_ticket_number, region_id, and site_id are required' });
  }

  if (req.user.role === 'site_engineer') {
    if (userRegionId && Number(userRegionId) !== Number(targetRegionId)) {
      return res.status(403).json({ error: 'You can only raise requisitions for your assigned region' });
    }
  } else if (!canActOnRegion(req.user, targetRegionId)) {
    return res.status(403).json({ error: 'You can only raise requisitions for your own region' });
  }

  const itemList = Array.isArray(items) && items.length > 0 ? items : (Array.isArray(lines) && lines.length > 0 ? lines : []);
  if (!itemList.length && material_id && quantity_requested) {
    itemList.push({ material_id, quantity_requested });
  }

  if (!itemList.length) {
    return res.status(400).json({ error: 'At least one material item and quantity is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const createdRows = [];
    for (const item of itemList) {
      const matId = item.material_id;
      const qty = parseFloat(item.quantity_requested || item.quantity || 0);
      const itemNote = item.notes || reqNotes;
      if (!matId || qty <= 0) continue;

      const { rows } = await client.query(
        `INSERT INTO requisitions (oms_ticket_number, region_id, site_id, material_id, quantity_requested, quantity_fulfilled, requested_by, notes)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7) RETURNING *, region_id AS zone_id, 0 AS quantity_fulfilled`,
        [ticketNumber, targetRegionId, targetSiteId, matId, qty, req.user.id, itemNote]
      );
      createdRows.push(rows[0]);
    }
    await client.query('COMMIT');
    res.status(201).json(createdRows.length === 1 ? createdRows[0] : { message: `${createdRows.length} material line items created for OMS Ticket ${ticketNumber}`, requisitions: createdRows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create requisition items' });
  } finally {
    client.release();
  }
});

const reqIdSchema = validate({
  params: {
    id: v.integer({ positive: true })
  }
});

router.patch('/:id/cancel', reqIdSchema, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM requisitions WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Requisition not found' });
  const reqRegionId = rows[0].region_id || rows[0].zone_id;
  if (req.user.id !== rows[0].requested_by && !canActOnRegion(req.user, reqRegionId)) {
    return res.status(403).json({ error: 'You do not have access to cancel this requisition' });
  }
  await pool.query("UPDATE requisitions SET status = 'CANCELLED' WHERE id = $1", [req.params.id]);
  res.json({ message: 'Requisition cancelled' });
});

const handleApproveRequisition = async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM requisitions WHERE id = $1', [req.params.id]);
  const reqRow = rows[0];
  if (!reqRow) return res.status(404).json({ error: 'Requisition not found' });
  const reqRegionId = reqRow.region_id || reqRow.zone_id;
  if (!canActOnRegion(req.user, reqRegionId)) {
    return res.status(403).json({ error: 'You do not have access to approve requisitions in this region' });
  }
  await pool.query("UPDATE requisitions SET status = 'APPROVED' WHERE id = $1", [req.params.id]);
  const { rows: updated } = await pool.query('SELECT *, region_id AS zone_id FROM requisitions WHERE id = $1', [req.params.id]);
  res.json(updated[0]);
};

router.patch('/:id/approve', requireRegionAdminOrAbove, reqIdSchema, handleApproveRequisition);

const rejectRequisitionSchema = validate({

  params: {
    id: v.integer({ positive: true })
  },
  body: {
    reason: v.string({ min: 0, max: 500, required: false })
  }
});

const handleRejectRequisition = async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM requisitions WHERE id = $1', [req.params.id]);
  const reqRow = rows[0];
  if (!reqRow) return res.status(404).json({ error: 'Requisition not found' });
  const reqRegionId = reqRow.region_id || reqRow.zone_id;
  if (!canActOnRegion(req.user, reqRegionId)) {
    return res.status(403).json({ error: 'You do not have access to reject requisitions in this region' });
  }
  const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.trim() : null;
  await pool.query("UPDATE requisitions SET status = 'REJECTED', reject_reason = $1 WHERE id = $2", [reason || null, req.params.id]);
  const { rows: updated } = await pool.query('SELECT *, region_id AS zone_id FROM requisitions WHERE id = $1', [req.params.id]);
  res.json(updated[0]);
};

router.patch('/:id/reject', requireRegionAdminOrAbove, rejectRequisitionSchema, handleRejectRequisition);

module.exports = router;
