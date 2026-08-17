const pool = require('../config/db');

async function addStock(client, materialId, locationType, regionId, siteId, quantity, zoneId) {
  const targetRegionId = regionId || zoneId || null;
  const { rows } = await client.query(
    'SELECT id FROM stock_levels WHERE material_id = $1 AND location_type = $2 AND region_id IS NOT DISTINCT FROM $3 AND site_id IS NOT DISTINCT FROM $4',
    [materialId, locationType, targetRegionId, siteId || null]
  );

  if (rows[0]) {
    await client.query('UPDATE stock_levels SET quantity = quantity + $1 WHERE id = $2', [quantity, rows[0].id]);
  } else {
    await client.query(
      'INSERT INTO stock_levels (material_id, location_type, region_id, site_id, quantity) VALUES ($1, $2, $3, $4, $5)',
      [materialId, locationType, targetRegionId, siteId || null, quantity]
    );
  }
}

module.exports = { addStock };
