const pool = require('../config/db');
const { canActOnSite, canActOnRegion } = require('../middleware/auth');
const { addStock } = require('./stockService');

async function resolveOldMaterial(client, barcodeValue, materialId, siteId, disposition) {
  if (!barcodeValue) return { item: null, materialId };
  const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1', [barcodeValue]);
  const item = rows[0];
  if (!item) throw new Error(`Old material barcode ${barcodeValue} not found`);
  await client.query('UPDATE items SET status = $1, current_site_id = $2 WHERE id = $3', [disposition, siteId, item.id]);
  return { item, materialId: item.material_id };
}

async function resolveNewMaterial(client, barcodeValue, materialId, siteId) {
  if (!barcodeValue) return { item: null, materialId };
  const { rows } = await client.query('SELECT * FROM items WHERE barcode_value = $1', [barcodeValue]);
  const item = rows[0];
  if (!item) throw new Error(`New material barcode ${barcodeValue} not found`);
  if (item.status !== 'IN_REGION' && item.status !== 'IN_ZONE' && item.status !== 'IN_SITE') {
    throw new Error(`New material ${barcodeValue} is not available for installation (status: ${item.status})`);
  }
  await client.query("UPDATE items SET status = 'CONSUMED', current_site_id = $1 WHERE id = $2", [siteId, item.id]);
  return { item, materialId: item.material_id };
}

async function recordReplacement(user, body) {
  const { old_barcode_value, old_serial_number, new_barcode_value, new_serial_number, old_material_id, new_material_id,
    site_id, region_id, zone_id, disposition, reference_requisition_id, oms_ticket_number, oms_number, notes, installed_location } = body;
  const oldCode = old_barcode_value || old_serial_number;
  const newCode = new_barcode_value || new_serial_number;
  const targetSiteId = site_id || user.siteId;
  const ticketVal = (oms_ticket_number || oms_number || '').trim();

  if (!targetSiteId) throw Object.assign(new Error('site_id is required'), { status: 400 });
  const assetLoc = (installed_location || '').trim();
  if (!assetLoc && (!notes || !notes.includes('Asset Description'))) {
    throw Object.assign(new Error('Asset Description (installed_location) is required'), { status: 400 });
  }

  let finalNotes = notes || null;
  if (assetLoc && (!finalNotes || !finalNotes.includes(assetLoc))) {
    finalNotes = finalNotes ? `[Asset Description: ${assetLoc}] ${finalNotes}` : `[Asset Description: ${assetLoc}]`;
  }
  if (ticketVal && (!finalNotes || !finalNotes.includes(ticketVal))) {
    finalNotes = finalNotes ? `[OMS Ticket: ${ticketVal}] ${finalNotes}` : `[OMS Ticket: ${ticketVal}]`;
  }

  let effectiveDisposition = disposition;
  if (disposition === 'SCRAP' || disposition === 'PHYSICALLY_DAMAGED') {
    effectiveDisposition = 'SCRAP_PENDING_APPROVAL';
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
    const oldMaterial = await resolveOldMaterial(client, oldCode, old_material_id, targetSiteId, effectiveDisposition);
    const newMaterial = await resolveNewMaterial(client, newCode, new_material_id, targetSiteId);
    if (!oldMaterial.materialId) throw new Error('old_barcode_value or old_material_id is required');
    if (!newMaterial.materialId) throw new Error('new_barcode_value or new_material_id is required');

    let reqId = reference_requisition_id || null;
    if (!reqId && ticketVal) {
      const { rows: reqRows } = await client.query('SELECT id FROM requisitions WHERE oms_ticket_number = $1 OR id::text = $1', [ticketVal]);
      if (reqRows[0]) reqId = reqRows[0].id;
    }

    const { rows } = await client.query(
      `INSERT INTO replacements (old_item_id, new_item_id, old_material_id, new_material_id, site_id, region_id, disposition, reference_requisition_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [oldMaterial.item?.id || null, newMaterial.item?.id || null, oldMaterial.materialId, newMaterial.materialId,
        targetSiteId, targetRegionId, effectiveDisposition, reqId, finalNotes, user.id]
    );
    await client.query(
      `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, from_region_id, to_site_id, reference_requisition_id, created_by, notes)
       VALUES ('CONSUME', $1, $2, 1, 'REGION', 'SITE', $3, $4, $5, $6, $7)`,
      [newMaterial.materialId, newMaterial.item?.id || null, targetRegionId, targetSiteId, reqId, user.id, `Installed to replace material at site (${effectiveDisposition} old unit)${assetLoc ? ` [Location: ${assetLoc}]` : ''}`]
    );
    await client.query('COMMIT');
    inTransaction = false;

    const { rows: replacementRows } = await pool.query('SELECT * FROM replacements WHERE id = $1', [rows[0].id]);
    return replacementRows[0];
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function markRepaired(user, { replacement_id, destination_type, region_id, zone_id, notes }) {
  if (!replacement_id) throw new Error('Replacement record ID is required');

  const destType = (destination_type === 'HO') ? 'HO' : 'REGION';
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const { rows: repRows } = await client.query('SELECT * FROM replacements WHERE id = $1', [replacement_id]);
    const rep = repRows[0];
    if (!rep) throw new Error('Replacement record not found');

    const repRegionId = rep.region_id || rep.zone_id;
    const targetRegionId = (destType === 'REGION') ? (region_id || zone_id ? Number(region_id || zone_id) : Number(repRegionId)) : null;

    await client.query('BEGIN');
    inTransaction = true;

    if (rep.old_item_id) {
      const newStatus = (destType === 'HO') ? 'IN_HO' : 'IN_REGION';
      await client.query(
        'UPDATE items SET status = $1, current_region_id = $2, current_site_id = NULL WHERE id = $3',
        [newStatus, targetRegionId, rep.old_item_id]
      );
    } else {
      await addStock(client, rep.old_material_id, destType, targetRegionId, null, 1);
    }

    const txType = (destType === 'HO') ? 'IN' : 'IN_REGION';
    const repairNote = notes ? `[Repaired to ${destType} Stock] ${notes}` : `Repaired material restored to ${destType} stock`;
    await client.query(
      `INSERT INTO transactions (transaction_type, material_id, item_id, quantity, from_location_type, to_location_type, from_region_id, from_site_id, to_region_id, created_by, notes)
       VALUES ($1, $2, $3, 1, 'SITE', $4, $5, $6, $7, $8, $9)`,
      [txType, rep.old_material_id, rep.old_item_id || null, destType, repRegionId, rep.site_id, targetRegionId, user.id, repairNote]
    );

    const updatedNotes = rep.notes ? `${rep.notes} | [Repaired & Restored to ${destType} Stock]` : `[Repaired & Restored to ${destType} Stock]`;
    await client.query(
      "UPDATE replacements SET disposition = 'REPAIRED_IN_STOCK', notes = $1 WHERE id = $2",
      [updatedNotes, replacement_id]
    );

    await client.query('COMMIT');
    inTransaction = false;

    return { message: `Material marked as repaired and restored to ${destType} stock successfully` };
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function approveScrap(user, replacementId, eWaste) {
  if (!['super_admin', 'region_admin', 'zone_admin'].includes(user.role)) {
    throw Object.assign(new Error('Only Region Admins and Super Admins can approve scrap materials'), { status: 403 });
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    const { rows: repRows } = await client.query('SELECT * FROM replacements WHERE id = $1', [replacementId]);
    const rep = repRows[0];
    if (!rep) throw new Error('Replacement record not found');
    const repRegionId = rep.region_id || rep.zone_id;
    if (!canActOnRegion(user, repRegionId)) {
      throw Object.assign(new Error('You do not have permission to approve scrap for this region'), { status: 403 });
    }

    await client.query('BEGIN');
    inTransaction = true;

    if (rep.old_item_id) {
      await client.query("UPDATE items SET status = 'SCRAP' WHERE id = $1", [rep.old_item_id]);
    }

    const eWasteTag = eWaste ? ` | E-Waste Release: ${eWaste}` : '';
    const updatedNotes = rep.notes
      ? `${rep.notes} | [Scrap Approved by ${user.full_name} (${user.role})${eWasteTag}]`
      : `[Scrap Approved by ${user.full_name} (${user.role})${eWasteTag}]`;

    await client.query(
      "UPDATE replacements SET disposition = 'SCRAP', notes = $1 WHERE id = $2",
      [updatedNotes, replacementId]
    );

    await client.query('COMMIT');
    inTransaction = false;
    return { message: 'Scrap material request approved successfully' };
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rejectScrap(user, replacementId, reason) {
  if (!['super_admin', 'region_admin', 'zone_admin'].includes(user.role)) {
    throw Object.assign(new Error('Only Region Admins and Super Admins can reject scrap requests'), { status: 403 });
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    const { rows: repRows } = await client.query('SELECT * FROM replacements WHERE id = $1', [replacementId]);
    const rep = repRows[0];
    if (!rep) throw new Error('Replacement record not found');
    const repRegionId = rep.region_id || rep.zone_id;
    if (!canActOnRegion(user, repRegionId)) {
      throw Object.assign(new Error('You do not have permission to act on this region'), { status: 403 });
    }

    await client.query('BEGIN');
    inTransaction = true;

    if (rep.old_item_id) {
      await client.query("UPDATE items SET status = 'REPAIRABLE' WHERE id = $1", [rep.old_item_id]);
    }

    const rejectMsg = reason ? `Reason: ${reason}` : 'No reason provided';
    const updatedNotes = rep.notes
      ? `${rep.notes} | [Scrap Rejected by ${user.full_name}: ${rejectMsg}]`
      : `[Scrap Rejected by ${user.full_name}: ${rejectMsg}]`;

    await client.query(
      "UPDATE replacements SET disposition = 'SCRAP_REJECTED', notes = $1 WHERE id = $2",
      [updatedNotes, replacementId]
    );

    await client.query('COMMIT');
    inTransaction = false;
    return { message: 'Scrap material request rejected' };
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordReplacement, markRepaired, approveScrap, rejectScrap };
