const express = require('express');
const pool = require('../config/db');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');

const router = express.Router();
router.use(authenticate);

const getMaterialsSchema = validate({
  query: {
    search: v.string({ min: 0, max: 100, required: false })
  }
});

router.get('/', getMaterialsSchema, async (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM materials';
  const params = [];
  if (search) {
    sql += ' WHERE name ILIKE $1 OR category ILIKE $1';
    params.push(`%${search}%`);
  }
  sql += ' ORDER BY name';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

const createMaterialSchema = validate({
  body: {
    name: v.string({ min: 2, max: 150 }),
    category: v.string({ min: 0, max: 100, required: false }),
    unit: v.string({ min: 1, max: 20, required: false }),
    price: v.number({ min: 0, required: false }),
    min_stock_level: v.integer({ min: 0, required: false }),
    reorder_level: v.integer({ min: 0, required: false }),
    is_serialized: v.boolean({ required: false })
  }
});

router.post('/', requireSuperAdmin, createMaterialSchema, async (req, res) => {
  const { name, category, unit, min_stock_level, reorder_level, price, is_serialized } = req.body;
  const minStock = min_stock_level !== undefined ? min_stock_level : (reorder_level || 0);
  const priceVal = parseFloat(price || 0);
  const serializedVal = is_serialized === true || is_serialized === 'true';

  const { rows } = await pool.query(
    `INSERT INTO materials (name, category, unit, price, min_stock_level, is_serialized)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, category || null, unit || 'pcs', priceVal, minStock, serializedVal]
  );
  res.status(201).json(rows[0]);
});

const updateMaterialSchema = validate({
  params: {
    id: v.integer({ positive: true })
  },
  body: {
    name: v.string({ min: 2, max: 150 }),
    category: v.string({ min: 0, max: 100, required: false }),
    unit: v.string({ min: 1, max: 20, required: false }),
    price: v.number({ min: 0, required: false }),
    min_stock_level: v.integer({ min: 0, required: false }),
    reorder_level: v.integer({ min: 0, required: false }),
    is_serialized: v.boolean({ required: false })
  }
});

router.put('/:id', requireSuperAdmin, updateMaterialSchema, async (req, res) => {
  const { name, category, unit, min_stock_level, reorder_level, price, is_serialized } = req.body;
  const minStock = min_stock_level !== undefined ? min_stock_level : (reorder_level || 0);
  const priceVal = parseFloat(price || 0);
  const serializedVal = is_serialized === true || is_serialized === 'true';

  const { rows } = await pool.query(
    `UPDATE materials SET name = $1, category = $2, unit = $3, price = $4, min_stock_level = $5, is_serialized = $6
     WHERE id = $7 RETURNING *`,
    [name, category || null, unit || 'pcs', priceVal, minStock, serializedVal, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Material not found' });
  res.json(rows[0]);
});

const deleteMaterialSchema = validate({
  params: {
    id: v.integer({ positive: true })
  }
});

router.delete('/:id', requireSuperAdmin, deleteMaterialSchema, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM materials WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Material not found' });
    res.status(204).send();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Cannot delete material: It is referenced by existing stock items, requisitions, or purchase orders.' });
    }
    throw err;
  }
});

module.exports = router;