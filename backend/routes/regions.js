const express = require('express');
const pool = require('../config/db');
const { authenticate, requireSuperAdmin, requireRegionAdminOrAbove, canActOnRegion } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {

  if (req.user.role === 'super_admin') {
    const { rows } = await pool.query('SELECT *, id AS zone_id FROM regions ORDER BY is_ho DESC, name');
    return res.json(rows);
  }
  const userRegionId = req.user.regionId || req.user.zoneId;
  const { rows } = await pool.query('SELECT *, id AS zone_id FROM regions WHERE id = $1', [userRegionId]);
  res.json(rows);
});

const createRegionSchema = validate({
  body: {
    name: v.string({ min: 2, max: 100 }),
    code: v.string({ min: 2, max: 20, format: 'code' }),
    is_ho: v.boolean({ required: false })
  }
});

router.post('/', requireSuperAdmin, createRegionSchema, async (req, res) => {
  const { name, code, is_ho } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO regions (name, code, is_ho) VALUES ($1, $2, $3) RETURNING *, id AS zone_id',
    [name, code, !!is_ho]
  );
  res.status(201).json(rows[0]);
});

const updateRegionSchema = validate({
  params: {
    regionId: v.integer({ positive: true })
  },
  body: {
    name: v.string({ min: 2, max: 100 }),
    code: v.string({ min: 2, max: 20, format: 'code' }),
    is_ho: v.boolean({ required: false })
  }
});

router.put('/:regionId', requireSuperAdmin, updateRegionSchema, async (req, res) => {
  const { name, code, is_ho } = req.body;
  const { rows } = await pool.query(
    'UPDATE regions SET name = $1, code = $2, is_ho = $3 WHERE id = $4 RETURNING *, id AS zone_id',
    [name, code, !!is_ho, req.params.regionId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Region not found' });
  res.json(rows[0]);
});

const deleteRegionSchema = validate({
  params: {
    regionId: v.integer({ positive: true })
  }
});

router.delete('/:regionId', requireSuperAdmin, deleteRegionSchema, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM regions WHERE id = $1', [req.params.regionId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Region not found' });
    res.status(204).send();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Cannot delete region: It has active sites, users, or inventory associated with it.' });
    }
    throw err;
  }
});

const getSitesSchema = validate({

  params: {
    regionId: v.integer({ positive: true })
  }
});

router.get('/:regionId/sites', getSitesSchema, async (req, res) => {
  if (!canActOnRegion(req.user, req.params.regionId)) {
    return res.status(403).json({ error: 'You do not have access to this region' });
  }
  const { rows } = await pool.query('SELECT *, region_id AS zone_id FROM sites WHERE region_id = $1 ORDER BY name', [req.params.regionId]);
  res.json(rows);
});

const createSiteSchema = validate({
  params: {
    regionId: v.integer({ positive: true })
  },
  body: {
    name: v.string({ min: 2, max: 150 }),
    address: v.string({ min: 0, max: 300, required: false })
  }
});

router.post('/:regionId/sites', requireRegionAdminOrAbove, createSiteSchema, async (req, res) => {
  if (!canActOnRegion(req.user, req.params.regionId)) {
    return res.status(403).json({ error: 'You can only add sites to your own region' });
  }
  const { name, address } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO sites (region_id, name, address) VALUES ($1, $2, $3) RETURNING *, region_id AS zone_id',
    [req.params.regionId, name, address || null]
  );
  res.status(201).json(rows[0]);
});

const updateSiteSchema = validate({
  params: {
    regionId: v.integer({ positive: true }),
    siteId: v.integer({ positive: true })
  },
  body: {
    name: v.string({ min: 2, max: 150 }),
    address: v.string({ min: 0, max: 300, required: false })
  }
});

router.put('/:regionId/sites/:siteId', requireRegionAdminOrAbove, updateSiteSchema, async (req, res) => {
  if (!canActOnRegion(req.user, req.params.regionId)) {
    return res.status(403).json({ error: 'You can only edit sites in your own region' });
  }
  const { name, address } = req.body;
  const { rows } = await pool.query(
    'UPDATE sites SET name = $1, address = $2 WHERE id = $3 AND region_id = $4 RETURNING *, region_id AS zone_id',
    [name, address || null, req.params.siteId, req.params.regionId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Site not found' });
  res.json(rows[0]);
});

const deleteSiteSchema = validate({
  params: {
    regionId: v.integer({ positive: true }),
    siteId: v.integer({ positive: true })
  }
});

router.delete('/:regionId/sites/:siteId', requireRegionAdminOrAbove, deleteSiteSchema, async (req, res) => {
  if (!canActOnRegion(req.user, req.params.regionId)) {
    return res.status(403).json({ error: 'You can only delete sites in your own region' });
  }
  try {
    const { rowCount } = await pool.query('DELETE FROM sites WHERE id = $1 AND region_id = $2', [req.params.siteId, req.params.regionId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Site not found' });
    res.status(204).send();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Cannot delete site: It has active users or inventory associated with it.' });
    }
    throw err;
  }
});

module.exports = router;
