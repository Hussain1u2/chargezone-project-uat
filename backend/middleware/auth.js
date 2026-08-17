const jwt = require('jsonwebtoken');
require('dotenv').config();

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'chargezone_production_secret_key_2026';
    const decoded = jwt.verify(token, secret);
    decoded.regionId = decoded.regionId || decoded.zoneId;
    decoded.zoneId = decoded.regionId;
    if (decoded.role === 'zone_admin') decoded.role = 'region_admin';
    req.user = decoded;

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}

function requireRegionAdminOrAbove(req, res, next) {
  if (!['super_admin', 'region_admin', 'zone_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Region admin access required' });
  }
  next();
}

const requireZoneAdminOrAbove = requireRegionAdminOrAbove;

function canActOnRegion(user, regionId) {
  if (user.role === 'super_admin') return true;
  const targetId = regionId !== undefined && regionId !== null ? regionId : undefined;
  if (targetId === undefined || targetId === null) return false;
  const userRegion = user.regionId || user.zoneId;
  return Number(userRegion) === Number(targetId);
}

const canActOnZone = canActOnRegion;

function canActOnSite(user, site) {
  if (user.role === 'super_admin') return true;
  if (!site) return false;
  const userRegion = user.regionId || user.zoneId;
  const siteRegion = site.region_id || site.zone_id;
  if (['region_admin', 'zone_admin'].includes(user.role)) return Number(userRegion) === Number(siteRegion);
  if (user.role === 'site_engineer') return Number(user.siteId) === Number(site.id);
  return false;
}

function enforceRegionAccess(req, res, next) {
  if (req.user.role === 'super_admin') return next();

  const targetRegionId = req.params.regionId || req.query.regionId || req.body.regionId || req.params.zoneId || req.query.zoneId || req.body.zoneId;
  if (!targetRegionId) return next();

  if (!canActOnRegion(req.user, targetRegionId)) {
    return res.status(403).json({ error: 'You do not have access to this region' });
  }
  next();
}

const enforceZoneAccess = enforceRegionAccess;

module.exports = {
  authenticate,
  requireSuperAdmin,
  requireRegionAdminOrAbove,
  requireZoneAdminOrAbove,
  canActOnRegion,
  canActOnZone,
  canActOnSite,
  enforceRegionAccess,
  enforceZoneAccess
};
