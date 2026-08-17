const pool = require('../config/db');
const { canActOnRegion, canActOnSite } = require('../middleware/auth');
const { addStock } = require('./stockService');

async function dispatchSerializedFromHO(client, barcodeValues, materialId, regionId, userId, notes) {
  for (const code of barcodeValues) {
    const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1 AND material_id = $2', [code, materialId]);
    const item = rows[0];
    if (!item) throw new Error(`Barcode ${code} not found for this material`);
    if (item.status !== 'IN_HO') throw new Error(`Item ${code} is not currently in HO stock (status: ${item.status})`);

    await client.query("UPDATE items SET status = 'IN_TRANSIT_TO_REGION', current_region_id = $1 WHERE id = $2", [regionId, item.id]);
    await client.query(
      `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, to_region_id, created_by, notes)
       VALUES ('DISPATCH_HR', $1, $2, 1, 'HO', 'REGION', $3, $4, $5)`,
      [materialId, item.id, regionId, userId, notes || null]
    );
  }
}

async function dispatchBulkFromHO(client, materialId, regionId, quantity, userId, notes) {
  const { rows: stockRows } = await client.query("SELECT * FROM stock_levels WHERE material_id = $1 AND location_type = 'HO'", [materialId]);
  const stock = stockRows[0];
  if (!stock || stock.quantity < quantity) throw new Error('Insufficient HO stock for this dispatch');

  await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE id = $2', [quantity, stock.id]);
  await addStock(client, materialId, 'REGION', regionId, null, quantity);
  await client.query(
    `INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, to_region_id, created_by, notes)
     VALUES ('DISPATCH_HR', $1, $2, 'HO', 'REGION', $3, $4, $5)`,
    [materialId, quantity, regionId, userId, notes || null]
  );
}

async function dispatchToRegion({ materialId, regionId, zoneId, quantity, barcodeValues, serialNumbers, notes, userId, lines, items }) {
  const targetRegionId = regionId || zoneId;
  const lineList = Array.isArray(lines) && lines.length > 0 ? lines : (Array.isArray(items) && items.length > 0 ? items : []);
  if (!lineList.length && materialId) {
    lineList.push({ materialId, quantity, barcodeValues: barcodeValues || serialNumbers });
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    for (const line of lineList) {
      const matId = line.materialId || line.material_id;
      const qVal = parseFloat(line.quantity || 0);
      const codes = line.barcodeValues || line.barcode_values || line.serialNumbers || line.serial_numbers;

      if (!matId) continue;
      if (codes && codes.length > 0) {
        await dispatchSerializedFromHO(client, codes, matId, targetRegionId, userId, notes);
      } else if (qVal > 0) {
        await dispatchBulkFromHO(client, matId, targetRegionId, qVal, userId, notes);
      }
    }
    await client.query('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const dispatchToZone = dispatchToRegion;

async function receiveInRegion(user, opts) {
  const { barcodeValues, materialId, regionId, zoneId, siteId, quantity, notes, lines, items } = typeof opts === 'object' && !Array.isArray(opts) ? opts : { barcodeValues: opts };
  const lineList = Array.isArray(lines) && lines.length > 0 ? lines : (Array.isArray(items) && items.length > 0 ? items : []);
  if (!lineList.length && (barcodeValues || materialId)) {
    lineList.push({ materialId, quantity, barcodeValues });
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    let totalCount = 0;

    for (const line of lineList) {
      const matId = line.materialId || line.material_id;
      const qVal = parseFloat(line.quantity || 0);
      const codes = line.barcodeValues || line.barcode_values || line.serialNumbers || line.serial_numbers;

      if (codes && Array.isArray(codes) && codes.length > 0) {
        for (const code of codes) {
          const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1', [code]);
          const item = rows[0];
          if (!item) throw new Error(`Barcode ${code} not found`);
          const itemRegionId = item.current_region_id || item.current_zone_id;
          if (item.status !== 'IN_TRANSIT_TO_REGION' && item.status !== 'IN_TRANSIT_TO_ZONE') throw new Error(`Item ${code} is not currently in transit to a region`);
          if (!canActOnRegion(user, itemRegionId)) throw new Error(`Item ${code} is not destined for your region`);

          const targetSiteId = siteId || item.current_site_id || null;
          const newStatus = targetSiteId ? 'IN_SITE' : 'IN_REGION';
          const locType = targetSiteId ? 'SITE' : 'REGION';

          await client.query("UPDATE items SET status = $1, current_site_id = $2 WHERE id = $3", [newStatus, targetSiteId, item.id]);
          await client.query(
            `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, to_region_id, to_site_id, created_by, notes)
             VALUES ('RECEIVE_R', $1, $2, 1, 'HO', $3, $4, $5, $6, $7)`,
            [item.material_id, item.id, locType, itemRegionId, targetSiteId, user.id, notes || 'Region confirmed receipt']
          );
          totalCount += 1;
        }
      } else if (matId && qVal > 0) {
        const targetSiteId = siteId || null;
        const targetRegionId = regionId || zoneId || user.regionId || user.zoneId;
        if (!targetRegionId) throw new Error('Region ID is required for bulk stock receipt');
        if (!canActOnRegion(user, targetRegionId)) throw new Error('You do not have access to receive stock in this region');

        const locType = targetSiteId ? 'SITE' : 'REGION';
        await addStock(client, matId, locType, targetRegionId, targetSiteId, qVal);
        await client.query(
          `INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, to_region_id, to_site_id, created_by, notes)
           VALUES ('RECEIVE_R', $1, $2, 'HO', $3, $4, $5, $6, $7)`,
          [matId, qVal, locType, targetRegionId, targetSiteId, user.id, notes || 'Region confirmed bulk receipt']
        );
        totalCount += qVal;
      }
    }

    await client.query('COMMIT');
    inTransaction = false;
    return totalCount;
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const receiveInZone = receiveInRegion;

async function dispatchSerializedToSite(client, barcodeValues, materialId, regionId, siteId, requisitionId, userId, notes) {
  for (const code of barcodeValues) {
    const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1 AND material_id = $2', [code, materialId]);
    const item = rows[0];
    if (!item) throw new Error(`Barcode ${code} not found for this material`);
    const itemRegionId = item.current_region_id || item.current_zone_id;
    if ((item.status !== 'IN_REGION' && item.status !== 'IN_ZONE') || Number(itemRegionId) !== Number(regionId)) {
      throw new Error(`Item ${code} is not available in this region (status: ${item.status})`);
    }
    await client.query("UPDATE items SET status = 'IN_TRANSIT_TO_SITE', current_site_id = $1 WHERE id = $2", [siteId, item.id]);
    await client.query(
      `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, from_region_id, to_site_id, reference_requisition_id, created_by, notes)
       VALUES ('DISPATCH_RE', $1, $2, 1, 'REGION', 'SITE', $3, $4, $5, $6, $7)`,
      [materialId, item.id, regionId, siteId, requisitionId || null, userId, notes || null]
    );
  }
  return barcodeValues.length;
}

async function dispatchBulkToSite(client, materialId, regionId, siteId, quantity, requisitionId, userId, notes) {
  const qVal = parseFloat(quantity || 0);
  if (!qVal || qVal <= 0) throw Object.assign(new Error('quantity must be greater than 0'), { status: 400 });

  const { rows: stockRows } = await client.query("SELECT * FROM stock_levels WHERE material_id = $1 AND location_type::text IN ('REGION', 'ZONE') AND region_id = $2", [materialId, regionId]);
  const stock = stockRows[0];
  if (!stock || parseFloat(stock.quantity || 0) < qVal) throw new Error('Insufficient region stock for this dispatch');

  await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE id = $2', [qVal, stock.id]);
  await addStock(client, materialId, 'SITE', regionId, siteId, qVal);
  await client.query(
    `INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, from_region_id, to_site_id, reference_requisition_id, created_by, notes)
     VALUES ('DISPATCH_RE', $1, $2, 'REGION', 'SITE', $3, $4, $5, $6, $7)`,
    [materialId, qVal, regionId, siteId, requisitionId || null, userId, notes || null]
  );
  return qVal;
}

async function dispatchToSite({ materialId, regionId, zoneId, siteId, quantity, barcodeValues, serialNumbers, requisitionId, notes, userId }) {
  const targetRegionId = regionId || zoneId;
  const codes = barcodeValues || serialNumbers;
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    let dispatchedQty;
    if (codes && codes.length > 0) {
      dispatchedQty = await dispatchSerializedToSite(client, codes, materialId, targetRegionId, siteId, requisitionId, userId, notes);
    } else {
      if (!quantity || quantity <= 0) throw Object.assign(new Error('quantity must be greater than 0'), { status: 400 });
      dispatchedQty = await dispatchBulkToSite(client, materialId, targetRegionId, siteId, quantity, requisitionId, userId, notes);
    }

    if (requisitionId) {
      await client.query(
        `UPDATE requisitions SET quantity_fulfilled = COALESCE(quantity_fulfilled, 0) + $1,
           status = CASE WHEN COALESCE(quantity_fulfilled, 0) + $1 >= quantity_requested THEN 'FULFILLED' ELSE 'PARTIAL' END
         WHERE id = $2`,
        [dispatchedQty, requisitionId]
      );
    }
    await client.query('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function receiveAtSite(user, barcodeValues) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    for (const code of barcodeValues) {
      const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1', [code]);
      const item = rows[0];
      if (!item) throw new Error(`Barcode ${code} not found`);
      if (item.status !== 'IN_TRANSIT_TO_SITE') throw new Error(`Item ${code} is not currently in transit to a site`);

      const { rows: siteRows } = await client.query('SELECT * FROM sites WHERE id = $1', [item.current_site_id]);
      if (!canActOnSite(user, siteRows[0])) throw new Error(`Item ${code} is not destined for a site you have access to`);

      await client.query("UPDATE items SET status = 'IN_SITE' WHERE id = $1", [item.id]);
      await client.query(
        `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, to_site_id, created_by, notes)
         VALUES ('DISPATCH_RE', $1, $2, 1, 'REGION', 'SITE', $3, $4, 'Site confirmed receipt')`,
        [item.material_id, item.id, item.current_site_id, user.id]
      );
    }
    await client.query('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function dispatchRegionToRegion(user, { materialId, fromRegionId, toRegionId, fromZoneId, toZoneId, fromSiteId, toSiteId, quantity, barcodeValues, serialNumbers, notes, lines, items }) {
  const srcRegionId = fromRegionId || fromZoneId;
  const destRegionId = toRegionId || toZoneId;
  const targetFromSiteId = fromSiteId ? Number(fromSiteId) : null;
  const targetToSiteId = toSiteId ? Number(toSiteId) : null;

  if (!srcRegionId || !destRegionId) throw new Error('Source and destination regions are required');
  if (!canActOnRegion(user, srcRegionId)) throw new Error('You can only dispatch stock from your assigned region');

  const lineList = Array.isArray(lines) && lines.length > 0 ? lines : (Array.isArray(items) && items.length > 0 ? items : []);
  if (!lineList.length && materialId) {
    lineList.push({ materialId, quantity, barcodeValues: barcodeValues || serialNumbers });
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const fromLocType = targetFromSiteId ? 'SITE' : 'REGION';
    const toLocType = targetToSiteId ? 'SITE' : 'REGION';

    for (const line of lineList) {
      const matId = line.materialId || line.material_id;
      const qVal = parseFloat(line.quantity || 0);
      const codes = line.barcodeValues || line.barcode_values || line.serialNumbers || line.serial_numbers;

      if (!matId) continue;
      if (codes && codes.length > 0) {
        for (const code of codes) {
          const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1 AND material_id = $2', [code, matId]);
          const item = rows[0];
          if (!item) throw new Error(`Barcode ${code} not found for this material`);
          const itemRegionId = item.current_region_id || item.current_zone_id;
          if ((item.status !== 'IN_REGION' && item.status !== 'IN_ZONE' && item.status !== 'IN_SITE') || Number(itemRegionId) !== Number(srcRegionId)) {
            throw new Error(`Item ${code} is not available in source region stock (status: ${item.status})`);
          }
          if (targetFromSiteId && Number(item.current_site_id) !== Number(targetFromSiteId)) {
            throw new Error(`Item ${code} is not located at the selected source site`);
          }

          await client.query(
            "UPDATE items SET status = 'IN_TRANSIT_TO_REGION', current_region_id = $1, current_site_id = $2 WHERE id = $3",
            [destRegionId, targetToSiteId, item.id]
          );
          await client.query(
            `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, from_region_id, to_region_id, from_site_id, to_site_id, created_by, notes)
             VALUES ('OUT', $1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [matId, item.id, fromLocType, toLocType, srcRegionId, destRegionId, targetFromSiteId, targetToSiteId, user.id, notes || `Region to region dispatch (${srcRegionId} -> ${destRegionId})`]
          );
        }
      } else if (qVal > 0) {
        const { rows: stockRows } = await client.query(
          'SELECT * FROM stock_levels WHERE material_id = $1 AND location_type = $2 AND region_id = $3 AND site_id IS NOT DISTINCT FROM $4',
          [matId, fromLocType, srcRegionId, targetFromSiteId]
        );
        const stock = stockRows[0];
        if (!stock || stock.quantity < qVal) throw new Error('Insufficient stock at source location for this dispatch');

        await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE id = $2', [qVal, stock.id]);
        await client.query(
          `INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, from_region_id, to_region_id, from_site_id, to_site_id, created_by, notes)
           VALUES ('OUT', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [matId, qVal, fromLocType, toLocType, srcRegionId, destRegionId, targetFromSiteId, targetToSiteId, user.id, notes || `Region to region dispatch (${srcRegionId} -> ${destRegionId})`]
        );
      }
    }

    await client.query('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const dispatchZoneToZone = dispatchRegionToRegion;

async function returnStock(user, { returnType, materialId, regionId, fromRegionId, zoneId, fromZoneId, fromSiteId, toRegionId, toZoneId, toSiteId, quantity, barcodeValues, serialNumbers, notes, lines, items }) {
  const srcRegionId = fromRegionId || regionId || fromZoneId || zoneId;
  const destRegionId = toRegionId || toZoneId;
  const destinationSiteId = toSiteId ? Number(toSiteId) : null;
  const flow = returnType || (destRegionId ? 'SITE_TO_REGION' : 'REGION_TO_HO');

  if (!srcRegionId) throw new Error('Source region is required');
  if ((flow === 'SITE_TO_REGION' || flow === 'SITE_TO_ZONE' || flow === 'SITE_TO_HO') && !fromSiteId) {
    throw new Error('Source site is required for Site return');
  }

  if (['region_admin', 'zone_admin'].includes(user.role) && !canActOnRegion(user, srcRegionId)) {
    throw new Error('You can only record returns from your assigned region');
  }
  if (user.role === 'site_engineer' && user.siteId && Number(fromSiteId) !== Number(user.siteId)) {
    throw new Error('You can only record returns for your assigned site');
  }

  const lineList = Array.isArray(lines) && lines.length > 0 ? lines : (Array.isArray(items) && items.length > 0 ? items : []);
  if (!lineList.length && materialId) {
    lineList.push({ materialId, quantity, barcodeValues: barcodeValues || serialNumbers });
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    const sourceSiteId = fromSiteId ? Number(fromSiteId) : null;
    const finalDestRegionId = (flow.includes('SITE_TO_REGION') || flow.includes('REGION_TO_REGION') || flow.includes('SITE_TO_ZONE') || flow.includes('ZONE_TO_ZONE')) ? (destRegionId ? Number(destRegionId) : Number(srcRegionId)) : null;

    const fromLocType = sourceSiteId ? 'SITE' : 'REGION';
    const toLocType = flow.includes('TO_HO') ? 'HO' : (destinationSiteId ? 'SITE' : 'REGION');

    let returnNote = notes || `Return stock (${flow.replace(/_/g, ' ')})`;

    for (const line of lineList) {
      const matId = line.materialId || line.material_id;
      const codes = line.barcodeValues || line.barcode_values || line.serialNumbers || line.serial_numbers;
      const qtyNum = parseFloat(line.quantity || 0);

      if (!matId) continue;

      if (codes && codes.length > 0) {
        for (const code of codes) {
          const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1 AND material_id = $2', [code, matId]);
          const item = rows[0];
          if (!item) throw new Error(`Barcode ${code} not found for this material`);

          if (sourceSiteId && item.current_site_id && Number(item.current_site_id) !== Number(sourceSiteId)) {
            throw new Error(`Item ${code} is not currently located at the selected source site`);
          }

          let newStatus = 'IN_REGION';
          if (toLocType === 'HO') {
            newStatus = 'IN_HO';
          } else if (toLocType === 'SITE') {
            newStatus = 'IN_SITE';
          }

          await client.query(
            'UPDATE items SET status = $1, current_region_id = $2, current_site_id = $3 WHERE id = $4',
            [newStatus, finalDestRegionId, destinationSiteId, item.id]
          );

          await client.query(
            `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, from_region_id, from_site_id, to_region_id, to_site_id, created_by, notes)
             VALUES ('RETURN', $1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [matId, item.id, fromLocType, toLocType, srcRegionId, sourceSiteId, finalDestRegionId, destinationSiteId, user.id, returnNote]
          );
        }
      } else if (qtyNum > 0) {
        const { rows: stockRows } = await client.query(
          'SELECT * FROM stock_levels WHERE material_id = $1 AND location_type = $2 AND region_id = $3 AND site_id IS NOT DISTINCT FROM $4',
          [matId, fromLocType, srcRegionId, sourceSiteId]
        );
        const stock = stockRows[0];
        if (!stock || stock.quantity < qtyNum) {
          throw new Error('Insufficient bulk stock at source location to record return');
        }

        await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE id = $2', [qtyNum, stock.id]);
        await addStock(client, matId, toLocType, finalDestRegionId, destinationSiteId, qtyNum);

        await client.query(
          `INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, from_region_id, from_site_id, to_region_id, to_site_id, created_by, notes)
           VALUES ('RETURN', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [matId, qtyNum, fromLocType, toLocType, srcRegionId, sourceSiteId, finalDestRegionId, destinationSiteId, user.id, returnNote]
        );
      }
    }

    await client.query('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  dispatchToRegion,
  dispatchToZone,
  receiveInRegion,
  receiveInZone,
  dispatchToSite,
  receiveAtSite,
  dispatchRegionToRegion,
  dispatchZoneToZone,
  returnStock
};
