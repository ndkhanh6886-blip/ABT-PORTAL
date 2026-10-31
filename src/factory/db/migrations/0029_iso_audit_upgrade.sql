-- Phase 5: System Audit & Architecture Upgrade (ISO 13485, IEC 62304, ISO 14971, GMP, 21 CFR Part 11)
-- Covers:
-- 1. QMS Controlled Documents (SOP/WI) & Personnel Training Qualification Records
-- 2. R&D ISO 13485 Design Control Traceability Matrix, ISO 14971 FMEA Risk Register & IEC 62304 Software Safety/SRS/SOUP/Anomaly Tracking
-- 3. Kit GMP Line Clearance, Batch Yield Reconciliation & High-Scale Indexing (thousands of BOMs & raw material lines)
-- 4. Device Firmware Release Traceability & Finished-Goods Lot Link
-- 5. Oligo Column-Synthesizer Cross-Contamination Guard (Positive Control / Template vs Primer/Probe on adjacent columns)

-- ============================================================================
-- 1. QMS CONTROLLED DOCUMENTS (SOP) & TRAINING RECORDS (ISO 13485 §4.2.4 & §6.2)
-- ============================================================================
CREATE TABLE IF NOT EXISTS qms.controlled_document (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text NOT NULL,
  doc_version     integer NOT NULL DEFAULT 1 CHECK (doc_version > 0),
  title           text NOT NULL,
  doc_type        text NOT NULL DEFAULT 'SOP' CHECK (doc_type IN ('SOP', 'WI', 'FORM', 'SPEC', 'POLICY')),
  org_unit_id     uuid REFERENCES core.org_unit (id),
  effective_date  date,
  review_due_date date,
  content_summary text,
  attachment_id   uuid REFERENCES core.attachment (id),
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'EFFECTIVE', 'SUPERSEDED', 'OBSOLETE')),
  approved_by     integer,
  approved_at     timestamptz,
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      integer,
  UNIQUE (code, doc_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS qms_controlled_doc_one_effective
  ON qms.controlled_document (code) WHERE status = 'EFFECTIVE';
CREATE INDEX IF NOT EXISTS idx_qms_controlled_doc_status ON qms.controlled_document (status, code);

CREATE TABLE IF NOT EXISTS qms.training_record (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  document_id      uuid NOT NULL REFERENCES qms.controlled_document (id) ON DELETE CASCADE,
  doc_code         text NOT NULL,
  doc_version      integer NOT NULL,
  user_id          integer NOT NULL,
  trained_at       date NOT NULL DEFAULT CURRENT_DATE,
  expires_at       date,
  assessment_score numeric(5,2),
  result           text NOT NULL DEFAULT 'PASS' CHECK (result IN ('PASS', 'FAIL')),
  trainer_id       integer,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       integer,
  UNIQUE (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_qms_training_user_code ON qms.training_record (user_id, doc_code, result);

-- ============================================================================
-- 2. R&D DESIGN CONTROL (ISO 13485 §7.3), RISK REGISTER (ISO 14971) & IEC 62304
-- ============================================================================
CREATE TABLE IF NOT EXISTS rd.risk_item (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  project_id          uuid NOT NULL REFERENCES rd.project (id) ON DELETE CASCADE,
  hazard              text NOT NULL,
  hazardous_situation text NOT NULL,
  harm                text NOT NULL,
  severity            integer NOT NULL CHECK (severity BETWEEN 1 AND 5),
  occurrence          integer NOT NULL CHECK (occurrence BETWEEN 1 AND 5),
  detection           integer NOT NULL CHECK (detection BETWEEN 1 AND 5),
  rpn                 integer GENERATED ALWAYS AS (severity * occurrence * detection) STORED,
  mitigation_measure  text,
  residual_severity   integer CHECK (residual_severity BETWEEN 1 AND 5),
  residual_occurrence integer CHECK (residual_occurrence BETWEEN 1 AND 5),
  residual_detection  integer CHECK (residual_detection BETWEEN 1 AND 5),
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'MITIGATED', 'ACCEPTED')),
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer
);
CREATE INDEX IF NOT EXISTS idx_rd_risk_project ON rd.risk_item (project_id, status);

ALTER TABLE rd.spec_evaluation
  ADD COLUMN IF NOT EXISTS design_stage text NOT NULL DEFAULT 'DESIGN_INPUT'
    CHECK (design_stage IN ('USER_NEED', 'DESIGN_INPUT', 'DESIGN_OUTPUT', 'VERIFICATION', 'VALIDATION')),
  ADD COLUMN IF NOT EXISTS user_need_ref text,
  ADD COLUMN IF NOT EXISTS design_output_ref text,
  ADD COLUMN IF NOT EXISTS verification_experiment_id uuid REFERENCES rd.experiment (id),
  ADD COLUMN IF NOT EXISTS validation_ref text,
  ADD COLUMN IF NOT EXISTS risk_item_id uuid REFERENCES rd.risk_item (id);

ALTER TABLE rd.software_release
  ADD COLUMN IF NOT EXISTS safety_class text NOT NULL DEFAULT 'CLASS_B'
    CHECK (safety_class IN ('CLASS_A', 'CLASS_B', 'CLASS_C')),
  ADD COLUMN IF NOT EXISTS srs_traceability jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS soup_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS known_anomalies jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================================
-- 3. KIT PRODUCTION GMP LINE CLEARANCE, YIELD & HIGH-SCALE INDEXES
-- ============================================================================
ALTER TABLE kit.production_order
  ADD COLUMN IF NOT EXISTS line_clearance_passed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS line_clearance_by integer,
  ADD COLUMN IF NOT EXISTS line_clearance_at timestamptz,
  ADD COLUMN IF NOT EXISTS line_clearance_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sample_qty numeric(18,6) NOT NULL DEFAULT 0 CHECK (sample_qty >= 0),
  ADD COLUMN IF NOT EXISTS retain_qty numeric(18,6) NOT NULL DEFAULT 0 CHECK (retain_qty >= 0),
  ADD COLUMN IF NOT EXISTS yield_pct numeric(8,2),
  ADD COLUMN IF NOT EXISTS materials_reconciled boolean NOT NULL DEFAULT false;

-- High-scale indexes for thousands of BOMs, Routings, and thousands of raw material lines
CREATE INDEX IF NOT EXISTS idx_kit_bom_product_ver ON kit.bom (product_item_id, status, bom_version DESC);
CREATE INDEX IF NOT EXISTS idx_kit_bom_code_name ON kit.bom (code, name);
CREATE INDEX IF NOT EXISTS idx_kit_bom_line_bom_box ON kit.bom_line (bom_id, box_no, line_no);
CREATE INDEX IF NOT EXISTS idx_kit_bom_line_component ON kit.bom_line (component_item_id);
CREATE INDEX IF NOT EXISTS idx_kit_routing_product_ver ON kit.routing (product_item_id, status, routing_version DESC);
CREATE INDEX IF NOT EXISTS idx_kit_routing_step_seq ON kit.routing_step (routing_id, seq);
CREATE INDEX IF NOT EXISTS idx_device_bom_line_rev ON device.model_bom_line (revision_id, line_no);
CREATE INDEX IF NOT EXISTS idx_device_bom_line_comp ON device.model_bom_line (component_item_id);
CREATE INDEX IF NOT EXISTS idx_master_item_type_code ON master.item (item_type, status, code);
CREATE INDEX IF NOT EXISTS idx_master_item_name_lower ON master.item (lower(name));

-- ============================================================================
-- 4. DEVICE IEC 62304 FIRMWARE LINK & FINISHED-GOODS LOT TRACKING
-- ============================================================================
ALTER TABLE device.model_revision
  ADD COLUMN IF NOT EXISTS firmware_release_id uuid REFERENCES rd.software_release (id);

ALTER TABLE device.device_unit
  ADD COLUMN IF NOT EXISTS firmware_release_id uuid REFERENCES rd.software_release (id),
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES inv.lot (id);

-- ============================================================================
-- 5. OLIGO COLUMN-SYNTHESIZER CROSS-CONTAMINATION GUARD
-- ============================================================================
ALTER TABLE oligo.oligo_sequence
  ADD COLUMN IF NOT EXISTS oligo_role text NOT NULL DEFAULT 'PRIMER'
    CHECK (oligo_role IN ('PRIMER', 'PROBE', 'POSITIVE_CONTROL', 'TEMPLATE', 'BLOCKER', 'OTHER')),
  ADD COLUMN IF NOT EXISTS target_pathogen text;

ALTER TABLE oligo.synthesis_position
  ADD COLUMN IF NOT EXISTS contamination_warning text;

-- Numbering sequences & settings
INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('QMS_DOC', 'Tài liệu kiểm soát SOP/WI', 'SOP{YY}-{NNNN}'),
  ('RD_RISK', 'Mục quản lý rủi ro ISO 14971', 'RSK{YY}-{NNNN}')
ON CONFLICT (sequence_key) DO NOTHING;

INSERT INTO core.setting (key, value, description) VALUES
  ('kit.min_yield_pct', '90', 'Hiệu suất mẻ Kit tối thiểu (%) trước khi cảnh báo sai lệch (Deviation).'),
  ('kit.max_yield_pct', '102', 'Hiệu suất mẻ Kit tối đa (%) cho phép giải phóng lô.'),
  ('qms.enforce_sop_training', 'true', 'Kiểm tra chứng chỉ đào tạo SOP còn hiệu lực khi thực hiện bước EBR có khai báo required_training_doc_code.')
ON CONFLICT (key) DO NOTHING;
