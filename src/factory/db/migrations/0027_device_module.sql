-- Phase 4c: Device Engineering & Technology Department (Phòng Kỹ thuật – Công nghệ / Thiết bị)
-- Covers ISO 13485 Design Master Record (DMR), Engineering Change Orders (ECO),
-- Device History Record (DHR) per serial number, 4-station assembly, 48h Burn-in & FQC,
-- Mechanical/PCB Subcontracting with IQC tolerance checks & Vendor Tiering (A/B/C/D),
-- and Field Warranty / Preventive Maintenance / Post-market Service Tickets.

CREATE SCHEMA IF NOT EXISTS device;

-- 1. Device Models (Model thiết bị y tế / phòng lab)
CREATE TABLE device.device_model (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  code                   text NOT NULL UNIQUE,
  name                   text NOT NULL,
  org_unit_id            uuid NOT NULL REFERENCES core.org_unit (id),
  item_id                uuid REFERENCES master.item (id),
  category               text NOT NULL DEFAULT 'THERMAL_CYCLER'
                         CHECK (category IN ('THERMAL_CYCLER', 'EXTRACTOR', 'CENTRIFUGE', 'SPIN_COLUMN_SYSTEM', 'INCUBATOR', 'SPECTROPHOTOMETER', 'OTHER')),
  current_revision_id    uuid,
  warranty_months        integer NOT NULL DEFAULT 12 CHECK (warranty_months >= 0 AND warranty_months <= 120),
  required_burn_in_hours numeric(8,2) NOT NULL DEFAULT 48 CHECK (required_burn_in_hours >= 0),
  fqc_spec_id            uuid REFERENCES qms.qc_spec (id),
  rd_project_id          uuid REFERENCES rd.project (id),
  description            text,
  status                 text NOT NULL DEFAULT 'DEVELOPMENT'
                         CHECK (status IN ('DEVELOPMENT', 'COMMERCIAL', 'DISCONTINUED')),
  version                integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             integer,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             integer
);
CREATE INDEX ON device.device_model (org_unit_id, status);

-- 2. Engineering Change Orders (ECO — Kiểm soát thay đổi thiết kế / kỹ thuật, docs 02 §4.5)
CREATE TABLE device.eco_request (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  code                  text NOT NULL UNIQUE,
  model_id              uuid NOT NULL REFERENCES device.device_model (id),
  target_revision       text NOT NULL,
  title                 text NOT NULL,
  reason                text NOT NULL,
  change_summary        text NOT NULL,
  -- Impact assessment checklist required before moving IMPACT_ASSESSMENT -> PENDING_APPROVAL
  impact_documents      text,
  impact_training       text,
  impact_stock          text,
  impact_open_orders    text,
  impact_regulatory     text,
  effectivity_type      text NOT NULL DEFAULT 'IMMEDIATE'
                        CHECK (effectivity_type IN ('IMMEDIATE', 'FROM_DATE', 'FROM_SERIAL')),
  effectivity_value     text,
  proposer_id           integer NOT NULL,
  approved_by           integer,
  approved_at           timestamptz,
  implemented_by        integer,
  implemented_at        timestamptz,
  closed_by             integer,
  closed_at             timestamptz,
  verification_note     text,
  status                text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'IMPACT_ASSESSMENT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'CLOSED')),
  version               integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            integer,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            integer
);
CREATE INDEX ON device.eco_request (model_id, status);

-- 3. Model Revisions / DMR (Hồ sơ thiết kế gốc DMR theo phiên bản A, B, C... docs 02 §10.6)
CREATE TABLE device.model_revision (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  model_id              uuid NOT NULL REFERENCES device.device_model (id),
  revision              text NOT NULL,
  firmware_version      text,
  dmr_summary           text NOT NULL,
  dmr_attachment_id     uuid REFERENCES core.attachment (id),
  eco_request_id        uuid REFERENCES device.eco_request (id),
  effectivity_type      text NOT NULL DEFAULT 'IMMEDIATE'
                        CHECK (effectivity_type IN ('IMMEDIATE', 'FROM_DATE', 'FROM_SERIAL')),
  effectivity_value     text,
  released_by           integer,
  released_at           timestamptz,
  status                text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'RELEASED', 'OBSOLETE')),
  version               integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            integer,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            integer,
  UNIQUE (model_id, revision)
);
-- Exactly one RELEASED revision per device model at a time
CREATE UNIQUE INDEX model_revision_one_released ON device.model_revision (model_id) WHERE status = 'RELEASED';

ALTER TABLE device.device_model
  ADD CONSTRAINT device_model_current_revision_fk
  FOREIGN KEY (current_revision_id) REFERENCES device.model_revision (id);

-- 4. Multi-station BOM per Model Revision (Định mức linh kiện theo 4 trạm lắp ráp)
CREATE TABLE device.model_bom_line (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  revision_id       uuid NOT NULL REFERENCES device.model_revision (id) ON DELETE CASCADE,
  line_no           integer NOT NULL CHECK (line_no > 0),
  station_code      text NOT NULL
                    CHECK (station_code IN ('STATION_1_MECH', 'STATION_2_PCB', 'STATION_3_FW', 'STATION_4_FQC')),
  component_item_id uuid NOT NULL REFERENCES master.item (id),
  qty_per_unit      numeric(18,6) NOT NULL CHECK (qty_per_unit > 0),
  uom               text NOT NULL REFERENCES master.uom (code),
  source_type       text NOT NULL DEFAULT 'BUY'
                    CHECK (source_type IN ('BUY', 'MAKE', 'SUBCONTRACT')),
  is_critical       boolean NOT NULL DEFAULT true,
  requires_serial   boolean NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        integer,
  UNIQUE (revision_id, line_no)
);
CREATE INDEX ON device.model_bom_line (revision_id, station_code);

-- 5. Device Production / Assembly Orders (Đơn & Lệnh lắp ráp thiết bị, docs 02 §10.1 & §10.2)
CREATE TABLE device.device_order (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  code                   text NOT NULL UNIQUE,
  org_unit_id            uuid NOT NULL REFERENCES core.org_unit (id),
  internal_order_line_id uuid REFERENCES intake.internal_order_line (id),
  model_id               uuid NOT NULL REFERENCES device.device_model (id),
  model_revision_id      uuid NOT NULL REFERENCES device.model_revision (id),
  warehouse_id           uuid NOT NULL REFERENCES master.warehouse (id),
  qty                    integer NOT NULL CHECK (qty > 0 AND qty <= 500),
  custom_specs           text,
  priority               text NOT NULL DEFAULT 'NORMAL'
                         CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  due_date               date,
  lead_engineer_id       integer,
  approved_by            integer,
  approved_at            timestamptz,
  cancel_reason          text,
  status                 text NOT NULL DEFAULT 'RECEIVED'
                         CHECK (status IN ('RECEIVED', 'APPROVED', 'IN_PRODUCTION', 'QC_TESTING', 'READY', 'DELIVERED', 'CANCELLED')),
  version                integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             integer,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             integer
);
CREATE INDEX ON device.device_order (org_unit_id, status);
CREATE INDEX ON device.device_order (model_revision_id);

-- 6. Serialized Device Units / DHR Header (Máy theo từng số Serial — Hồ sơ lịch sử thiết bị DHR, docs 02 §10.3)
CREATE TABLE device.device_unit (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  serial_no         text NOT NULL UNIQUE,
  order_id          uuid NOT NULL REFERENCES device.device_order (id),
  model_id          uuid NOT NULL REFERENCES device.device_model (id),
  model_revision_id uuid NOT NULL REFERENCES device.model_revision (id),
  firmware_version  text,
  fqc_test_id       uuid REFERENCES qms.qc_test (id),
  fqc_passed        boolean NOT NULL DEFAULT false,
  fqc_summary       text,
  qa_released_by    integer,
  qa_released_at    timestamptz,
  customer_name     text,
  partner_id        uuid REFERENCES master.partner (id),
  delivered_at      date,
  warranty_start    date,
  warranty_end      date,
  decommission_note text,
  status            text NOT NULL DEFAULT 'IN_ASSEMBLY'
                    CHECK (status IN ('IN_ASSEMBLY', 'BURN_IN', 'FQC', 'QA_PASSED', 'DELIVERED', 'IN_SERVICE_FIELD', 'UNDER_SERVICE', 'DECOMMISSIONED')),
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        integer
);
CREATE INDEX ON device.device_unit (order_id, status);
CREATE INDEX ON device.device_unit (model_id, status);

-- 7. Device Unit Component Traceability (DHR Component Log — Linh kiện lắp vào từng Serial máy)
CREATE TABLE device.device_unit_component (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  unit_id             uuid NOT NULL REFERENCES device.device_unit (id),
  bom_line_id         uuid REFERENCES device.model_bom_line (id),
  station_code        text NOT NULL
                      CHECK (station_code IN ('STATION_1_MECH', 'STATION_2_PCB', 'STATION_3_FW', 'STATION_4_FQC', 'FIELD_SERVICE')),
  item_id             uuid NOT NULL REFERENCES master.item (id),
  lot_id              uuid REFERENCES inv.lot (id),
  component_serial    text,
  qty                 numeric(18,6) NOT NULL CHECK (qty > 0),
  uom                 text NOT NULL REFERENCES master.uom (code),
  stock_document_id   uuid REFERENCES inv.stock_document (id),
  service_ticket_id   uuid,
  is_replacement      boolean NOT NULL DEFAULT false,
  installed_by        integer NOT NULL,
  installed_at        timestamptz NOT NULL DEFAULT now(),
  notes               text
);
CREATE INDEX ON device.device_unit_component (unit_id, station_code);
CREATE INDEX ON device.device_unit_component (lot_id);

-- 8. Burn-in / Aging Runs (Chạy lão hóa nhiệt / tải liên tục trước FQC, docs 02 §10.3)
CREATE TABLE device.burn_in_run (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  unit_id           uuid NOT NULL REFERENCES device.device_unit (id),
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  hours             numeric(8,2) NOT NULL CHECK (hours >= 0),
  required_hours    numeric(8,2) NOT NULL DEFAULT 48 CHECK (required_hours >= 0),
  max_temp_c        numeric(6,2),
  cycles_completed  integer,
  result            text NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  log_attachment_id uuid REFERENCES core.attachment (id),
  notes             text,
  recorded_by       integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON device.burn_in_run (unit_id, created_at DESC);

-- 9. Mechanical / PCB Subcontracting & Tolerance IQC (Gia công ngoài & IQC dung sai bản vẽ, docs 02 §10.4)
CREATE TABLE device.subcontract_part (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  org_unit_id         uuid NOT NULL REFERENCES core.org_unit (id),
  item_id             uuid NOT NULL REFERENCES master.item (id),
  vendor_id           uuid NOT NULL REFERENCES master.partner (id),
  material            text NOT NULL,
  process_type        text NOT NULL
                      CHECK (process_type IN ('CNC', 'SHEET_METAL', 'ANODIZE', 'PCB_SMT', 'MOLDING', 'LASER_CUT', 'OTHER')),
  tolerance_standard  text NOT NULL,
  drawing_ref         text,
  drawing_attachment_id uuid REFERENCES core.attachment (id),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer
);

CREATE TABLE device.subcontract_order (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  code           text NOT NULL UNIQUE,
  org_unit_id    uuid NOT NULL REFERENCES core.org_unit (id),
  vendor_id      uuid NOT NULL REFERENCES master.partner (id),
  warehouse_id   uuid NOT NULL REFERENCES master.warehouse (id),
  device_order_id uuid REFERENCES device.device_order (id),
  due_date       date,
  notes          text,
  status         text NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED')),
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     integer,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     integer
);
CREATE INDEX ON device.subcontract_order (org_unit_id, status);
CREATE INDEX ON device.subcontract_order (vendor_id);

CREATE TABLE device.subcontract_line (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id           uuid NOT NULL REFERENCES device.subcontract_order (id) ON DELETE CASCADE,
  line_no            integer NOT NULL CHECK (line_no > 0),
  part_id            uuid NOT NULL REFERENCES device.subcontract_part (id),
  qty_ordered        numeric(18,6) NOT NULL CHECK (qty_ordered > 0),
  qty_received       numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  qty_accepted       numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_accepted >= 0),
  qty_rework         numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_rework >= 0),
  qty_rejected       numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  unit_price         numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  iqc_result         text CHECK (iqc_result IN ('PASS', 'REWORK', 'REJECT')),
  iqc_dimension_note text,
  lot_id             uuid REFERENCES inv.lot (id),
  stock_document_id  uuid REFERENCES inv.stock_document (id),
  ncr_id             uuid REFERENCES qms.ncr (id),
  UNIQUE (order_id, line_no)
);

-- 10. Vendor Evaluation (Đánh giá nhà cung cấp gia công 40/25/20/15 -> Hạng A/B/C/D, docs 01 §12)
CREATE TABLE device.vendor_evaluation (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text NOT NULL UNIQUE,
  org_unit_id     uuid NOT NULL REFERENCES core.org_unit (id),
  vendor_id       uuid NOT NULL REFERENCES master.partner (id),
  eval_type       text NOT NULL DEFAULT 'POST_ORDER'
                  CHECK (eval_type IN ('PERIODIC', 'POST_ORDER', 'AUDIT')),
  linked_order_id uuid REFERENCES device.subcontract_order (id),
  quality_score   numeric(4,2) NOT NULL CHECK (quality_score >= 1 AND quality_score <= 5),
  delivery_score  numeric(4,2) NOT NULL CHECK (delivery_score >= 1 AND delivery_score <= 5),
  cost_score      numeric(4,2) NOT NULL CHECK (cost_score >= 1 AND cost_score <= 5),
  service_score   numeric(4,2) NOT NULL CHECK (service_score >= 1 AND service_score <= 5),
  weighted_score  numeric(5,2) NOT NULL,
  tier            text NOT NULL CHECK (tier IN ('A', 'B', 'C', 'D')),
  conclusion      text,
  evaluator_id    integer NOT NULL,
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      integer
);
CREATE INDEX ON device.vendor_evaluation (vendor_id, created_at DESC);

-- 11. Field Service Tickets & Preventive Maintenance Schedules (Bảo hành, Bảo trì & Dịch vụ kỹ thuật, docs 02 §10.5)
CREATE TABLE device.service_schedule (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  unit_id         uuid NOT NULL UNIQUE REFERENCES device.device_unit (id),
  interval_months integer NOT NULL DEFAULT 6 CHECK (interval_months > 0 AND interval_months <= 60),
  last_service_at date,
  next_due        date NOT NULL,
  notes           text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON device.service_schedule (next_due);

CREATE TABLE device.service_ticket (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  code              text NOT NULL UNIQUE,
  org_unit_id       uuid NOT NULL REFERENCES core.org_unit (id),
  unit_id           uuid NOT NULL REFERENCES device.device_unit (id),
  ticket_type       text NOT NULL
                    CHECK (ticket_type IN ('PREVENTIVE', 'REPAIR', 'WARRANTY', 'COMPLAINT', 'INSTALLATION')),
  reported_at       date NOT NULL DEFAULT CURRENT_DATE,
  symptom           text NOT NULL,
  diagnosis         text,
  resolution        text,
  is_warranty       boolean NOT NULL DEFAULT false,
  service_cost      numeric(18,2) NOT NULL DEFAULT 0 CHECK (service_cost >= 0),
  capa_evaluated    boolean NOT NULL DEFAULT false,
  capa_required     boolean NOT NULL DEFAULT false,
  deviation_id      uuid REFERENCES qms.deviation (id),
  assigned_to       integer,
  customer_confirmer text,
  closed_by         integer,
  closed_at         timestamptz,
  status            text NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'DIAGNOSING', 'AWAITING_PARTS', 'IN_REPAIR', 'RESOLVED', 'CLOSED', 'CANCELLED')),
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        integer
);
CREATE INDEX ON device.service_ticket (org_unit_id, status);
CREATE INDEX ON device.service_ticket (unit_id, created_at DESC);

-- Numbering sequences for Device module
INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('DEVICE_MODEL',      'Model thiết bị KT-CN',              'MDL-{NNN}'),
  ('DEVICE_ECO',        'Yêu cầu thay đổi kỹ thuật (ECO)',    'ECO{YY}-{NNNN}'),
  ('DEVICE_ORDER',      'Lệnh sản xuất / lắp ráp thiết bị',  'DO{YY}{MM}-{NNN}'),
  ('DEVICE_SERIAL',     'Số serial thiết bị xuất xưởng',     'DEV{YY}-{NNNN}'),
  ('SUBCONTRACT_PART',  'Chi tiết gia công ngoài',           'SCP-{NNNN}'),
  ('SUBCONTRACT_ORDER', 'Đơn đặt gia công ngoài',            'SCO{YY}{MM}-{NNN}'),
  ('VENDOR_EVAL',       'Phiếu đánh giá nhà cung cấp',       'VE{YY}-{NNNN}'),
  ('SERVICE_TICKET',    'Phiếu bảo hành / dịch vụ kỹ thuật', 'SRV{YY}{MM}-{NNNN}')
ON CONFLICT (sequence_key) DO NOTHING;

-- Default vendor evaluation weights setting (Quality 40%, Delivery 25%, Cost 20%, Service 15%)
INSERT INTO core.setting (key, value, description) VALUES
  ('device.vendor_eval_weights', '{"quality": 40, "delivery": 25, "cost": 20, "service": 15}', 'Trọng số đánh giá nhà cung cấp gia công (Chất lượng / Giao hàng / Chi phí / Dịch vụ)')
ON CONFLICT (key) DO NOTHING;
