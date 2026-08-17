const pool = require('../config/db');
const { canActOnSite } = require('../middleware/auth');

async function resolveConsumedQuantity(client, materialId, barcodeValue, siteId, quantity) {
  if (!barcodeValue) {
    const { rows: stockRows } = await client.query("SELECT * FROM stock_levels WHERE material_id = $1 AND location_type = 'SITE' AND site_id = $2", [materialId, siteId]);
    const stock = stockRows[0];
    if (!stock || stock.quantity < quantity) throw new Error('Insufficient site stock for this consumption');
    await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE id = $2', [quantity, stock.id]);
    return { item: null, qty: quantity };
  }

  const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1', [barcodeValue]);
  const item = rows[0];
  if (!item) throw new Error(`Barcode ${barcodeValue} not found`);
  if (item.status !== 'IN_SITE' && item.status !== 'IN_REGION' && item.status !== 'IN_ZONE') {
    throw new Error(`Item ${barcodeValue} is not available to consume (status: ${item.status})`);
  }
  await client.query("UPDATE items SET status = 'CONSUMED', current_site_id = $1 WHERE id = $2", [siteId, item.id]);
  return { item, qty: 1 };
}

async function recordConsumption(user, body) {
  const { material_id, item_barcode_value, item_serial_number, quantity, site_id, region_id, zone_id, installed_location, reference_requisition_id, oms_ticket_number, oms_number, notes, items, lines } = body;
  const targetSiteId = site_id || user.siteId;
  const ticketVal = (oms_ticket_number || oms_number || '').trim();

  if (!targetSiteId) throw Object.assign(new Error('site_id is required'), { status: 400 });
  if (!installed_location || !installed_location.trim()) {
    throw Object.assign(new Error('Asset Description (installed_location) is required'), { status: 400 });
  }

  const itemList = Array.isArray(items) && items.length > 0 ? items : (Array.isArray(lines) && lines.length > 0 ? lines : []);
  if (!itemList.length) {
    itemList.push({ material_id, item_barcode_value: item_barcode_value || item_serial_number, quantity });
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    const { rows: siteRows } = await client.query('SELECT * FROM sites WHERE id = $1', [targetSiteId]);
    const siteObj = siteRows[0];
    if (!siteObj || !canActOnSite(user, siteObj)) {
      throw Object.assign(new Error('You do not have access to this site'), { status: 403 });
    }

    const targetRegionId = region_id || zone_id || siteObj.region_id || siteObj.zone_id || user.regionId || user.zoneId;

    await client.query('BEGIN');
    inTransaction = true;

    let reqId = reference_requisition_id || null;
    if (!reqId && ticketVal) {
      const { rows: reqRows } = await client.query('SELECT id FROM requisitions WHERE oms_ticket_number = $1 OR id::text = $1', [ticketVal]);
      if (reqRows[0]) reqId = reqRows[0].id;
    }

    let finalNotes = notes || null;
    if (ticketVal && (!finalNotes || !finalNotes.includes(ticketVal))) {
      finalNotes = finalNotes ? `[OMS Ticket: ${ticketVal}] ${finalNotes}` : `[OMS Ticket: ${ticketVal}]`;
    }

    const recordedConsumptions = [];
    for (const itm of itemList) {
      const matId = itm.material_id;
      const rawCodes = itm.barcode_values || itm.barcodeValues || itm.serial_numbers;
      const bCodes = Array.isArray(rawCodes) && rawCodes.length > 0
        ? rawCodes
        : (itm.item_barcode_value || itm.barcode_value || itm.serial_number ? [itm.item_barcode_value || itm.barcode_value || itm.serial_number] : [null]);
      const qVal = parseFloat(itm.quantity || 1);

      for (const bCode of bCodes) {
        const { item, qty } = await resolveConsumedQuantity(client, matId, bCode, targetSiteId, bCode ? 1 : qVal);
        const targetMaterialId = matId || item?.material_id;
        if (!targetMaterialId) continue;

        const { rows } = await client.query(
          `INSERT INTO consumptions (material_id, item_id, quantity, site_id, region_id, installed_location, reference_requisition_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [targetMaterialId, item?.id || null, qty, targetSiteId, targetRegionId, installed_location || null, reqId, user.id]
        );
        await client.query(
          `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, from_region_id, to_site_id, reference_requisition_id, created_by, notes)
           VALUES ('CONSUME', $1, $2, $3, 'SITE', 'SITE', $4, $5, $6, $7, $8)`,
          [targetMaterialId, item?.id || null, qty, targetRegionId, targetSiteId, reqId, user.id, finalNotes]
        );
        recordedConsumptions.push(rows[0].id);
      }
    }

    await client.query('COMMIT');
    inTransaction = false;
    return { recorded_consumptions: recordedConsumptions, message: `Consumption recorded for ${recordedConsumptions.length} materials` };
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordConsumption };
