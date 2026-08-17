const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRegionAdminOrAbove } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');
const { validateNewUserInput, createUser, loadManageableUser, updateUser } = require('../services/userService');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  let sql = `SELECT u.id, u.email, u.full_name, u.role, u.region_id, u.region_id AS zone_id, u.site_id, u.is_active, u.phone_number, u.must_change_password,
                    r.name AS region_name, r.name AS zone_name, s.name AS site_name
             FROM users u
             LEFT JOIN regions r ON u.region_id = r.id
             LEFT JOIN sites s ON u.site_id = s.id`;
  const params = [];
  const userRegionId = req.user.regionId || req.user.zoneId;

  if (['region_admin', 'zone_admin'].includes(req.user.role)) {
    sql += " WHERE u.region_id = $1";
    params.push(userRegionId);
  } else if (req.user.role === 'site_engineer') {
    sql += " WHERE u.site_id = $1 OR (u.region_id = $2 AND u.role::text = 'site_engineer')";
    params.push(req.user.siteId, userRegionId);
  }
  sql += ' ORDER BY u.role, u.full_name';

  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

const createUserSchema = validate({
  body: {
    email: v.email({ max: 255 }),
    full_name: v.string({ min: 2, max: 150 }),
    password: v.string({ min: 6, max: 128 }),
    role: v.enum(['super_admin', 'region_admin', 'zone_admin', 'site_engineer']),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    site_id: v.integer({ positive: true, required: false }),
    phone_number: v.phone({ required: false }),
    phone: v.phone({ required: false })
  }
});

const { handleRouteError } = require('../utils/errorHandler');

router.post('/', requireRegionAdminOrAbove, createUserSchema, async (req, res) => {
  const validationError = validateNewUserInput(req.user, req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const user = await createUser(req.user, req.body);
    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: err.message || 'That email or mobile number is already registered' });
    handleRouteError(res, err, 500);
  }
});

const userIdParamSchema = validate({
  params: {
    id: v.integer({ positive: true })
  }
});

const updateUserSchema = validate({
  params: {
    id: v.integer({ positive: true })
  },
  body: {
    email: v.email({ max: 255, required: false }),
    full_name: v.string({ min: 2, max: 150, required: false }),
    password: v.string({ min: 6, max: 128, required: false }),
    role: v.enum(['super_admin', 'region_admin', 'zone_admin', 'site_engineer'], { required: false }),
    region_id: v.integer({ positive: true, required: false }),
    zone_id: v.integer({ positive: true, required: false }),
    site_id: v.integer({ positive: true, required: false }),
    phone_number: v.phone({ required: false }),
    phone: v.phone({ required: false })
  }
});

router.put('/:id', requireRegionAdminOrAbove, updateUserSchema, async (req, res) => {
  const { target, error, status } = await loadManageableUser(req.user, req.params.id);
  if (error) return res.status(status).json({ error });

  try {
    const updated = await updateUser(req.user, target, req.body);
    res.json(updated);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: err.message || 'That email or mobile number is already registered' });
    handleRouteError(res, err, 500);
  }
});

router.patch('/:id/deactivate', requireRegionAdminOrAbove, userIdParamSchema, async (req, res) => {
  const { target, error, status } = await loadManageableUser(req.user, req.params.id);
  if (error) return res.status(status).json({ error });
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [target.id]);
  res.json({ message: 'User deactivated' });
});

router.patch('/:id/reactivate', requireRegionAdminOrAbove, userIdParamSchema, async (req, res) => {
  const { target, error, status } = await loadManageableUser(req.user, req.params.id);
  if (error) return res.status(status).json({ error });
  await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1', [target.id]);
  res.json({ message: 'User reactivated' });
});

router.delete('/:id', requireRegionAdminOrAbove, userIdParamSchema, async (req, res) => {
  const { target, error, status } = await loadManageableUser(req.user, req.params.id);
  if (error) return res.status(status).json({ error });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

  try {
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Cannot delete user because they are referenced by existing records or transactions in the system' });
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
