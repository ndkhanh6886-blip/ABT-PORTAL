-- Phase 4d: R&D & Innovation Management (ISO 13485 Design Control, Stage-Gate, ELN, Biobank, Tech Transfer & Software Release)
-- Follows docs/nha-may/01-mo-hinh-du-lieu.md (§9, §8) and docs/nha-may/00-kien-truc.md (D6, D7).

CREATE SCHEMA IF NOT EXISTS rd;

-- 1. Strategic Goals & Idea Funnel
CREATE TABLE rd.strategic_goal (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  period       text NOT NULL,                      -- e.g. '2026', '2026-Q4'
  description  text,
  owner_id     integer REFERENCES core.user_profile (user_id),
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'ARCHIVED')),
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   integer,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   integer
);

CREATE TABLE rd.evaluation_criterion (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  eval_type  text NOT NULL CHECK (eval_type IN ('TECH', 'BIZ')),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  weight     numeric(6,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  scale_max  integer NOT NULL DEFAULT 5 CHECK (scale_max BETWEEN 3 AND 10),
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);

CREATE TABLE rd.idea (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text NOT NULL UNIQUE,
  org_unit_id     uuid NOT NULL REFERENCES core.org_unit (id),
  title           text NOT NULL,
  description     text NOT NULL,
  target_domain   text NOT NULL DEFAULT 'KIT' CHECK (target_domain IN ('KIT', 'OLIGO', 'DEVICE', 'SOFTWARE', 'OTHER')),
  goal_id         uuid REFERENCES rd.strategic_goal (id),
  proposer_id     integer NOT NULL REFERENCES core.user_profile (user_id),
  expected_roi    text,
  market_summary  text,
  vote_count      integer NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  status          text NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'SUBMITTED', 'EVALUATION', 'EVALUATED', 'APPROVED', 'REJECTED', 'CONVERTED')),
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      integer
);
CREATE INDEX ON rd.idea (org_unit_id, status);
CREATE INDEX ON rd.idea (goal_id);

CREATE TABLE rd.idea_evaluation (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  idea_id        uuid NOT NULL REFERENCES rd.idea (id),
  eval_type      text NOT NULL CHECK (eval_type IN ('TECH', 'BIZ')),
  evaluator_id   integer NOT NULL REFERENCES core.user_profile (user_id),
  scores         jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {criterion_code: score}
  weighted_score numeric(8,2) NOT NULL CHECK (weighted_score >= 0),
  analysis       text,
  recommendation text NOT NULL CHECK (recommendation IN ('APPROVE', 'REJECT', 'REVISE')),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_id, eval_type, evaluator_id)
);
CREATE INDEX ON rd.idea_evaluation (idea_id);

-- 2. Stage-Gate Templates, Projects & Design Control (ISO 13485 / IVD)
CREATE TABLE rd.gate_template (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  domain     text NOT NULL CHECK (domain IN ('KIT', 'OLIGO', 'DEVICE', 'SOFTWARE', 'OTHER')),
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer
);

CREATE TABLE rd.gate_template_item (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  template_id  uuid NOT NULL REFERENCES rd.gate_template (id),
  gate_no      integer NOT NULL CHECK (gate_no BETWEEN 0 AND 10),
  gate_name    text NOT NULL,
  stage_after  text NOT NULL,
  seq          integer NOT NULL CHECK (seq > 0),
  item_name    text NOT NULL,
  doc_type     text NOT NULL,                     -- TPP, RISK_ISO14971, FORMULATION, ANALYTICAL_VAL, STABILITY_ISO23640, CLINICAL_EVAL, DHF_DMR, SRS_SDS...
  is_required  boolean NOT NULL DEFAULT true,
  UNIQUE (template_id, gate_no, seq)
);

CREATE TABLE rd.project (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  owner_org_unit_id     uuid NOT NULL REFERENCES core.org_unit (id),
  project_type          text NOT NULL DEFAULT 'NEW_PRODUCT'
                        CHECK (project_type IN ('NEW_PRODUCT', 'IMPROVEMENT', 'PROCESS', 'RESEARCH')),
  target_domain         text NOT NULL CHECK (target_domain IN ('KIT', 'OLIGO', 'DEVICE', 'SOFTWARE', 'OTHER')),
  ivd_class             text CHECK (ivd_class IN ('CLASS_A', 'CLASS_B', 'CLASS_C', 'CLASS_D', 'RUO', 'NA')),
  idea_id               uuid REFERENCES rd.idea (id),
  leader_id             integer NOT NULL REFERENCES core.user_profile (user_id),
  gate_template_id      uuid NOT NULL REFERENCES rd.gate_template (id),
  current_stage         text NOT NULL,
  status                text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'ON_HOLD', 'TRANSFERRED', 'KILLED')),
  planned_start         date,
  planned_end           date,
  actual_transfer_date  date,
  description           text,
  version               integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            integer,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            integer
);
CREATE INDEX ON rd.project (owner_org_unit_id, status);
CREATE INDEX ON rd.project (idea_id);

CREATE TABLE rd.project_member (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id     uuid NOT NULL REFERENCES rd.project (id),
  user_id        integer NOT NULL REFERENCES core.user_profile (user_id),
  role_in_project text NOT NULL DEFAULT 'RESEARCHER',
  allocation_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (allocation_pct > 0 AND allocation_pct <= 100),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE TABLE rd.project_gate (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id    uuid NOT NULL REFERENCES rd.project (id),
  gate_no       integer NOT NULL,
  gate_name     text NOT NULL,
  stage_after   text NOT NULL,
  status        text NOT NULL DEFAULT 'LOCKED'
                CHECK (status IN ('LOCKED', 'OPEN', 'PENDING_REVIEW', 'PASSED', 'NEEDS_REVISION')),
  submitted_by  integer REFERENCES core.user_profile (user_id),
  submitted_at  timestamptz,
  decision      text CHECK (decision IN ('GO', 'RECYCLE', 'HOLD', 'KILL')),
  decided_by    integer REFERENCES core.user_profile (user_id),
  decided_at    timestamptz,
  decision_note text,
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer,
  UNIQUE (project_id, gate_no)
);
CREATE INDEX ON rd.project_gate (project_id, gate_no);

CREATE TABLE rd.gate_deliverable (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  project_gate_id  uuid NOT NULL REFERENCES rd.project_gate (id),
  template_item_id uuid NOT NULL REFERENCES rd.gate_template_item (id),
  seq              integer NOT NULL,
  item_name        text NOT NULL,
  doc_type         text NOT NULL,
  is_required      boolean NOT NULL DEFAULT true,
  attachment_id    uuid REFERENCES core.attachment (id),
  notes            text,
  status           text NOT NULL DEFAULT 'MISSING'
                   CHECK (status IN ('MISSING', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
  reviewer_comment text,
  reviewed_by      integer REFERENCES core.user_profile (user_id),
  reviewed_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       integer,
  UNIQUE (project_gate_id, template_item_id)
);

-- Target Product Profile (TPP) / Design Input vs Design Output Matrix
CREATE TABLE rd.spec_evaluation (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id     uuid NOT NULL REFERENCES rd.project (id),
  category       text NOT NULL DEFAULT 'ANALYTICAL',  -- LoD, PRECISION, SPECIFICITY, STABILITY, CLINICAL, SOFTWARE_PERF...
  parameter      text NOT NULL,
  unit           text,
  baseline_value text,
  target_value   text NOT NULL,
  actual_value   text,
  method_ref     text,
  result         text NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'PASS', 'FAIL')),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     integer
);
CREATE INDEX ON rd.spec_evaluation (project_id);

CREATE TABLE rd.roadmap_milestone (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id uuid NOT NULL REFERENCES rd.project (id),
  title      text NOT NULL,
  due_date   date NOT NULL,
  status     text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DONE', 'DELAYED', 'CANCELLED')),
  tags       text[] NOT NULL DEFAULT '{}',
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);
CREATE INDEX ON rd.roadmap_milestone (project_id, due_date);

-- 3. Electronic Lab Notebook (ELN)
CREATE TABLE rd.experiment (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  code                 text NOT NULL UNIQUE,
  project_id           uuid NOT NULL REFERENCES rd.project (id),
  title                text NOT NULL,
  objective            text NOT NULL,
  hypothesis           text,
  protocol_summary     text,
  conclusion           text,
  status               text NOT NULL DEFAULT 'PLANNED'
                       CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'SUPERSEDED', 'CANCELLED')),
  revision             integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  parent_experiment_id uuid REFERENCES rd.experiment (id),
  started_at           timestamptz,
  finished_at          timestamptz,
  submitted_by         integer REFERENCES core.user_profile (user_id),
  submitted_at         timestamptz,
  approved_by          integer REFERENCES core.user_profile (user_id),
  approved_at          timestamptz,
  supersede_reason     text,
  version              integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           integer,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           integer
);
CREATE INDEX ON rd.experiment (project_id, status);

CREATE TABLE rd.experiment_entry (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  experiment_id uuid NOT NULL REFERENCES rd.experiment (id),
  seq           integer NOT NULL CHECK (seq > 0),
  entry_type    text NOT NULL CHECK (entry_type IN ('TEXT', 'TABLE', 'OBSERVATION', 'IMAGE', 'RAW_DATA', 'RESULT')),
  title         text,
  content       jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachment_id uuid REFERENCES core.attachment (id),
  created_by    integer NOT NULL REFERENCES core.user_profile (user_id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, seq)
);

CREATE TABLE rd.experiment_material (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  experiment_id     uuid NOT NULL REFERENCES rd.experiment (id),
  item_id           uuid NOT NULL REFERENCES master.item (id),
  lot_id            uuid NOT NULL REFERENCES inv.lot (id),
  warehouse_id      uuid NOT NULL REFERENCES master.warehouse (id),
  location_id       uuid NOT NULL REFERENCES master.location (id),
  qty               numeric(18,6) NOT NULL CHECK (qty > 0),
  uom               text NOT NULL REFERENCES master.uom (code),
  qty_base          numeric(18,6) NOT NULL CHECK (qty_base > 0),
  stock_document_id uuid NOT NULL REFERENCES inv.stock_document (id),
  role_in_exp       text,
  issued_by         integer NOT NULL REFERENCES core.user_profile (user_id),
  issued_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rd.experiment_material (experiment_id);

CREATE TABLE rd.experiment_asset (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  experiment_id uuid NOT NULL REFERENCES rd.experiment (id),
  asset_id      uuid NOT NULL REFERENCES asset.asset (id),
  run_params    jsonb NOT NULL DEFAULT '{}'::jsonb,
  used_at       timestamptz NOT NULL DEFAULT now(),
  used_by       integer NOT NULL REFERENCES core.user_profile (user_id)
);
CREATE INDEX ON rd.experiment_asset (experiment_id);

-- 4. Biobank & Clinical / Reference Samples
CREATE TABLE rd.sample (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  code              text NOT NULL UNIQUE,
  org_unit_id       uuid NOT NULL REFERENCES core.org_unit (id),
  project_id        uuid REFERENCES rd.project (id),
  sample_type       text NOT NULL CHECK (sample_type IN ('BLOOD', 'SERUM_PLASMA', 'SWAB', 'DNA', 'RNA', 'STRAIN', 'PLASMID', 'CONTROL_PANEL', 'OTHER')),
  name              text NOT NULL,
  source            text NOT NULL,
  consent_ref       text,
  biosafety_level   text NOT NULL DEFAULT 'BSL1' CHECK (biosafety_level IN ('BSL1', 'BSL2', 'BSL3')),
  target_pathogen   text,
  reference_ct      numeric(6,2),
  collected_at      date,
  warehouse_id      uuid REFERENCES master.warehouse (id),
  location_id       uuid REFERENCES master.location (id),
  box_position      text,                            -- e.g. 'Box-A1 / Pos-C04'
  initial_volume    numeric(18,6) NOT NULL CHECK (initial_volume > 0),
  current_volume    numeric(18,6) NOT NULL CHECK (current_volume >= 0),
  uom               text NOT NULL REFERENCES master.uom (code),
  freeze_thaw_count integer NOT NULL DEFAULT 0 CHECK (freeze_thaw_count >= 0),
  max_freeze_thaw   integer NOT NULL DEFAULT 3 CHECK (max_freeze_thaw > 0),
  status            text NOT NULL DEFAULT 'STORED'
                    CHECK (status IN ('STORED', 'IN_USE', 'DEPLETED', 'DISPOSED', 'TRANSFERRED')),
  notes             text,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        integer
);
CREATE INDEX ON rd.sample (org_unit_id, status);
CREATE INDEX ON rd.sample (project_id);

CREATE TABLE rd.sample_event (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  sample_id        uuid NOT NULL REFERENCES rd.sample (id),
  event_type       text NOT NULL CHECK (event_type IN ('RECEIVE', 'MOVE', 'THAW', 'REFREEZE', 'USE', 'ALIQUOT', 'DISPOSE')),
  volume_delta     numeric(18,6) NOT NULL DEFAULT 0,
  from_location_id uuid REFERENCES master.location (id),
  to_location_id   uuid REFERENCES master.location (id),
  experiment_id    uuid REFERENCES rd.experiment (id),
  is_quantitative  boolean NOT NULL DEFAULT false,
  reason           text,
  performed_by     integer NOT NULL REFERENCES core.user_profile (user_id),
  performed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rd.sample_event (sample_id, performed_at);

-- 5. Technology Transfer Package & Software Releases (D6)
CREATE TABLE rd.tech_transfer_package (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  project_id          uuid NOT NULL REFERENCES rd.project (id),
  target_domain       text NOT NULL CHECK (target_domain IN ('KIT', 'OLIGO', 'DEVICE', 'SOFTWARE')),
  target_org_unit_id  uuid NOT NULL REFERENCES core.org_unit (id),
  title               text NOT NULL,
  product_item_id     uuid REFERENCES master.item (id),
  bom_specification   jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{component_code, component_name, qty_per_kit, uom, role}]
  routing_steps       jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{seq, step_name, params, qc_check}]
  qc_spec_id          uuid REFERENCES qms.qc_spec (id),
  created_qc_spec_id  uuid REFERENCES qms.qc_spec (id),
  stability_summary   text NOT NULL,
  validation_summary  text NOT NULL,
  status              text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'COMPLETED')),
  submitted_by        integer REFERENCES core.user_profile (user_id),
  submitted_at        timestamptz,
  accepted_by         integer REFERENCES core.user_profile (user_id),
  accepted_at         timestamptz,
  completed_by        integer REFERENCES core.user_profile (user_id),
  completed_at        timestamptz,
  pilot_lot_ref       text,
  notes               text,
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer
);
CREATE INDEX ON rd.tech_transfer_package (project_id);
CREATE INDEX ON rd.tech_transfer_package (target_org_unit_id, status);

CREATE TABLE rd.software_release (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  code               text NOT NULL UNIQUE,
  project_id         uuid NOT NULL REFERENCES rd.project (id),
  version_tag        text NOT NULL,                           -- e.g. 'v2.4.0'
  target_kind        text NOT NULL DEFAULT 'STANDALONE' CHECK (target_kind IN ('FIRMWARE', 'ASSAY_CALLER', 'LIMS_PLUGIN', 'STANDALONE')),
  release_notes      text NOT NULL,
  checksum_sha256    text,
  attachment_id      uuid REFERENCES core.attachment (id),
  validation_summary text,
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'RELEASED', 'WITHDRAWN')),
  released_by        integer REFERENCES core.user_profile (user_id),
  released_at        timestamptz,
  withdraw_reason    text,
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         integer,
  UNIQUE (project_id, version_tag)
);

-- 6. Weekly R&D Work Plans & KPI Evaluation (docs/nha-may/01 §8 & 02 §6)
CREATE SCHEMA IF NOT EXISTS work;

CREATE TABLE work.work_plan (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  code          text NOT NULL UNIQUE,
  user_id       integer NOT NULL REFERENCES core.user_profile (user_id),
  org_unit_id   uuid NOT NULL REFERENCES core.org_unit (id),
  week_start    date NOT NULL,
  summary_notes text,
  status        text NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'NEEDS_REVISION', 'CLOSED')),
  submitted_at  timestamptz,
  approved_by   integer REFERENCES core.user_profile (user_id),
  approved_at   timestamptz,
  review_note   text,
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer,
  UNIQUE (user_id, week_start)
);
CREATE INDEX ON work.work_plan (org_unit_id, week_start);

CREATE TABLE work.work_task (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  plan_id             uuid NOT NULL REFERENCES work.work_plan (id),
  title               text NOT NULL,
  day_of_week         integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1 = Mon .. 7 = Sun
  time_slot           text NOT NULL DEFAULT 'ALL_DAY',
  project_id          uuid REFERENCES rd.project (id),
  experiment_id       uuid REFERENCES rd.experiment (id),
  target_metric       text,
  is_unplanned        boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'PLANNED'
                      CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'DONE', 'DEFERRED', 'REPLACED')),
  result_summary      text,
  efficiency_rating   integer CHECK (efficiency_rating BETWEEN 1 AND 5),
  manager_comment     text,
  defer_category      text CHECK (defer_category IN ('OBJECTIVE', 'SUBJECTIVE')),
  defer_reason        text,
  replaced_by_task_id uuid REFERENCES work.work_task (id),
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer
);
CREATE INDEX ON work.work_task (plan_id, day_of_week);

-- Numbering sequences & default configuration (not demo data)
INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('RD_GOAL',          'Mục tiêu chiến lược R&D',    'SG{YY}-{NNN}'),
  ('RD_IDEA',          'Ý tưởng R&D',                'ID{YY}{MM}-{NNN}'),
  ('RD_PROJECT',       'Dự án R&D',                  'PRJ{YY}-{NNN}'),
  ('RD_EXPERIMENT',    'Thí nghiệm ELN',             'EXP{YY}{MM}-{NNNN}'),
  ('RD_SAMPLE',        'Mẫu sinh học Biobank',       'SMP{YY}{MM}-{NNNN}'),
  ('RD_TECH_TRANSFER', 'Gói chuyển giao công nghệ',  'TT{YY}-{NNN}'),
  ('RD_SW_RELEASE',    'Phiên bản phần mềm R&D',     'SWR{YY}-{NNN}'),
  ('WORK_PLAN',        'Kế hoạch tuần nhân sự',      'WP{YY}{MM}-{NNNN}')
ON CONFLICT (sequence_key) DO NOTHING;

-- Standard weighted evaluation criteria for the Idea Funnel (configurable in database)
INSERT INTO rd.evaluation_criterion (eval_type, code, name, weight, scale_max) VALUES
  ('TECH', 'TECH_FEASIBILITY', 'Tính khả thi kỹ thuật & quy trình',        40, 5),
  ('TECH', 'TECH_INNOVATION',  'Mức độ đổi mới công nghệ / IP',            35, 5),
  ('TECH', 'TECH_RESOURCES',   'Sẵn sàng nguồn lực, thiết bị & mẫu chuẩn', 25, 5),
  ('BIZ',  'BIZ_MARKET',       'Quy mô thị trường & nhu cầu khách hàng',   40, 5),
  ('BIZ',  'BIZ_ROI',          'Hiệu quả kinh tế (ROI & giá vốn mục tiêu)', 35, 5),
  ('BIZ',  'BIZ_STRATEGY',     'Phù hợp định hướng chiến lược ABT',        25, 5)
ON CONFLICT (code) DO NOTHING;

-- Standard ISO 13485 / IVD Stage-Gate templates (Gate 0..4)
DO $$
DECLARE
  tpl_kit uuid;
  tpl_sw  uuid;
  tpl_dev uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rd.gate_template WHERE code = 'SG_IVD_KIT') THEN
    INSERT INTO rd.gate_template (code, name, domain)
    VALUES ('SG_IVD_KIT', 'Stage-Gate Kit Chẩn đoán IVD / Sinh học phân tử (ISO 13485)', 'KIT')
    RETURNING id INTO tpl_kit;

    INSERT INTO rd.gate_template_item (template_id, gate_no, gate_name, stage_after, seq, item_name, doc_type, is_required) VALUES
      (tpl_kit, 0, 'Gate 0: Khởi tạo & Định hướng (Concept & TPP)', 'G1_FEASIBILITY', 1, 'Hồ sơ yêu cầu sản phẩm mục tiêu (Target Product Profile - TPP)', 'TPP', true),
      (tpl_kit, 0, 'Gate 0: Khởi tạo & Định hướng (Concept & TPP)', 'G1_FEASIBILITY', 2, 'Phân tích rủi ro sơ bộ (ISO 14971 Preliminary Hazard Analysis)', 'RISK_ISO14971', true),
      (tpl_kit, 1, 'Gate 1: Khả thi & Thiết kế mồi/probe (Feasibility)', 'G2_DEVELOPMENT', 1, 'Thiết kế In-silico Primer/Probe & Báo cáo thử nghiệm khả thi (ELN)', 'FORMULATION', true),
      (tpl_kit, 1, 'Gate 1: Khả thi & Thiết kế mồi/probe (Feasibility)', 'G2_DEVELOPMENT', 2, 'Dự thảo cấu trúc BOM & Quy cách đóng gói Kit', 'BOM_DRAFT', true),
      (tpl_kit, 2, 'Gate 2: Tối ưu hóa & Xác nhận hiệu năng phân tích (Design Verification)', 'G3_VALIDATION', 1, 'Báo cáo hiệu năng phân tích: LoD, Độ lặp lại, Độ đặc hiệu / Nhiễm chéo', 'ANALYTICAL_VAL', true),
      (tpl_kit, 2, 'Gate 2: Tối ưu hóa & Xác nhận hiệu năng phân tích (Design Verification)', 'G3_VALIDATION', 2, 'Đề cương & Kết quả độ ổn định tăng tốc / mở nắp (ISO 23640)', 'STABILITY_ISO23640', true),
      (tpl_kit, 3, 'Gate 3: Thẩm định thiết kế & Đánh giá lâm sàng (Design Validation)', 'G4_TRANSFER', 1, 'Báo cáo đánh giá mẫu lâm sàng / ngoại kiểm & Độ ổn định 3 lô Pilot', 'CLINICAL_EVAL', true),
      (tpl_kit, 3, 'Gate 3: Thẩm định thiết kế & Đánh giá lâm sàng (Design Validation)', 'G4_TRANSFER', 2, 'Dự thảo Hướng dẫn sử dụng (IFU), Nhãn & Tiêu chuẩn QC xuất xưởng', 'IFU_SPEC', true),
      (tpl_kit, 4, 'Gate 4: Chuyển giao sản xuất & Hồ sơ DHF/DMR (Design Transfer)', 'TRANSFERRED', 1, 'Hồ sơ chuyển giao công nghệ (BOM, Routing/SOP, QC Spec) & Tổng kết DHF', 'DHF_DMR', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM rd.gate_template WHERE code = 'SG_SOFTWARE') THEN
    INSERT INTO rd.gate_template (code, name, domain)
    VALUES ('SG_SOFTWARE', 'Stage-Gate Phần mềm / Thuật toán Y sinh (IEC 62304)', 'SOFTWARE')
    RETURNING id INTO tpl_sw;

    INSERT INTO rd.gate_template_item (template_id, gate_no, gate_name, stage_after, seq, item_name, doc_type, is_required) VALUES
      (tpl_sw, 0, 'Gate 0: Yêu cầu người dùng & Phân loại an toàn', 'G1_ARCHITECTURE', 1, 'Đặc tả yêu cầu phần mềm (SRS) & Phân tích rủi ro IEC 62304', 'SRS_RISK', true),
      (tpl_sw, 1, 'Gate 1: Kiến trúc & Thiết kế chi tiết', 'G2_IMPLEMENTATION', 1, 'Tài liệu thiết kế kiến trúc (SDS) & Giao thức tích hợp', 'SDS', true),
      (tpl_sw, 2, 'Gate 2: Kiểm thử tích hợp & Xác nhận thuật toán', 'G3_RELEASE', 1, 'Báo cáo kiểm thử tự động / xác minh thuật toán trên bộ dữ liệu chuẩn', 'VERIFICATION_REPORT', true),
      (tpl_sw, 3, 'Gate 3: Thẩm định phát hành (Release Validation)', 'TRANSFERRED', 1, 'Biên bản nghiệm thu UAT, Release Notes & Mã băm bản dựng', 'RELEASE_VAL', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM rd.gate_template WHERE code = 'SG_DEVICE_DHF') THEN
    INSERT INTO rd.gate_template (code, name, domain)
    VALUES ('SG_DEVICE_DHF', 'Stage-Gate Thiết bị Phòng Lab / Y tế (ISO 13485 DHF)', 'DEVICE')
    RETURNING id INTO tpl_dev;

    INSERT INTO rd.gate_template_item (template_id, gate_no, gate_name, stage_after, seq, item_name, doc_type, is_required) VALUES
      (tpl_dev, 0, 'Gate 0: Khái niệm & PRD', 'G1_DESIGN_BOM', 1, 'Tài liệu yêu cầu sản phẩm (PRD) & Phân tích FTO', 'PRD_FTO', true),
      (tpl_dev, 1, 'Gate 1: Thiết kế CAD/Mạch & dFMEA', 'G2_PROTOTYPE', 1, 'Bản vẽ CAD, Sơ đồ mạch, BOM nháp & Phân tích rủi ro dFMEA (ISO 14971)', 'CAD_DFMEA', true),
      (tpl_dev, 2, 'Gate 2: Mẫu thử & Kiểm nghiệm DVP', 'G3_PILOT', 1, 'Báo cáo kiểm định mẫu thử (DVP) & An toàn điện IEC 61010', 'DVP_IEC61010', true),
      (tpl_dev, 3, 'Gate 3: Lô Pilot & Chuyển giao DMR', 'TRANSFERRED', 1, 'Hồ sơ Device Master Record (DMR) & Kết quả chạy Pilot', 'DMR', true);
  END IF;
END $$;
