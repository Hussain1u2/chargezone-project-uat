const bcrypt = require('bcryptjs');
const pool = require('../config/db');

function validateNewUserInput(requester, body) {
  const { email, password, full_name, role, region_id, zone_id, site_id } = body;
  const targetRegionId = region_id || zone_id;
  const isRegionAdminReq = ['region_admin', 'zone_admin'].includes(requester.role);

  if (!email || !password || !full_name || !role) {
    return 'email, password, full_name and role are required';
  }
  if (isRegionAdminReq && role !== 'site_engineer') {
    return 'Region admins can only create site engineers';
  }
  if (['region_admin', 'zone_admin'].includes(role) && !targetRegionId) return 'region_id is required for a region admin';
  if (role === 'site_engineer' && (!targetRegionId || !site_id)) {
    return 'region_id and site_id are required for a site engineer';
  }
  return null;
}

async function resolveRegionAndSite(requester, body) {
  const { role, region_id, zone_id, site_id } = body;
  const reqRegionId = requester.regionId || requester.zoneId;
  const isRegionAdminReq = ['region_admin', 'zone_admin'].includes(requester.role);

  if (!isRegionAdminReq) {
    const targetRegionId = role === 'super_admin' ? null : (region_id || zone_id);
    return { regionId: targetRegionId, siteId: role === 'site_engineer' ? site_id : null };
  }

  const { rows } = await pool.query('SELECT id FROM sites WHERE id = $1 AND region_id = $2', [site_id, reqRegionId]);
  if (!rows[0]) throw new Error('That site does not belong to your region');
  return { regionId: reqRegionId, siteId };
}

async function createUser(requester, body) {
  const { regionId, siteId } = await resolveRegionAndSite(requester, body);
  const hash = await bcrypt.hash(body.password, 10);

  const normalizedRole = body.role === 'zone_admin' ? 'region_admin' : body.role;

  let normalizedPhone = (body.phone_number || body.phone) ? String(body.phone_number || body.phone).replace(/\D/g, '') : null;
  if (normalizedPhone && normalizedPhone.length === 10) {
    normalizedPhone = '91' + normalizedPhone;
  }
  if (normalizedPhone) {
    const duplicatePhone = await pool.query('SELECT id FROM users WHERE phone_number = $1', [normalizedPhone]);
    if (duplicatePhone.rows.length > 0) {
      const err = new Error('That phone number is already registered to another account');
      err.code = '23505';
      err.status = 409;
      throw err;
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role, region_id, site_id, phone_number, must_change_password) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
     RETURNING id, email, full_name, role, region_id, region_id AS zone_id, site_id, is_active, phone_number, must_change_password`,
    [body.email.trim().toLowerCase(), hash, body.full_name, normalizedRole, regionId, siteId, normalizedPhone]
  );
  return rows[0];
}

async function loadManageableUser(requester, targetId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [targetId]);
  const target = rows[0];
  if (!target) return { error: 'User not found', status: 404 };

  const reqRegionId = requester.regionId || requester.zoneId;
  const isRegionAdminReq = ['region_admin', 'zone_admin'].includes(requester.role);

  const regionAdminBlocked = isRegionAdminReq &&
    !(target.role === 'site_engineer' && (target.region_id === reqRegionId || target.zone_id === reqRegionId));
  if (regionAdminBlocked) return { error: 'You can only manage site engineers in your own region', status: 403 };

  return { target };
}

async function updateUser(requester, target, body) {
  const { email, password, full_name, role, region_id, zone_id, site_id, is_active, phone_number, phone } = body;
  const isRegionAdminReq = ['region_admin', 'zone_admin'].includes(requester.role);
  let newRole = isRegionAdminReq ? 'site_engineer' : (role || target.role);
  if (newRole === 'zone_admin') newRole = 'region_admin';

  if (isRegionAdminReq && newRole !== 'site_engineer') {
    throw Object.assign(new Error('Region admins can only manage site engineers'), { status: 403 });
  }

  const reqRegionId = requester.regionId || requester.zoneId;
  const targetInputRegionId = region_id !== undefined ? region_id : zone_id;

  let regionId = target.region_id || target.zone_id;
  let siteId = target.site_id;

  if (newRole === 'super_admin') {
    regionId = null;
    siteId = null;
  } else {
    regionId = isRegionAdminReq ? reqRegionId : (targetInputRegionId !== undefined ? (targetInputRegionId ? Number(targetInputRegionId) : null) : (target.region_id || target.zone_id));
    siteId = newRole === 'site_engineer' ? (site_id !== undefined ? (site_id ? Number(site_id) : null) : target.site_id) : null;

    if (isRegionAdminReq && siteId) {
      const { rows } = await pool.query('SELECT id FROM sites WHERE id = $1 AND region_id = $2', [siteId, reqRegionId]);
      if (!rows[0]) throw new Error('That site does not belong to your region');
    }
  }

  const newEmail = email ? email.trim().toLowerCase() : target.email;
  const newFullName = full_name ? full_name.trim() : target.full_name;
  const newIsActive = is_active !== undefined ? !!is_active : target.is_active;

  let rawPhone = phone_number !== undefined ? phone_number : (phone !== undefined ? phone : undefined);
  let normalizedPhone = rawPhone !== undefined ? (rawPhone ? String(rawPhone).replace(/\D/g, '') : null) : target.phone_number;
  if (normalizedPhone && String(normalizedPhone).length === 10) {
    normalizedPhone = '91' + normalizedPhone;
  }
  if (normalizedPhone && normalizedPhone !== target.phone_number) {
    const duplicatePhone = await pool.query('SELECT id FROM users WHERE phone_number = $1 AND id != $2', [normalizedPhone, target.id]);
    if (duplicatePhone.rows.length > 0) {
      const err = new Error('That phone number is already registered to another account');
      err.code = '23505';
      err.status = 409;
      throw err;
    }
  }

  let hash = target.password_hash;
  let mustChangePassword = target.must_change_password;
  if (password && password.trim()) {
    hash = await bcrypt.hash(password.trim(), 10);
    mustChangePassword = true;
  }

  const { rows } = await pool.query(
    `UPDATE users
     SET email = $1, password_hash = $2, full_name = $3, role = $4, region_id = $5, site_id = $6, is_active = $7, phone_number = $8, must_change_password = $9
     WHERE id = $10
     RETURNING id, email, full_name, role, region_id, region_id AS zone_id, site_id, is_active, phone_number, must_change_password`,
    [newEmail, hash, newFullName, newRole, regionId, siteId, newIsActive, normalizedPhone, mustChangePassword, target.id]
  );
  return rows[0];
}

module.exports = {
  validateNewUserInput,
  resolveRegionAndSite,
  createUser,
  loadManageableUser,
  updateUser
};
