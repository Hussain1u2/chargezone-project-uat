const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.password_hash, u.full_name, u.role, u.region_id, u.region_id AS zone_id, u.site_id, u.is_active, u.phone_number, u.must_change_password,
            r.name AS region_name, r.name AS zone_name, s.name AS site_name
     FROM users u
     LEFT JOIN regions r ON u.region_id = r.id
     LEFT JOIN sites s ON u.site_id = s.id
     WHERE u.email = $1`,
    [email.trim().toLowerCase()]
  );
  return rows[0] || null;
}

async function verifyPassword(user, password) {
  if (!user || !user.is_active) return false;
  return bcrypt.compare(password, user.password_hash);
}

function signToken(user) {
  const userRegionId = user.region_id || user.zone_id;
  const userRole = user.role === 'zone_admin' ? 'region_admin' : user.role;
  const secret = process.env.JWT_SECRET || 'chargezone_dev_jwt_secret_key_change_in_production_2026';
  return jwt.sign(
    { id: user.id, email: user.email, role: userRole, regionId: userRegionId, zoneId: userRegionId, siteId: user.site_id },
    secret,
    { expiresIn: '12h' }
  );
}

function toUserProfile(user) {
  const userRegionId = user.region_id || user.zone_id;
  const userRegionName = user.region_name || user.zone_name;
  const userRole = user.role === 'zone_admin' ? 'region_admin' : user.role;
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: userRole,
    regionId: userRegionId,
    zoneId: userRegionId,
    regionName: userRegionName,
    zoneName: userRegionName,
    siteId: user.site_id,
    siteName: user.site_name,
    phoneNumber: user.phone_number,
    phone_number: user.phone_number,
    mustChangePassword: !!user.must_change_password,
    must_change_password: !!user.must_change_password
  };
}

module.exports = { findUserByEmail, verifyPassword, signToken, toUserProfile };
