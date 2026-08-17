CREATE TYPE user_role AS ENUM ('super_admin', 'region_admin', 'site_engineer');
CREATE TYPE po_destination AS ENUM ('HO', 'REGION');
CREATE TYPE po_entry_mode AS ENUM ('EXTRACTED', 'MANUAL');
CREATE TYPE po_status AS ENUM ('UPLOADED', 'EXTRACTED', 'APPROVED', 'REJECTED', 'CONFIRMED');
CREATE TYPE item_status AS ENUM ('IN_HO', 'IN_TRANSIT_TO_REGION', 'IN_REGION', 'IN_TRANSIT_TO_SITE', 'IN_SITE', 'CONSUMED', 'REPAIRABLE', 'SCRAP', 'PHYSICALLY_DAMAGED', 'WARRANTY_RETURN', 'MISSING_NOT_FOUND', 'MISSING', 'SCRAP_PENDING_APPROVAL', 'SCRAP_REJECTED');
CREATE TYPE stock_location_type AS ENUM ('HO', 'REGION', 'SITE');
CREATE TYPE movement_location_type AS ENUM ('HO', 'REGION', 'SITE', 'SUPPLIER');
CREATE TYPE transaction_type AS ENUM ('IN', 'IN_REGION', 'DISPATCH_HR', 'RECEIVE_R', 'DISPATCH_RE', 'OUT', 'CONSUME', 'RETURN');
CREATE TYPE requisition_status AS ENUM ('PENDING', 'PARTIAL', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');
CREATE TYPE disposition_type AS ENUM ('REPAIRABLE', 'SCRAP', 'PHYSICALLY_DAMAGED', 'WARRANTY_RETURN', 'MISSING_NOT_FOUND', 'MISSING', 'REPAIRED_IN_STOCK', 'SCRAP_PENDING_APPROVAL', 'SCRAP_REJECTED');

CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE regions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    code VARCHAR(10) NOT NULL UNIQUE,
    is_ho BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE sites (
    id SERIAL PRIMARY KEY,
    region_id INT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    address VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role user_role NOT NULL DEFAULT 'site_engineer',
    region_id INT REFERENCES regions(id) ON DELETE SET NULL, 
    site_id INT REFERENCES sites(id) ON DELETE SET NULL,  
    phone_number NUMERIC(12),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_phone_format CHECK (phone_number IS NULL OR (phone_number >= 100000000000 AND phone_number <= 999999999999))
);

CREATE TABLE materials (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(100),
    unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
    price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    min_stock_level INT NOT NULL DEFAULT 0,
    is_serialized BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
    id SERIAL PRIMARY KEY,
    po_number VARCHAR(100) NOT NULL UNIQUE,
    destination_type po_destination NOT NULL DEFAULT 'HO',
    region_id INT REFERENCES regions(id) ON DELETE SET NULL, 
    entry_mode po_entry_mode NOT NULL DEFAULT 'EXTRACTED',
    status po_status NOT NULL DEFAULT 'UPLOADED',
    uploaded_by INT NOT NULL REFERENCES users(id),
    notes VARCHAR(500),
    reject_reason VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMP
);

CREATE TABLE po_items (
    id SERIAL PRIMARY KEY,
    po_id INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    material_id INT REFERENCES materials(id), 
    material_name_raw VARCHAR(255) NOT NULL, 
    quantity DECIMAL(12,2) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    line_total DECIMAL(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    material_id INT NOT NULL REFERENCES materials(id),
    barcode_value VARCHAR(150) NOT NULL UNIQUE, 
    po_item_id INT REFERENCES po_items(id),
    status item_status NOT NULL DEFAULT 'IN_HO',
    current_region_id INT REFERENCES regions(id) ON DELETE SET NULL,
    current_site_id INT REFERENCES sites(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_levels (
    id SERIAL PRIMARY KEY,
    material_id INT NOT NULL REFERENCES materials(id),
    location_type stock_location_type NOT NULL,
    region_id INT REFERENCES regions(id) ON DELETE CASCADE,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (material_id, location_type, region_id, site_id)
);
CREATE TRIGGER stock_levels_set_updated_at BEFORE UPDATE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    transaction_type transaction_type NOT NULL,
    material_id INT NOT NULL REFERENCES materials(id),
    item_id INT REFERENCES items(id), 
    quantity DECIMAL(12,2) NOT NULL,
    from_location_type movement_location_type,
    from_region_id INT REFERENCES regions(id),
    from_site_id INT REFERENCES sites(id),
    to_location_type movement_location_type,
    to_region_id INT REFERENCES regions(id),
    to_site_id INT REFERENCES sites(id),
    reference_po_id INT REFERENCES purchase_orders(id),
    reference_requisition_id INT,
    notes VARCHAR(500),
    created_by INT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE requisitions (
    id SERIAL PRIMARY KEY,
    oms_ticket_number VARCHAR(100) NOT NULL,
    region_id INT NOT NULL REFERENCES regions(id),
    site_id INT NOT NULL REFERENCES sites(id),
    material_id INT NOT NULL REFERENCES materials(id),
    quantity_requested DECIMAL(12,2) NOT NULL,
    quantity_fulfilled DECIMAL(12,2) NOT NULL DEFAULT 0,
    status requisition_status NOT NULL DEFAULT 'PENDING',
    requested_by INT NOT NULL REFERENCES users(id),
    reject_reason VARCHAR(500),
    notes VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TRIGGER requisitions_set_updated_at BEFORE UPDATE ON requisitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE transactions ADD CONSTRAINT fk_transactions_requisition
  FOREIGN KEY (reference_requisition_id) REFERENCES requisitions(id);

CREATE TABLE replacements (
    id SERIAL PRIMARY KEY,
    old_item_id INT REFERENCES items(id),
    new_item_id INT REFERENCES items(id),
    old_material_id INT NOT NULL REFERENCES materials(id), 
    new_material_id INT NOT NULL REFERENCES materials(id),
    site_id INT NOT NULL REFERENCES sites(id),
    region_id INT NOT NULL REFERENCES regions(id),
    disposition disposition_type NOT NULL,
    reference_requisition_id INT REFERENCES requisitions(id),
    notes VARCHAR(500),
    created_by INT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE consumptions (
    id SERIAL PRIMARY KEY,
    material_id INT NOT NULL REFERENCES materials(id),
    item_id INT REFERENCES items(id),
    quantity DECIMAL(12,2) NOT NULL,
    site_id INT NOT NULL REFERENCES sites(id),
    region_id INT NOT NULL REFERENCES regions(id),
    installed_location VARCHAR(255), 
    reference_replacement_id INT REFERENCES replacements(id),
    reference_requisition_id INT REFERENCES requisitions(id),
    created_by INT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_material ON items(material_id);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_region ON items(current_region_id);
CREATE INDEX idx_items_site ON items(current_site_id);
CREATE INDEX idx_sites_region ON sites(region_id);
CREATE INDEX idx_users_region ON users(region_id);
CREATE INDEX idx_users_site ON users(site_id);
CREATE INDEX idx_po_items_po ON po_items(po_id);
CREATE INDEX idx_po_items_material ON po_items(material_id);
CREATE INDEX idx_transactions_material ON transactions(material_id);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_from_reg ON transactions(from_region_id);
CREATE INDEX idx_transactions_to_reg ON transactions(to_region_id);
CREATE INDEX idx_transactions_from_site ON transactions(from_site_id);
CREATE INDEX idx_transactions_to_site ON transactions(to_site_id);
CREATE INDEX idx_requisitions_status ON requisitions(status);
CREATE INDEX idx_requisitions_region ON requisitions(region_id);
CREATE INDEX idx_requisitions_site ON requisitions(site_id);
CREATE INDEX idx_stock_material_loc ON stock_levels(material_id, location_type);
CREATE INDEX idx_stock_region ON stock_levels(region_id);
CREATE INDEX idx_stock_site ON stock_levels(site_id);
CREATE INDEX idx_consumptions_site ON consumptions(site_id);
CREATE INDEX idx_consumptions_region ON consumptions(region_id);
CREATE INDEX idx_replacements_site ON replacements(site_id);
CREATE INDEX idx_replacements_region ON replacements(region_id);