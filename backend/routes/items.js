const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { v, validate } = require('../middleware/validator');

const router = express.Router();
router.use(authenticate);

async function getItemByBarcode(barcodeValue, user, res) {
  const { rows } = await pool.query(
    `SELECT i.*, i.current_region_id AS current_zone_id, m.name AS material_name, r.name AS region_name, r.name AS zone_name, s.name AS site_name
     FROM items i
     JOIN materials m ON i.material_id = m.id
     LEFT JOIN regions r ON i.current_region_id = r.id
     LEFT JOIN sites s ON i.current_site_id = s.id
     WHERE i.barcode_value = $1`,
    [barcodeValue]
  );
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'No item found for this barcode' });
  const userRegionId = user.regionId || user.zoneId;
  const itemRegionId = item.current_region_id || item.current_zone_id;

  if (user.role === 'site_engineer') {
    const isEngineerSite = item.current_site_id && Number(item.current_site_id) === Number(user.siteId);
    const isEngineerRegion = itemRegionId && Number(itemRegionId) === Number(userRegionId);
    const isEnRoute = item.status === 'IN_TRANSIT_TO_SITE';
    if (!isEngineerSite && !isEngineerRegion && !isEnRoute) {
      return res.status(403).json({ error: 'This item does not belong to your site or region' });
    }
  } else if (user.role !== 'super_admin') {
    if (itemRegionId && Number(itemRegionId) !== Number(userRegionId)) {
      return res.status(403).json({ error: 'This item belongs to another region' });
    }
  }
  res.json(item);
}

const lookupSchema = validate({
  query: {
    q: v.string({ min: 0, max: 100, required: false }),
    query: v.string({ min: 0, max: 100, required: false }),
    materialId: v.integer({ positive: true, required: false })
  }
});

router.get('/lookup', lookupSchema, async (req, res) => {
  const query = (req.query.q || req.query.query || '').trim();
  const materialIdParam = req.query.materialId;

  if (!query && !materialIdParam) {
    return res.status(400).json({ error: 'Please provide a barcode, serial number, or material name' });
  }

  if (query) {
    const { rows: itemRows } = await pool.query(
      `SELECT i.*, i.current_region_id AS current_zone_id, m.name AS material_name, r.name AS region_name, r.name AS zone_name, s.name AS site_name
       FROM items i
       JOIN materials m ON i.material_id = m.id
       LEFT JOIN regions r ON i.current_region_id = r.id
       LEFT JOIN sites s ON i.current_site_id = s.id
       WHERE i.barcode_value = $1`,
      [query]
    );

    if (itemRows.length > 0) {
      const item = itemRows[0];
      const userRegionId = req.user.regionId || req.user.zoneId;
      const itemRegionId = item.current_region_id || item.current_zone_id;

      if (req.user.role === 'site_engineer') {
        const isEngineerSite = item.current_site_id && Number(item.current_site_id) === Number(req.user.siteId);
        const isEngineerRegion = itemRegionId && Number(itemRegionId) === Number(userRegionId);
        const isEnRoute = item.status === 'IN_TRANSIT_TO_SITE';
        if (!isEngineerSite && !isEngineerRegion && !isEnRoute) {
          return res.status(403).json({ error: 'This item does not belong to your site or region' });
        }
      } else if (req.user.role !== 'super_admin') {
        if (itemRegionId && Number(itemRegionId) !== Number(userRegionId)) {
          return res.status(403).json({ error: 'This item belongs to another region' });
        }
      }
      return res.json({ resultType: 'item', item });
    }
  }

  let matSql = `SELECT * FROM materials`;
  const matParams = [];
  if (materialIdParam) {
    matParams.push(materialIdParam);
    matSql += ` WHERE id = $${matParams.length}`;
  } else if (query) {
    matParams.push(`%${query}%`);
    matSql += ` WHERE name ILIKE $${matParams.length} OR category ILIKE $${matParams.length}`;
  }
  matSql += ` ORDER BY name ASC`;

  const { rows: matRows } = await pool.query(matSql, matParams);

  if (matRows.length === 0) {
    return res.status(404).json({ error: 'No item or material found matching your query' });
  }

  const materialsResult = [];

  for (const mat of matRows) {
    const { sql: itemsSql, params: itemsParams } = buildItemListQuery(req.user, null, mat.id);
    const { rows: items } = await pool.query(itemsSql, itemsParams);

    let stockSql = `SELECT sl.*, r.name AS region_name, s.name AS site_name
                    FROM stock_levels sl
                    LEFT JOIN regions r ON sl.region_id = r.id
                    LEFT JOIN sites s ON sl.site_id = s.id
                    WHERE sl.material_id = $1`;
    const stockParams = [mat.id];
    const userRegionId = req.user.regionId || req.user.zoneId;
    if (req.user.role !== 'super_admin') {
      stockParams.push(userRegionId);
      stockSql += ` AND (sl.region_id = $2 OR sl.location_type = 'HO')`;
    }
    const { rows: stockLevels } = await pool.query(stockSql, stockParams);

    let hoStock = 0;
    let regionStock = 0;
    let siteStock = 0;
    stockLevels.forEach(sl => {
      const qty = parseFloat(sl.quantity || 0);
      if (sl.location_type === 'HO') hoStock += qty;
      else if (sl.location_type === 'REGION' || sl.location_type === 'ZONE') regionStock += qty;
      else if (sl.location_type === 'SITE') siteStock += qty;
    });

    let activeSerializedCount = 0;
    items.forEach(i => {
      if (['IN_HO', 'IN_REGION', 'IN_ZONE', 'AT_SITE', 'IN_TRANSIT_TO_REGION', 'IN_TRANSIT_TO_SITE'].includes(i.status)) {
        activeSerializedCount++;
      }
    });

    materialsResult.push({
      material: mat,
      items,
      stockLevels,
      stockSummary: {
        hoStock,
        regionStock,
        siteStock,
        totalBulkStock: hoStock + regionStock + siteStock,
        serializedCount: items.length,
        activeSerializedCount
      }
    });
  }

  return res.json({ resultType: 'material', materials: materialsResult });
});

const barcodeParamSchema = validate({
  params: {
    barcodeValue: v.string({ min: 1, max: 100, required: false }),
    serialNumber: v.string({ min: 1, max: 100, required: false })
  }
});

router.get('/barcode-value/:barcodeValue', barcodeParamSchema, (req, res) => getItemByBarcode(req.params.barcodeValue, req.user, res));
router.get('/barcode/:barcodeValue', barcodeParamSchema, (req, res) => getItemByBarcode(req.params.barcodeValue, req.user, res));
router.get('/serial/:serialNumber', barcodeParamSchema, (req, res) => getItemByBarcode(req.params.serialNumber, req.user, res));

function buildItemListQuery(user, status, materialId) {
  let sql = `SELECT i.*, i.current_region_id AS current_zone_id, m.name AS material_name, r.name AS region_name, r.name AS zone_name, s.name AS site_name
             FROM items i
             JOIN materials m ON i.material_id = m.id
             LEFT JOIN regions r ON i.current_region_id = r.id
             LEFT JOIN sites s ON i.current_site_id = s.id
             WHERE 1=1`;
  const params = [];
  const userRegionId = (user.regionId || user.zoneId) ? Number(user.regionId || user.zoneId) : null;
  if (user.role !== 'super_admin') {
    if (userRegionId && !isNaN(userRegionId)) {
      params.push(userRegionId);
      sql += ` AND (i.current_region_id = $${params.length} OR i.current_region_id IS NULL)`;
    }
  }
  const statusStr = (status && typeof status === 'string' && status.trim() && status !== 'all' && status !== 'undefined') ? status.trim() : null;
  if (statusStr) { params.push(statusStr); sql += ` AND i.status = $${params.length}`; }

  const validMatId = (materialId && materialId !== 'all' && materialId !== 'undefined' && !isNaN(Number(materialId)) && Number(materialId) > 0) ? Number(materialId) : null;
  if (validMatId) { params.push(validMatId); sql += ` AND i.material_id = $${params.length}`; }
  sql += ' ORDER BY i.created_at DESC';
  return { sql, params };
}

const getItemsSchema = validate({
  query: {
    status: v.string({ min: 0, max: 50, required: false }),
    materialId: v.integer({ positive: true, required: false })
  }
});

router.get('/', getItemsSchema, async (req, res) => {
  const { sql, params } = buildItemListQuery(req.user, req.query.status, req.query.materialId);
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

module.exports = router;
