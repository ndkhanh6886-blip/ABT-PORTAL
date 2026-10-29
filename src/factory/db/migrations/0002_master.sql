-- Master data: units, items, partners, warehouses and locations.

CREATE SCHEMA IF NOT EXISTS master;

CREATE TABLE master.uom (
  code      text PRIMARY KEY CHECK (code ~ '^[A-Za-zµ0-9%/_-]{1,12}$'),
  name      text NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('MASS', 'VOLUME', 'COUNT', 'AMOUNT', 'OD', 'LENGTH', 'TIME')),
  status    text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE master.item_category (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  parent_id  uuid REFERENCES master.item_category (id),
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);

CREATE TABLE master.item (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  code                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  item_type            text NOT NULL CHECK (item_type IN ('RAW_MATERIAL', 'REAGENT', 'CONSUMABLE', 'COMPONENT', 'SEMI_FINISHED',
                                                          'FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE', 'SPARE_PART')),
  category_id          uuid REFERENCES master.item_category (id),
  base_uom             text NOT NULL REFERENCES master.uom (code),
  tracking             text NOT NULL DEFAULT 'LOT' CHECK (tracking IN ('NONE', 'LOT', 'SERIAL')),
  shelf_life_days      integer CHECK (shelf_life_days > 0),
  open_shelf_life_days integer CHECK (open_shelf_life_days > 0),
  storage_condition    text NOT NULL DEFAULT 'RT' CHECK (storage_condition IN ('RT', '2-8', '-20', '-80')),
  min_stock            numeric(18,6) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  reorder_qty          numeric(18,6) NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0),
  receipt_qc_required  boolean NOT NULL DEFAULT true,
  is_purchasable       boolean NOT NULL DEFAULT true,
  is_saleable          boolean NOT NULL DEFAULT false,
  is_manufacturable    boolean NOT NULL DEFAULT false,
  hazard_class         text,
  kd_item_code         text,            -- product code on the Kinh doanh side (internal orders)
  notes                text,
  status               text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version              integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           integer,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           integer
);
CREATE INDEX ON master.item (category_id);
CREATE INDEX ON master.item (item_type, status);
CREATE UNIQUE INDEX item_kd_code_uq ON master.item (kd_item_code) WHERE kd_item_code IS NOT NULL;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX item_name_trgm ON master.item USING gin (name gin_trgm_ops);

-- Conversion to the base unit; item_id NULL = valid for every item (e.g. mL → µL).
CREATE TABLE master.uom_conversion (
  id       uuid PRIMARY KEY DEFAULT uuidv7(),
  from_uom text NOT NULL REFERENCES master.uom (code),
  to_uom   text NOT NULL REFERENCES master.uom (code),
  factor   numeric(24,12) NOT NULL CHECK (factor > 0),
  item_id  uuid REFERENCES master.item (id),
  CHECK (from_uom <> to_uom)
);
CREATE UNIQUE INDEX uom_conversion_uq ON master.uom_conversion (from_uom, to_uom, item_id) NULLS NOT DISTINCT;

CREATE TABLE master.item_substitute (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  item_id            uuid NOT NULL REFERENCES master.item (id),
  substitute_item_id uuid NOT NULL REFERENCES master.item (id),
  ratio              numeric(18,6) NOT NULL DEFAULT 1 CHECK (ratio > 0),  -- substitute qty per 1 base unit of item
  priority           integer NOT NULL DEFAULT 1,
  allowed_modules    text[] NOT NULL DEFAULT '{}',                       -- empty = every module
  change_request_id  uuid,                                               -- QA approval (qms, later phase)
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  CHECK (item_id <> substitute_item_id),
  UNIQUE (item_id, substitute_item_id)
);

CREATE TABLE master.partner (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  tax_code         text,
  is_supplier      boolean NOT NULL DEFAULT false,
  is_customer      boolean NOT NULL DEFAULT false,
  is_subcontractor boolean NOT NULL DEFAULT false,
  is_internal      boolean NOT NULL DEFAULT false,   -- "ABT – Khối Kinh doanh"
  address          text,
  payment_terms    text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       integer,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       integer,
  CHECK (is_supplier OR is_customer OR is_subcontractor OR is_internal)
);
CREATE UNIQUE INDEX partner_tax_code_uq ON master.partner (tax_code) WHERE tax_code IS NOT NULL;

CREATE TABLE master.partner_contact (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id uuid NOT NULL REFERENCES master.partner (id),
  name       text NOT NULL,
  phone      text,
  email      text,
  role       text,
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
CREATE INDEX ON master.partner_contact (partner_id);

CREATE TABLE master.item_supplier (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  item_id            uuid NOT NULL REFERENCES master.item (id),
  partner_id         uuid NOT NULL REFERENCES master.partner (id),
  supplier_item_code text,
  lead_time_days     integer CHECK (lead_time_days >= 0),
  moq                numeric(18,6) CHECK (moq > 0),
  last_price         numeric(18,2) CHECK (last_price >= 0),
  currency           text NOT NULL DEFAULT 'VND',
  UNIQUE (item_id, partner_id)
);

CREATE TABLE master.warehouse (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  code              text NOT NULL UNIQUE,
  name              text NOT NULL,
  owner_org_unit_id uuid NOT NULL REFERENCES core.org_unit (id),
  purpose           text NOT NULL CHECK (purpose IN ('RAW', 'FINISHED', 'QUARANTINE', 'RD', 'OLIGO', 'DEVICE_PARTS')),
  access_mode       text NOT NULL DEFAULT 'OWNER_ONLY' CHECK (access_mode IN ('OWNER_ONLY', 'SHARED_READ')),
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        integer
);
CREATE INDEX ON master.warehouse (owner_org_unit_id);

-- Warehouse → cabinet / freezer → shelf → bin.
CREATE TABLE master.location (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  warehouse_id          uuid NOT NULL REFERENCES master.warehouse (id),
  parent_id             uuid REFERENCES master.location (id),
  code                  text NOT NULL,
  name                  text NOT NULL,
  temperature_condition text NOT NULL DEFAULT 'RT' CHECK (temperature_condition IN ('RT', '2-8', '-20', '-80')),
  is_quarantine         boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version               integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            integer,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            integer,
  UNIQUE (warehouse_id, code)
);
CREATE INDEX ON master.location (parent_id);

INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('ITEM',    'Mã vật tư (khi không nhập tay)', 'VT{NNNNN}'),
  ('PARTNER', 'Mã đối tác (khi không nhập tay)', 'DT{NNNN}');

-- Standard units (configuration, not demo data).
INSERT INTO master.uom (code, name, dimension) VALUES
  ('g', 'gam', 'MASS'), ('mg', 'miligam', 'MASS'), ('µg', 'microgam', 'MASS'), ('kg', 'kilogam', 'MASS'),
  ('L', 'lít', 'VOLUME'), ('mL', 'mililít', 'VOLUME'), ('µL', 'microlít', 'VOLUME'),
  ('mol', 'mol', 'AMOUNT'), ('µmol', 'micromol', 'AMOUNT'), ('nmol', 'nanomol', 'AMOUNT'),
  ('OD', 'OD260', 'OD'),
  ('pcs', 'cái', 'COUNT'), ('box', 'hộp', 'COUNT'), ('kit', 'bộ kit', 'COUNT'), ('test', 'test', 'COUNT'),
  ('tube', 'ống', 'COUNT'), ('bottle', 'chai', 'COUNT'), ('vial', 'lọ', 'COUNT'), ('plate', 'đĩa', 'COUNT'),
  ('set', 'bộ', 'COUNT'), ('m', 'mét', 'LENGTH');

INSERT INTO master.uom_conversion (from_uom, to_uom, factor) VALUES
  ('kg', 'g', 1000), ('g', 'mg', 1000), ('mg', 'µg', 1000), ('kg', 'mg', 1000000), ('g', 'µg', 1000000),
  ('L', 'mL', 1000), ('mL', 'µL', 1000), ('L', 'µL', 1000000),
  ('mol', 'µmol', 1000000), ('µmol', 'nmol', 1000), ('mol', 'nmol', 1000000000);
