const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authLimiter, authExponentialBackoff, recordAuthFailure, resetAuthFailure } = require('../middleware/rateLimiter');
const { v, validate } = require('../middleware/validator');
const { findUserByEmail, verifyPassword, signToken, toUserProfile } = require('../services/authService');

const router = express.Router();

const loginSchema = validate({
  body: {
    email: v.email({ max: 255 }),
    password: v.string({ min: 1, max: 128 })
  }
});

router.post('/login', authLimiter, authExponentialBackoff, loginSchema, async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await findUserByEmail(email);
    if (!(await verifyPassword(user, password))) {
      recordAuthFailure(req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    resetAuthFailure(req);
    res.json({ token: signToken(user), user: toUserProfile(user) });
  } catch (err) {
    console.error(err);
    recordAuthFailure(req);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.region_id, u.site_id, u.phone_number, u.must_change_password,
              r.name AS region_name, s.name AS site_name
       FROM users u
       LEFT JOIN regions r ON u.region_id = r.id
       LEFT JOIN sites s ON u.site_id = s.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(toUserProfile(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

const forgotPasswordSchema = validate({
  body: {
    phone_number: v.string({ min: 3, max: 255, required: false }),
    email: v.string({ min: 3, max: 255, required: false }),
    identifier: v.string({ min: 3, max: 255, required: false }),
    newPassword: v.string({ min: 6, max: 128, required: false }),
    new_password: v.string({ min: 6, max: 128, required: false })
  }
});

router.post('/forgot-password', authLimiter, authExponentialBackoff, forgotPasswordSchema, async (req, res) => {
  const { phone_number, email, identifier, newPassword, new_password } = req.body;
  const targetPassword = newPassword || new_password;
  const rawInput = (identifier || phone_number || email || '').trim();

  if (!rawInput || !targetPassword) {
    recordAuthFailure(req);
    return res.status(400).json({ error: 'Registered email or phone number and new password are required' });
  }

  if (targetPassword.length < 6) {
    recordAuthFailure(req);
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  try {
    let user = null;
    if (rawInput.includes('@')) {
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.password_hash, u.full_name, u.role, u.is_active
         FROM users u
         WHERE u.email = $1`,
        [rawInput.toLowerCase()]
      );
      user = rows[0];
    } else {
      let digits = rawInput.replace(/\D/g, '');
      if (digits.length === 10) digits = '91' + digits;
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.password_hash, u.full_name, u.role, u.is_active
         FROM users u
         WHERE u.phone_number = $1 OR u.email = $2`,
        [digits, rawInput.toLowerCase()]
      );
      user = rows[0];
    }

    if (!user || !user.is_active) {
      recordAuthFailure(req);
      return res.status(404).json({ error: 'No active account found with this email or phone number' });
    }
    resetAuthFailure(req);

    if (user.role === 'super_admin') {
      return res.status(403).json({ error: 'Super Admin passwords cannot be reset via self-service. Please contact administrator or use CLI.' });
    }

    const hash = await bcrypt.hash(targetPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);

    res.json({ message: 'Password updated successfully. You can now sign in with your new password.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
});

const setPermanentPasswordSchema = validate({
  body: {
    new_password: v.string({ min: 6, max: 128, required: false }),
    newPassword: v.string({ min: 6, max: 128, required: false })
  }
});

router.post('/set-permanent-password', authenticate, setPermanentPasswordSchema, async (req, res) => {
  const { new_password, newPassword } = req.body;
  const targetPassword = (new_password || newPassword || '').trim();
  if (!targetPassword || targetPassword.length < 6) {
    return res.status(400).json({ error: 'New permanent password must be at least 6 characters long' });
  }

  try {
    const hash = await bcrypt.hash(targetPassword, 10);
    const userId = req.user.id;

    await pool.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = FALSE
       WHERE id = $2`,
      [hash, userId]
    );

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.region_id, u.site_id, u.phone_number, u.must_change_password,
              r.name AS region_name, s.name AS site_name
       FROM users u
       LEFT JOIN regions r ON u.region_id = r.id
       LEFT JOIN sites s ON u.site_id = s.id
       WHERE u.id = $1`,
      [userId]
    );

    res.json({
      message: 'Permanent password set successfully',
      user: toUserProfile(rows[0])
    });
  } catch (err) {
    console.error('Set permanent password error:', err);
    res.status(500).json({ error: 'Failed to set permanent password' });
  }
});

const profileUpdateSchema = validate({
  body: {
    full_name: v.string({ min: 2, max: 150, required: false }),
    email: v.email({ max: 255, required: false }),
    phone_number: v.phone({ required: false }),
    current_password: v.string({ min: 6, max: 128, required: false }),
    new_password: v.string({ min: 6, max: 128, required: false })
  }
});

router.put('/profile', authenticate, profileUpdateSchema, async (req, res) => {
  const { full_name, email, phone_number, current_password, new_password } = req.body;
  const userId = req.user.id;

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (email && email.trim().toLowerCase() !== user.email) {
      const emailLower = email.trim().toLowerCase();
      const duplicateCheck = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [emailLower, userId]);
      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({ error: 'That email is already registered to another account' });
      }
      user.email = emailLower;
    }

    let normalizedPhone = phone_number ? phone_number.replace(/\D/g, '') : null;
    if (normalizedPhone && normalizedPhone.length === 10) {
      normalizedPhone = '91' + normalizedPhone;
    }
    if (normalizedPhone) {
      const duplicatePhone = await pool.query('SELECT id FROM users WHERE phone_number = $1 AND id != $2', [normalizedPhone, userId]);
      if (duplicatePhone.rows.length > 0) {
        return res.status(409).json({ error: 'That phone number is already registered to another account' });
      }
    }

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ error: 'Current password is required to set a new password' });
      }
      const isMatch = await bcrypt.compare(current_password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Incorrect current password' });
      }
      if (new_password.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long' });
      }
      user.password_hash = await bcrypt.hash(new_password, 10);
    }

    if (full_name) user.full_name = full_name.trim();

    await pool.query(
      `UPDATE users
       SET email = $1, password_hash = $2, full_name = $3, phone_number = $4
       WHERE id = $5`,
      [user.email, user.password_hash, user.full_name, normalizedPhone, userId]
    );

    const updatedUserRes = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.region_id, u.site_id, u.phone_number, u.must_change_password,
              r.name AS region_name, s.name AS site_name
       FROM users u
       LEFT JOIN regions r ON u.region_id = r.id
       LEFT JOIN sites s ON u.site_id = s.id
       WHERE u.id = $1`,
      [userId]
    );

    res.json({
      message: 'Profile updated successfully',
      user: toUserProfile(updatedUserRes.rows[0])
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
