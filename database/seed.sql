INSERT INTO regions (name, code, is_ho) VALUES
('Head Office', 'HO', TRUE),
('East Region', 'EAST', FALSE),
('West Region', 'WEST', FALSE),
('North Region', 'NORTH', FALSE),
('South Region', 'SOUTH', FALSE);

INSERT INTO sites (region_id, name, address) VALUES
((SELECT id FROM regions WHERE code = 'EAST'), 'East Site 1 - Kolkata Highway', 'Kolkata, WB'),
((SELECT id FROM regions WHERE code = 'EAST'), 'East Site 2 - Bhubaneswar Mall', 'Bhubaneswar, OD'),
((SELECT id FROM regions WHERE code = 'WEST'), 'West Site 1 - Mumbai Expressway', 'Mumbai, MH'),
((SELECT id FROM regions WHERE code = 'NORTH'), 'North Site 1 - Delhi Ring Road', 'New Delhi, DL'),
((SELECT id FROM regions WHERE code = 'SOUTH'), 'South Site 1 - Bengaluru Tech Park', 'Bengaluru, KA');


INSERT INTO users (email, password_hash, full_name, role, region_id, site_id, phone_number) VALUES
('admin@chargezone.com', 'PENDING_HASH', 'System Super Admin', 'super_admin', NULL, NULL, 919876543210);

INSERT INTO users (email, password_hash, full_name, role, region_id, site_id, phone_number) VALUES
('east.admin@chargezone.com', 'PENDING_HASH', 'East Region Admin', 'region_admin', (SELECT id FROM regions WHERE code = 'EAST'), NULL, 919876543211),
('west.admin@chargezone.com', 'PENDING_HASH', 'West Region Admin', 'region_admin', (SELECT id FROM regions WHERE code = 'WEST'), NULL, 919876543212),
('north.admin@chargezone.com', 'PENDING_HASH', 'North Region Admin', 'region_admin', (SELECT id FROM regions WHERE code = 'NORTH'), NULL, 919876543213),
('south.admin@chargezone.com', 'PENDING_HASH', 'South Region Admin', 'region_admin', (SELECT id FROM regions WHERE code = 'SOUTH'), NULL, 919876543214),
('ho.admin@chargezone.com', 'PENDING_HASH', 'HO Region Admin', 'region_admin', (SELECT id FROM regions WHERE code = 'HO'), NULL, 919876543215);

INSERT INTO users (email, password_hash, full_name, role, region_id, site_id, phone_number) VALUES
('east.engineer1@chargezone.com', 'PENDING_HASH', 'East Site Engineer (Kolkata)', 'site_engineer',
  (SELECT id FROM regions WHERE code = 'EAST'), (SELECT id FROM sites WHERE name = 'East Site 1 - Kolkata Highway'), 919876543216),
('west.engineer1@chargezone.com', 'PENDING_HASH', 'West Site Engineer (Mumbai)', 'site_engineer',
  (SELECT id FROM regions WHERE code = 'WEST'), (SELECT id FROM sites WHERE name = 'West Site 1 - Mumbai Expressway'), 919876543217),
('north.engineer1@chargezone.com', 'PENDING_HASH', 'North Site Engineer (Delhi)', 'site_engineer',
  (SELECT id FROM regions WHERE code = 'NORTH'), (SELECT id FROM sites WHERE name = 'North Site 1 - Delhi Ring Road'), 919876543218),
('south.engineer1@chargezone.com', 'PENDING_HASH', 'South Site Engineer (Bengaluru)', 'site_engineer',
  (SELECT id FROM regions WHERE code = 'SOUTH'), (SELECT id FROM sites WHERE name = 'South Site 1 - Bengaluru Tech Park'), 919876543219);

INSERT INTO materials (name, category, unit, min_stock_level, is_serialized) VALUES
('AC Charger Unit 7kW', 'Charger', 'pcs', 5, true),
('DC Fast Charger 60kW', 'Charger', 'pcs', 2, true),
('Power Cable 3-core 16sqmm', 'Cable', 'mtr', 200, false),
('MCB 32A', 'Electrical', 'pcs', 20, false),
('RFID Card Reader Module', 'Component', 'pcs', 10, true),
('Earthing Kit', 'Electrical', 'set', 15, false);

INSERT INTO purchase_orders (po_number, destination_type, region_id, entry_mode, status, uploaded_by, confirmed_at) VALUES
('PO-2026-0417', 'HO', NULL, 'EXTRACTED', 'CONFIRMED',
  (SELECT id FROM users WHERE email = 'admin@chargezone.com'), NOW());

INSERT INTO po_items (po_id, material_id, material_name_raw, quantity, unit_price) VALUES
((SELECT id FROM purchase_orders WHERE po_number = 'PO-2026-0417'), (SELECT id FROM materials WHERE name = 'AC Charger Unit 7kW'), 'AC Charger Unit 7kW', 10, 45000.00),
((SELECT id FROM purchase_orders WHERE po_number = 'PO-2026-0417'), (SELECT id FROM materials WHERE name = 'Power Cable 3-core 16sqmm'), 'Power Cable 3-core 16sqmm', 500, 85.50),
((SELECT id FROM purchase_orders WHERE po_number = 'PO-2026-0417'), (SELECT id FROM materials WHERE name = 'MCB 32A'), 'MCB 32A', 50, 220.00);

INSERT INTO purchase_orders (po_number, destination_type, region_id, entry_mode, status, uploaded_by, confirmed_at) VALUES
('PO-2026-0430-EAST', 'REGION', (SELECT id FROM regions WHERE code = 'EAST'), 'MANUAL', 'CONFIRMED',
  (SELECT id FROM users WHERE email = 'east.admin@chargezone.com'), NOW());

INSERT INTO po_items (po_id, material_id, material_name_raw, quantity, unit_price) VALUES
((SELECT id FROM purchase_orders WHERE po_number = 'PO-2026-0430-EAST'), (SELECT id FROM materials WHERE name = 'Earthing Kit'), 'Earthing Kit', 20, 1200.00);

INSERT INTO stock_levels (material_id, location_type, region_id, site_id, quantity) VALUES
((SELECT id FROM materials WHERE name = 'Power Cable 3-core 16sqmm'), 'HO', NULL, NULL, 500),
((SELECT id FROM materials WHERE name = 'MCB 32A'), 'HO', NULL, NULL, 50),
((SELECT id FROM materials WHERE name = 'Earthing Kit'), 'REGION', (SELECT id FROM regions WHERE code = 'EAST'), NULL, 20);

INSERT INTO items (material_id, barcode_value, status, current_region_id) VALUES
((SELECT id FROM materials WHERE name = 'AC Charger Unit 7kW'), 'SN-CHG7-0001', 'IN_HO', NULL),
((SELECT id FROM materials WHERE name = 'AC Charger Unit 7kW'), 'SN-CHG7-0002', 'IN_HO', NULL),
((SELECT id FROM materials WHERE name = 'AC Charger Unit 7kW'), 'SN-CHG7-0003', 'IN_REGION', (SELECT id FROM regions WHERE code = 'EAST'));

INSERT INTO requisitions (oms_ticket_number, region_id, site_id, material_id, quantity_requested, quantity_fulfilled, status, requested_by)
VALUES ('OMS-TICK-EAST-001', (SELECT id FROM regions WHERE code = 'EAST'), (SELECT id FROM sites WHERE name = 'East Site 1 - Kolkata Highway'),
  (SELECT id FROM materials WHERE name = 'AC Charger Unit 7kW'), 1, 0, 'PENDING', (SELECT id FROM users WHERE email = 'east.admin@chargezone.com'));

INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, reference_po_id, created_by, notes) VALUES
('IN', (SELECT id FROM materials WHERE name = 'AC Charger Unit 7kW'), 10, 'SUPPLIER', 'HO',
  (SELECT id FROM purchase_orders WHERE po_number = 'PO-2026-0417'), (SELECT id FROM users WHERE email = 'admin@chargezone.com'), 'Received against PO-2026-0417'),
('IN', (SELECT id FROM materials WHERE name = 'Power Cable 3-core 16sqmm'), 500, 'SUPPLIER', 'HO',
  (SELECT id FROM purchase_orders WHERE po_number = 'PO-2026-0417'), (SELECT id FROM users WHERE email = 'admin@chargezone.com'), 'Received against PO-2026-0417'),
('IN_REGION', (SELECT id FROM materials WHERE name = 'Earthing Kit'), 20, 'SUPPLIER', 'REGION',
  (SELECT id FROM purchase_orders WHERE po_number = 'PO-2026-0430-EAST'), (SELECT id FROM users WHERE email = 'east.admin@chargezone.com'), 'Direct region purchase, East');

INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, to_region_id, created_by, notes)
VALUES ('DISPATCH_HR', (SELECT id FROM materials WHERE name = 'AC Charger Unit 7kW'), 1, 'HO', 'REGION',
  (SELECT id FROM regions WHERE code = 'EAST'), (SELECT id FROM users WHERE email = 'admin@chargezone.com'), 'Dispatched SN-CHG7-0003 to East region');

INSERT INTO transactions (transaction_type, material_id, quantity, from_location_type, to_location_type, from_region_id, to_region_id, created_by, notes)
VALUES ('RECEIVE_R', (SELECT id FROM materials WHERE name = 'AC Charger Unit 7kW'), 1, 'HO', 'REGION', NULL,
  (SELECT id FROM regions WHERE code = 'EAST'), (SELECT id FROM users WHERE email = 'east.admin@chargezone.com'), 'East region confirmed receipt of SN-CHG7-0003');
