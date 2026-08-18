const pool = require('../config/db');
const { canActOnRegion } = require('../middleware/auth');
const { extractFromPdf } = require('../utils/pdfExtractor');
const { addStock } = require('./stockService');

function canManagePO(user, po) {
  if (user.role === 'super_admin') return true;
  if (!['region_admin', 'zone_admin'].includes(user.role) || po.status === 'CONFIRMED') return false;
  const isRegionDest = ['REGION', 'ZONE'].includes(po.destination_type);
  const poRegionId = po.region_id || po.zone_id;
  return po.entry_mode === 'MANUAL' && isRegionDest && canActOnRegion(user, poRegionId);
}

async function autoResolveMaterial(dbOrClient, rawName) {
  const cleanName = (rawName || '').trim().replace(/\s+/g, ' ') || 'PO Material Item';

  const { rows: exact } = await dbOrClient.query(
    'SELECT id FROM materials WHERE LOWER(name) = LOWER($1) LIMIT 1',
    [cleanName]
  );
  if (exact[0]) return exact[0].id;

  const { rows: subMatch } = await dbOrClient.query(
    `SELECT id FROM materials
     WHERE (LENGTH(name) >= 3 AND LOWER($1) LIKE '%' || LOWER(name) || '%')
        OR (LENGTH($1) >= 3 AND LOWER(name) LIKE '%' || LOWER($1) || '%')
     ORDER BY LENGTH(name) DESC LIMIT 1`,
    [cleanName]
  );
  if (subMatch[0]) return subMatch[0].id;

  const tokens = cleanName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['pcs', 'unit', 'units', 'nos', 'qty', 'item', 'type'].includes(w.toLowerCase()));

  if (tokens.length >= 2) {
    const conditions = tokens.map((_, idx) => `LOWER(name) LIKE $${idx + 1}`);
    const values = tokens.map(t => `%${t.toLowerCase()}%`);

    const { rows: tokenMatches } = await dbOrClient.query(
      `SELECT id FROM materials WHERE ${conditions.join(' AND ')} ORDER BY LENGTH(name) ASC LIMIT 1`,
      values
    );
    if (tokenMatches[0]) return tokenMatches[0].id;
  }

  return null;
}


async function createFromUpload(user, file, destinationType, regionId, zoneId) {
  const source = file.buffer || file.path;
  const extracted = await extractFromPdf(source);
  let poNumber = extracted.po_number || `PO-PDF-${Date.now().toString().slice(-6)}`;
  const targetRegionId = regionId || zoneId;
  const normDest = ['REGION', 'ZONE'].includes(destinationType) ? 'REGION' : 'HO';

  const { rows: existing } = await pool.query('SELECT id FROM purchase_orders WHERE po_number = $1', [poNumber]);
  if (existing[0]) {
    poNumber = `${poNumber}-${Date.now().toString().slice(-4)}`;
  }

  const { rows } = await pool.query(
    `INSERT INTO purchase_orders (po_number, destination_type, region_id, entry_mode, status, uploaded_by)
     VALUES ($1, $2, $3, 'EXTRACTED', 'EXTRACTED', $4) RETURNING id`,
    [poNumber, normDest, normDest === 'REGION' ? targetRegionId : null, user.id]
  );
  const poId = rows[0].id;

  for (const item of extracted.line_items) {
    const matId = await autoResolveMaterial(pool, item.material_name_raw || item.material_name);
    await pool.query(
      'INSERT INTO po_items (po_id, material_id, material_name_raw, quantity, unit_price) VALUES ($1, $2, $3, $4, $5)',
      [poId, matId, item.material_name_raw, item.quantity, item.unit_price]
    );
  }

  const note = extracted.line_items.length === 0
    ? 'No line items could be auto-detected. Please add them manually below before confirming.'
    : 'Materials automatically fetched from PO.';
  return { poId, note };
}

async function createManual(user, poNumber, regionId, notes, items) {
  const targetRegionId = regionId || zoneId;
  const { rows: existing } = await pool.query('SELECT id FROM purchase_orders WHERE po_number = $1', [poNumber]);
  if (existing[0]) {
    const err = new Error(`PO number ${poNumber} already exists`);
    err.status = 409;
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO purchase_orders (po_number, destination_type, region_id, entry_mode, status, uploaded_by, notes)
     VALUES ($1, 'REGION', $2, 'MANUAL', 'EXTRACTED', $3, $4) RETURNING id`,
    [poNumber, targetRegionId, user.id, notes]
  );
  const poId = rows[0].id;

  for (const item of items) {
    const rawName = item.material_name || item.material_name_raw || 'Unnamed material';
    const matId = item.material_id || await autoResolveMaterial(pool, rawName);
    await pool.query(
      'INSERT INTO po_items (po_id, material_id, material_name_raw, quantity, unit_price) VALUES ($1, $2, $3, $4, $5)',
      [poId, matId, rawName, item.quantity, item.unit_price || 0]
    );
  }
  return poId;
}

async function generateAscendingBarcodes(client, materialId, poId, quantity, customPrefix, startNumInput, padLenInput) {
  const prefix = (customPrefix !== undefined && customPrefix !== null && customPrefix !== '') ? customPrefix : `MAT${materialId}-PO${poId}-`;

  let startSeq;
  if (startNumInput !== undefined && startNumInput !== null && !isNaN(parseInt(startNumInput, 10))) {
    startSeq = parseInt(startNumInput, 10);
  } else {
    const { rows } = await client.query(
      `SELECT barcode_value FROM items WHERE barcode_value LIKE $1 ORDER BY id DESC LIMIT 200`,
      [`${prefix}%`]
    );
    let maxSeq = 0;
    for (const r of rows) {
      const numPart = r.barcode_value.replace(prefix, '');
      const num = parseInt(numPart, 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
    startSeq = maxSeq + 1;
  }

  const qtyInt = Math.round(quantity);
  const userPad = (padLenInput && !isNaN(parseInt(padLenInput, 10))) ? parseInt(padLenInput, 10) : 4;
  const barcodes = [];
  for (let i = 0; i < qtyInt; i++) {
    const seqNum = startSeq + i;
    const padLen = Math.max(userPad, String(seqNum).length);
    barcodes.push(`${prefix}${String(seqNum).padStart(padLen, '0')}`);
  }
  return barcodes;
}

async function postTrackedItems(client, item, locationType, region, poId, serialsInput) {
  let serials = [];
  if (Array.isArray(serialsInput) && serialsInput.length === Math.round(item.quantity)) {
    serials = serialsInput;
  } else if (typeof serialsInput === 'object' && serialsInput && Array.isArray(serialsInput.list) && serialsInput.list.length === Math.round(item.quantity)) {
    serials = serialsInput.list;
  } else {
    const prefix = (typeof serialsInput === 'object' && serialsInput?.prefix !== undefined) ? serialsInput.prefix : null;
    const startNum = (typeof serialsInput === 'object' && serialsInput?.startNum !== undefined) ? serialsInput.startNum : null;
    const padLen = (typeof serialsInput === 'object' && serialsInput?.padLen !== undefined) ? serialsInput.padLen : null;
    serials = await generateAscendingBarcodes(client, item.material_id, poId, item.quantity, prefix, startNum, padLen);
  }

  const isRegion = ['REGION', 'ZONE'].includes(locationType);
  const locType = isRegion ? 'REGION' : 'HO';
  const itemStatus = isRegion ? 'IN_REGION' : 'IN_HO';

  for (const sn of serials) {
    await client.query(
      'INSERT INTO items (material_id, barcode_value, po_item_id, status, current_region_id) VALUES ($1, $2, $3, $4, $5)',
      [item.material_id, sn, item.id, itemStatus, isRegion ? region : null]
    );
  }

  await addStock(client, item.material_id, locType, isRegion ? region : null, null, item.quantity);
  return serials;
}

async function confirmPurchaseOrder(user, poId, serialsByItemId = {}) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [poId]);
    const po = poRows[0];
    if (!po) throw Object.assign(new Error('Purchase order not found'), { status: 404 });
    if (po.status === 'CONFIRMED') throw Object.assign(new Error('Already confirmed'), { status: 400 });
    if (!canManagePO(user, po)) {
      throw Object.assign(new Error('You do not have permission to confirm this purchase order'), { status: 403 });
    }

    await client.query('BEGIN');
    inTransaction = true;

    const { rows: poItems } = await client.query('SELECT * FROM po_items WHERE po_id = $1', [poId]);

    for (const item of poItems) {
      if (!item.material_id) {
        const matId = await autoResolveMaterial(client, item.material_name_raw);
        await client.query('UPDATE po_items SET material_id = $1 WHERE id = $2', [matId, item.id]);
        item.material_id = matId;
      }
    }

    const { rows: items } = await client.query(
      'SELECT poi.*, m.name AS matched_material_name FROM po_items poi JOIN materials m ON poi.material_id = m.id WHERE poi.po_id = $1',
      [poId]
    );
    if (items.length === 0) {
      throw Object.assign(new Error('No line items found for this purchase order'), { status: 400 });
    }

    const locationType = ['REGION', 'ZONE'].includes(po.destination_type) ? 'REGION' : 'HO';
    const txType = locationType === 'HO' ? 'IN' : 'IN_REGION';
    const targetRegionId = po.region_id || po.zone_id;

    for (const item of items) {
      const serialsInput = serialsByItemId[item.id] || serialsByItemId[String(item.id)];
      const serials = await postTrackedItems(client, item, locationType, targetRegionId, po.id, serialsInput);

      await client.query(
        `INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, to_region_id, reference_po_id, created_by, notes)
         VALUES ($1, $2, $3, 'SUPPLIER', $4, $5, $6, $7, $8)`,
        [txType, item.material_id, item.quantity, locationType, locationType === 'REGION' ? targetRegionId : null, po.id, user.id, `Received ${serials.length} barcodes against PO ${po.po_number}`]
      );
    }

    await client.query("UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = now() WHERE id = $1", [poId]);
    await client.query('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [poId]);
  return rows[0];
}

module.exports = { canManagePO, createFromUpload, createManual, confirmPurchaseOrder, autoResolveMaterial };

