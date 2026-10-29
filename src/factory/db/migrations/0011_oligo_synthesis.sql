-- Lab equipment (minimal, docs/nha-may/01 §3) and Oligo synthesis batches (§11, 02 §9.3).

CREATE SCHEMA IF NOT EXISTS asset;

CREATE TABLE asset.asset (
  id                        uuid PRIMARY KEY DEFAULT uuidv7(),
  code                      text NOT NULL UNIQUE,
  name                      text NOT NULL,
  asset_type                text NOT NULL CHECK (asset_type IN ('SYNTHESIZER', 'HPLC', 'PCR', 'CENTRIFUGE', 'FREEZER', 'BALANCE', 'SPECTROPHOTOMETER', 'MASS_SPEC', 'OTHER')),
  manufacturer              text,
  model                     text,
  serial_no                 text,
  owner_org_unit_id         uuid NOT NULL REFERENCES core.org_unit (id),
  calibration_interval_days integer CHECK (calibration_interval_days > 0),
  next_calibration_due      date,
  status                    text NOT NULL DEFAULT 'IN_SERVICE' CHECK (status IN ('IN_SERVICE', 'UNDER_MAINTENANCE', 'OUT_OF_CALIBRATION', 'RETIRED')),
  version                   integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                integer,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                integer
);
CREATE INDEX ON asset.asset (owner_org_unit_id, asset_type);

CREATE TABLE oligo.synthesizer (
  asset_id         uuid PRIMARY KEY REFERENCES asset.asset (id),
  column_positions integer NOT NULL CHECK (column_positions BETWEEN 1 AND 384),
  supported_scales text[] NOT NULL DEFAULT '{}'
);

-- Consumption rules (OligoFlow's model): PER_CYCLE × couplings of each sequence (ancillary reagents),
-- PER_COUPLING for the base amidites, PER_MOD for modification / inline-modified amidites.
-- A rule is usable once mapped to an inventory item; quantities are in `uom` and converted to the item's base unit.
CREATE TABLE oligo.reagent_rule (
  role       text PRIMARY KEY,
  name       text NOT NULL,
  basis      text NOT NULL CHECK (basis IN ('PER_CYCLE', 'PER_COUPLING', 'PER_MOD')),
  qty        numeric(12,4) NOT NULL CHECK (qty >= 0),
  uom        text NOT NULL REFERENCES master.uom (code),
  item_id    uuid REFERENCES master.item (id),
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version    integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);
INSERT INTO oligo.reagent_rule (role, name, basis, qty, uom) VALUES
  ('DEBLOCK', 'Deblock (detritylation)', 'PER_CYCLE', 1.2, 'mL'),
  ('CAP_A', 'Cap A', 'PER_CYCLE', 0.6, 'mL'),
  ('CAP_B', 'Cap B', 'PER_CYCLE', 0.6, 'mL'),
  ('OXIDATION', 'Oxidizer', 'PER_CYCLE', 0.8, 'mL'),
  ('ACTIVATOR', 'Activator', 'PER_CYCLE', 0.8, 'mL'),
  ('ACN', 'Acetonitrile (wash)', 'PER_CYCLE', 3.0, 'mL'),
  ('dA', 'DNA amidite dA', 'PER_COUPLING', 0.15, 'mL'),
  ('dC', 'DNA amidite dC', 'PER_COUPLING', 0.15, 'mL'),
  ('dG', 'DNA amidite dG', 'PER_COUPLING', 0.15, 'mL'),
  ('dT', 'DNA amidite dT', 'PER_COUPLING', 0.15, 'mL'),
  ('rA', 'RNA amidite rA', 'PER_COUPLING', 0.20, 'mL'),
  ('rC', 'RNA amidite rC', 'PER_COUPLING', 0.20, 'mL'),
  ('rG', 'RNA amidite rG', 'PER_COUPLING', 0.20, 'mL'),
  ('rU', 'RNA amidite rU', 'PER_COUPLING', 0.20, 'mL'),
  ('MOD_DEFAULT', 'Amidite modification (mặc định, dùng vật tư gắn ở danh mục modification)', 'PER_MOD', 0.25, 'mL'),
  ('ALKYL', 'Alkyl amidite (thuốc nhuộm không ở đầu 3'')', 'PER_MOD', 0.25, 'mL');

CREATE TABLE oligo.synthesis_batch (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text NOT NULL UNIQUE,
  org_unit_id     uuid NOT NULL REFERENCES core.org_unit (id),
  synthesizer_id  uuid NOT NULL REFERENCES oligo.synthesizer (asset_id),
  program_name    text,
  planned_start   timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  operator_id     integer,
  notes           text,
  status          text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'ABORTED')),
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      integer
);
CREATE INDEX ON oligo.synthesis_batch (org_unit_id, status);

CREATE TABLE oligo.synthesis_position (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  batch_id                uuid NOT NULL REFERENCES oligo.synthesis_batch (id),
  position_no             integer NOT NULL CHECK (position_no > 0),
  sequence_id             uuid NOT NULL REFERENCES oligo.oligo_sequence (id),
  column_lot_id           uuid NOT NULL REFERENCES inv.lot (id),
  couplings               integer NOT NULL CHECK (couplings > 0),
  coupling_efficiency_pct numeric(5,2) CHECK (coupling_efficiency_pct BETWEEN 0 AND 100),
  result                  text CHECK (result IN ('OK', 'FAILED')),
  active                  boolean NOT NULL DEFAULT true,
  UNIQUE (batch_id, position_no)
);
-- a sequence sits in at most one live batch (atomic claim, docs 02 §9.1)
CREATE UNIQUE INDEX synthesis_position_one_live ON oligo.synthesis_position (sequence_id) WHERE active;

CREATE TABLE oligo.synthesis_reagent_use (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  batch_id       uuid NOT NULL REFERENCES oligo.synthesis_batch (id),
  role           text NOT NULL,
  item_id        uuid NOT NULL REFERENCES master.item (id),
  est_qty_base   numeric(18,6) NOT NULL CHECK (est_qty_base >= 0),
  actual_qty_base numeric(18,6) CHECK (actual_qty_base >= 0),
  UNIQUE (batch_id, item_id)
);

INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('ASSET', 'Mã thiết bị', 'TB{NNNN}');
