-- Phase 4b: Module Phòng Sản xuất Kit (kit schema)
-- Covers Multi-level versioned BOM & Kit Packaging (Boxes -> Components -> Tubes/Bottles),
-- Versioned Routing & Sequential Electronic Batch Record (EBR) with dual e-signatures,
-- FEFO Reservation & Material Consumption Reconciliation, Lot Genealogy (2-way traceability),
-- Immutable COA generation, Partial/Full Rework Orders from NCR, Retain Samples & Stability Studies.

CREATE SCHEMA IF NOT EXISTS kit;

-- 1. BOM (Bill of Materials) with versioning and 1 EFFECTIVE per product
CREATE TABLE kit.bom (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text NOT NULL UNIQUE,
  org_unit_id     uuid NOT NULL REFERENCES core.org_unit (id),
  product_item_id uuid NOT NULL REFERENCES master.item (id),
  bom_version     integer NOT NULL DEFAULT 1 CHECK (bom_version > 0),
  name            text NOT NULL,
  base_qty        numeric(18,6) NOT NULL DEFAULT 1 CHECK (base_qty > 0),
  base_uom        text NOT NULL,
  tests_per_kit   integer NOT NULL DEFAULT 50 CHECK (tests_per_kit > 0),
  shelf_life_days integer NOT NULL DEFAULT 365 CHECK (shelf_life_days > 0),
  qc_spec_id      uuid REFERENCES qms.qc_spec (id),
  notes           text,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'EFFECTIVE', 'OBSOLETE')),
  approved_by     integer,
  approved_at     timestamptz,
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      integer,
  UNIQUE (product_item_id, bom_version)
);
CREATE UNIQUE INDEX kit_bom_one_effective ON kit.bom (product_item_id) WHERE status = 'EFFECTIVE';
CREATE INDEX ON kit.bom (org_unit_id, status);

-- 2. BOM Lines (supports multi-level semi-finished items, box grouping, scrap %, critical flag)
CREATE TABLE kit.bom_line (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  bom_id            uuid NOT NULL REFERENCES kit.bom (id) ON DELETE CASCADE,
  line_no           integer NOT NULL CHECK (line_no > 0),
  component_item_id uuid NOT NULL REFERENCES master.item (id),
  qty_per_base      numeric(18,6) NOT NULL CHECK (qty_per_base > 0),
  uom               text NOT NULL,
  scrap_pct         numeric(6,2) NOT NULL DEFAULT 0 CHECK (scrap_pct >= 0 AND scrap_pct <= 100),
  box_no            integer NOT NULL DEFAULT 1 CHECK (box_no > 0),
  component_role    text NOT NULL DEFAULT 'REAGENT'
                    CHECK (component_role IN ('MASTER_MIX', 'PRIMER_PROBE', 'ENZYME', 'POSITIVE_CONTROL', 'NEGATIVE_CONTROL', 'EXTRACTION_BUFFER', 'PACKAGING', 'SEMI_FINISHED', 'REAGENT')),
  is_critical       boolean NOT NULL DEFAULT true,
  is_bundled        boolean NOT NULL DEFAULT false,
  allow_substitute  boolean NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        integer,
  UNIQUE (bom_id, line_no)
);
CREATE INDEX ON kit.bom_line (bom_id);

-- 3. Kit Packaging Structure (Box -> Component -> Tube/Bottle -> Fill Volume -> Units per Kit)
CREATE TABLE kit.kit_packaging (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  bom_id         uuid NOT NULL REFERENCES kit.bom (id) ON DELETE CASCADE,
  box_no         integer NOT NULL DEFAULT 1 CHECK (box_no > 0),
  box_name       text NOT NULL,
  component_name text NOT NULL,
  container_type text NOT NULL DEFAULT 'TUBE_1_5ML'
                 CHECK (container_type IN ('TUBE_0_5ML', 'TUBE_1_5ML', 'TUBE_2_0ML', 'BOTTLE_10ML', 'BOTTLE_50ML', 'STRIP_8', 'PLATE_96', 'BOX_OUTER')),
  fill_qty       numeric(18,6) NOT NULL CHECK (fill_qty > 0),
  fill_uom       text NOT NULL,
  units_per_kit  integer NOT NULL DEFAULT 1 CHECK (units_per_kit > 0),
  storage_temp   text NOT NULL DEFAULT '-20°C',
  label_spec     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON kit.kit_packaging (bom_id, box_no);

-- 4. Routing & Routing Steps (SOP operations, equipment, parameter limits, QC & dual-sign flags)
CREATE TABLE kit.routing (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text NOT NULL UNIQUE,
  org_unit_id     uuid NOT NULL REFERENCES core.org_unit (id),
  product_item_id uuid NOT NULL REFERENCES master.item (id),
  routing_version integer NOT NULL DEFAULT 1 CHECK (routing_version > 0),
  name            text NOT NULL,
  notes           text,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'EFFECTIVE', 'OBSOLETE')),
  approved_by     integer,
  approved_at     timestamptz,
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      integer,
  UNIQUE (product_item_id, routing_version)
);
CREATE UNIQUE INDEX kit_routing_one_effective ON kit.routing (product_item_id) WHERE status = 'EFFECTIVE';

CREATE TABLE kit.routing_step (
  id                         uuid PRIMARY KEY DEFAULT uuidv7(),
  routing_id                 uuid NOT NULL REFERENCES kit.routing (id) ON DELETE CASCADE,
  seq                        integer NOT NULL CHECK (seq > 0),
  step_code                  text NOT NULL,
  step_name                  text NOT NULL,
  category                   text NOT NULL DEFAULT 'FORMULATION'
                             CHECK (category IN ('PREPARATION', 'FORMULATION', 'FILLING', 'LYOPHILIZATION', 'QC', 'PACKAGING', 'LABELING')),
  instructions               text NOT NULL,
  sop_doc_code               text,
  required_training_doc_code text,
  required_asset_id          uuid REFERENCES asset.asset (id),
  param_schema               jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_qc                      boolean NOT NULL DEFAULT false,
  qc_spec_id                 uuid REFERENCES qms.qc_spec (id),
  requires_check_signature   boolean NOT NULL DEFAULT false,
  allow_skip                 boolean NOT NULL DEFAULT false,
  std_duration_min           integer NOT NULL DEFAULT 30 CHECK (std_duration_min > 0),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (routing_id, seq)
);
CREATE INDEX ON kit.routing_step (routing_id);

-- 5. Production Order (Kit / Semi-finished batch order)
CREATE TABLE kit.production_order (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  code                   text NOT NULL UNIQUE,
  org_unit_id            uuid NOT NULL REFERENCES core.org_unit (id),
  product_item_id        uuid NOT NULL REFERENCES master.item (id),
  bom_id                 uuid NOT NULL REFERENCES kit.bom (id),
  routing_id             uuid NOT NULL REFERENCES kit.routing (id),
  warehouse_id           uuid NOT NULL REFERENCES master.warehouse (id),
  planned_qty            numeric(18,6) NOT NULL CHECK (planned_qty > 0),
  good_qty               numeric(18,6) CHECK (good_qty IS NULL OR good_qty >= 0),
  scrap_qty              numeric(18,6) NOT NULL DEFAULT 0 CHECK (scrap_qty >= 0),
  uom                    text NOT NULL,
  lot_id                 uuid REFERENCES inv.lot (id),
  mfg_date               date,
  expiry_date            date,
  label_printed_at       timestamptz,
  priority               text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  materials_issued       boolean NOT NULL DEFAULT false,
  qc_test_id             uuid REFERENCES qms.qc_test (id),
  qc_passed              boolean,
  qc_summary             text,
  reconciliation_note    text,
  internal_order_line_id uuid,
  confirmed_by           integer,
  confirmed_at           timestamptz,
  released_by            integer,
  released_at            timestamptz,
  status                 text NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'PENDING_QC', 'PENDING_RELEASE', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  notes                  text,
  version                integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             integer,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             integer
);
CREATE INDEX ON kit.production_order (org_unit_id, status);
CREATE INDEX ON kit.production_order (lot_id);

-- 6. Electronic Batch Record Steps (production_step)
CREATE TABLE kit.production_step (
  id                         uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id                   uuid NOT NULL REFERENCES kit.production_order (id) ON DELETE CASCADE,
  routing_step_id            uuid NOT NULL REFERENCES kit.routing_step (id),
  seq                        integer NOT NULL CHECK (seq > 0),
  step_code                  text NOT NULL,
  step_name                  text NOT NULL,
  category                   text NOT NULL,
  instructions               text NOT NULL,
  sop_doc_code               text,
  required_training_doc_code text,
  required_asset_id          uuid REFERENCES asset.asset (id),
  asset_id                   uuid REFERENCES asset.asset (id),
  param_schema               jsonb NOT NULL DEFAULT '[]'::jsonb,
  param_values               jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_qc                      boolean NOT NULL DEFAULT false,
  requires_check_signature   boolean NOT NULL DEFAULT false,
  allow_skip                 boolean NOT NULL DEFAULT false,
  started_at                 timestamptz,
  completed_at               timestamptz,
  performed_by               integer,
  checked_by                 integer,
  checked_at                 timestamptz,
  deviation_id               uuid REFERENCES qms.deviation (id),
  notes                      text,
  status                     text NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_CHECK', 'DONE', 'FAILED', 'SKIPPED')),
  version                    integer NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 integer,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 integer,
  UNIQUE (order_id, seq)
);
CREATE INDEX ON kit.production_step (order_id, seq);

-- 7. Material Consumption & Reconciliation
CREATE TABLE kit.material_consumption (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id          uuid NOT NULL REFERENCES kit.production_order (id) ON DELETE CASCADE,
  bom_line_id       uuid NOT NULL REFERENCES kit.bom_line (id),
  item_id           uuid NOT NULL REFERENCES master.item (id),
  lot_id            uuid REFERENCES inv.lot (id),
  location_id       uuid REFERENCES master.location (id),
  reservation_id    uuid REFERENCES inv.reservation (id),
  planned_qty       numeric(18,6) NOT NULL CHECK (planned_qty > 0),
  issued_qty        numeric(18,6) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  actual_qty        numeric(18,6) NOT NULL DEFAULT 0 CHECK (actual_qty >= 0),
  returned_qty      numeric(18,6) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  uom               text NOT NULL,
  stock_document_id uuid REFERENCES inv.stock_document (id),
  variance_pct      numeric(8,2) NOT NULL DEFAULT 0,
  variance_reason   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON kit.material_consumption (order_id);

-- 8. Bidirectional Lot Genealogy (Parent Raw/Semi-finished Lot <-> Child Kit Lot)
CREATE TABLE kit.lot_genealogy (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  parent_lot_id       uuid NOT NULL REFERENCES inv.lot (id),
  child_lot_id        uuid NOT NULL REFERENCES inv.lot (id),
  production_order_id uuid REFERENCES kit.production_order (id),
  rework_order_id     uuid,
  qty_used            numeric(18,6) NOT NULL CHECK (qty_used > 0),
  uom                 text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_lot_id <> child_lot_id)
);
CREATE INDEX ON kit.lot_genealogy (child_lot_id);
CREATE INDEX ON kit.lot_genealogy (parent_lot_id);

-- 9. Rework / Partial Box Replacement Order
CREATE TABLE kit.rework_order (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  org_unit_id         uuid NOT NULL REFERENCES core.org_unit (id),
  production_order_id uuid NOT NULL REFERENCES kit.production_order (id),
  ncr_id              uuid REFERENCES qms.ncr (id),
  scope               text NOT NULL DEFAULT 'PARTIAL' CHECK (scope IN ('FULL', 'PARTIAL')),
  box_no              integer,
  component_item_id   uuid REFERENCES master.item (id),
  qty_to_rework       numeric(18,6) NOT NULL CHECK (qty_to_rework > 0),
  uom                 text NOT NULL,
  warehouse_id        uuid NOT NULL REFERENCES master.warehouse (id),
  instructions        text NOT NULL,
  resolution_summary  text,
  used_lot_id         uuid REFERENCES inv.lot (id),
  stock_document_id   uuid REFERENCES inv.stock_document (id),
  approved_by         integer,
  approved_at         timestamptz,
  completed_by        integer,
  completed_at        timestamptz,
  status              text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer
);
CREATE INDEX ON kit.rework_order (production_order_id);

-- 10. Immutable Certificate of Analysis (COA) for Released Kit Lots
CREATE TABLE kit.coa_certificate (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  lot_id              uuid NOT NULL REFERENCES inv.lot (id),
  production_order_id uuid NOT NULL REFERENCES kit.production_order (id),
  product_code        text NOT NULL,
  product_name        text NOT NULL,
  lot_code            text NOT NULL,
  mfg_date            date NOT NULL,
  expiry_date         date NOT NULL,
  tests_per_kit       integer NOT NULL,
  good_qty            numeric(18,6) NOT NULL,
  uom                 text NOT NULL,
  qc_summary          text,
  qc_results_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  packaging_snapshot  jsonb NOT NULL DEFAULT '[]'::jsonb,
  issued_by           integer NOT NULL,
  issued_by_name      text NOT NULL,
  issued_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON kit.coa_certificate (lot_id);
CREATE TRIGGER kit_coa_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON kit.coa_certificate
  FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_change();

-- 11. Retain Samples (Mẫu lưu đối chứng theo lô Kit)
CREATE TABLE kit.retain_sample (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  org_unit_id         uuid NOT NULL REFERENCES core.org_unit (id),
  lot_id              uuid NOT NULL REFERENCES inv.lot (id),
  production_order_id uuid REFERENCES kit.production_order (id),
  location_id         uuid REFERENCES master.location (id),
  qty                 numeric(18,6) NOT NULL CHECK (qty > 0),
  uom                 text NOT NULL,
  storage_condition   text NOT NULL DEFAULT '-20°C',
  retain_until        date NOT NULL,
  inspection_note     text,
  disposed_reason     text,
  status              text NOT NULL DEFAULT 'STORED' CHECK (status IN ('STORED', 'INSPECTED', 'DISPOSED')),
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer
);
CREATE INDEX ON kit.retain_sample (lot_id);

-- 12. Stability Study & Timepoints (Theo dõi độ ổn định theo thời gian thực / cấp tốc)
CREATE TABLE kit.stability_study (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  code              text NOT NULL UNIQUE,
  org_unit_id       uuid NOT NULL REFERENCES core.org_unit (id),
  lot_id            uuid NOT NULL REFERENCES inv.lot (id),
  study_type        text NOT NULL DEFAULT 'REAL_TIME' CHECK (study_type IN ('REAL_TIME', 'ACCELERATED', 'IN_USE')),
  storage_condition text NOT NULL DEFAULT '-20°C ± 5°C',
  protocol_ref      text NOT NULL,
  start_date        date NOT NULL,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  notes             text,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        integer
);
CREATE INDEX ON kit.stability_study (lot_id);

CREATE TABLE kit.stability_timepoint (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  study_id   uuid NOT NULL REFERENCES kit.stability_study (id) ON DELETE CASCADE,
  month_mark integer NOT NULL CHECK (month_mark >= 0),
  label      text NOT NULL,
  due_date   date NOT NULL,
  tested_at  date,
  qc_test_id uuid REFERENCES qms.qc_test (id),
  result     text NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'PASS', 'FAIL')),
  summary    text,
  tested_by  integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, month_mark)
);
CREATE INDEX ON kit.stability_timepoint (study_id, due_date);

-- Numbering sequences & configurable settings for Kit module
INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('KIT_BOM',       'Mã định mức BOM Kit',           'BOM{YY}-{NNNN}'),
  ('KIT_ROUTING',   'Mã quy trình công đoạn Kit',    'RTG{YY}-{NNNN}'),
  ('KIT_ORDER',     'Lệnh sản xuất Kit',             'MO{YY}{MM}-{NNNN}'),
  ('KIT_REWORK',    'Lệnh làm lại / bổ sung Kit',    'RW{YY}{MM}-{NNNN}'),
  ('KIT_COA',       'Chứng nhận phân tích COA Kit',  'COA{YY}{MM}-{NNNN}'),
  ('KIT_RETAIN',    'Mã mẫu lưu đối chứng Kit',      'RET{YY}{MM}-{NNNN}'),
  ('KIT_STABILITY', 'Đề cương độ ổn định Kit',       'STB{YY}-{NNNN}')
ON CONFLICT (sequence_key) DO NOTHING;

INSERT INTO core.setting (key, value, description) VALUES
  ('kit.material_variance_tolerance_pct', '5',
   'Ngưỡng % chênh lệch tiêu hao vật tư so với định mức cho phép giải phóng lô Kit không cần giải trình bắt buộc.')
ON CONFLICT (key) DO NOTHING;
