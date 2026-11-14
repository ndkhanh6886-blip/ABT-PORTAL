-- 0035_iso_audit_remediation.sql
-- Consolidates all runtime DDL into versioned migrations, seeds missing numbering sequences,
-- strengthens ISO 13485 / IEC 62304 / 21 CFR Part 11 auditability & immutability,
-- and adds missing performance indexes for high-volume queries.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Missing Numbering Sequences (prevents runtime crashes and count(*)+1 race conditions)
INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('KD_PO_OLIGO',     'Lệnh tổng hợp Oligo từ Đơn Nội bộ',    'PO-OLI-{YY}{MM}-{NNNN}'),
  ('RD_TRANSFER',     'Gói chuyển giao công nghệ R&D (Alias)', 'TTP{YY}-{NNNN}'),
  ('QC_REF_STD',      'Mẫu chuẩn đối chứng QA/QC',            'STD-{YY}{MM}-{NNNN}'),
  ('QC_METHOD',       'Phương pháp kiểm nghiệm QA/QC',         'MTH-{YY}{MM}-{NNNN}'),
  ('QC_RETENTION',    'Mẫu lưu đối chứng QA/QC',              'RET-{YY}{MM}-{NNNN}'),
  ('RD_PROJECT_TASK', 'Công việc dự án R&D',                   'TSK-{YY}-{NNNN}')
ON CONFLICT (sequence_key) DO NOTHING;

-- 2. Core Import Log & Master/Inventory Extensions
CREATE TABLE IF NOT EXISTS core.excel_import_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key          varchar(60) NOT NULL,
  template_name         varchar(200) NOT NULL,
  target_dept_code      varchar(40),
  target_warehouse_code varchar(40),
  file_name             varchar(255) NOT NULL,
  total_rows            int NOT NULL DEFAULT 0,
  created_count         int NOT NULL DEFAULT 0,
  updated_count         int NOT NULL DEFAULT 0,
  error_count           int NOT NULL DEFAULT 0,
  errors_json           jsonb NOT NULL DEFAULT '[]'::jsonb,
  actor_id              int,
  actor_name            varchar(150),
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE master.uom ALTER COLUMN dimension SET DEFAULT 'COUNT';

ALTER TABLE master.item
  ADD COLUMN IF NOT EXISTS kd_unit                  text,
  ADD COLUMN IF NOT EXISTS kd_unit_factor           numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_safety_stock         numeric(18,6) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS reorder_qty              numeric(18,6) NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS lead_time_days           int NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS std_unit_cost            numeric(18,4) NOT NULL DEFAULT 220000,
  ADD COLUMN IF NOT EXISTS daily_burn_rate_override numeric(18,4);

ALTER TABLE master.item ALTER COLUMN receipt_qc_required SET DEFAULT true;

ALTER TABLE master.partner
  ADD COLUMN IF NOT EXISTS asl_status      text NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS lead_time_days  int NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS category_domain text NOT NULL DEFAULT 'BIOCHEM';

ALTER TABLE purchase.purchase_request
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL';

ALTER TABLE intake.internal_order_line
  ADD COLUMN IF NOT EXISTS supply_form   text,
  ADD COLUMN IF NOT EXISTS tube_code     text,
  ADD COLUMN IF NOT EXISTS specification text,
  ADD COLUMN IF NOT EXISTS line_notes    text;

ALTER TABLE inv.lot
  ADD COLUMN IF NOT EXISTS freeze_thaw_count   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_freeze_thaw     int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_thaw_at        timestamptz,
  ADD COLUMN IF NOT EXISTS last_thaw_by        text,
  ADD COLUMN IF NOT EXISTS storage_temp_actual text DEFAULT '-20°C',
  ADD COLUMN IF NOT EXISTS unit_cost           numeric(18,4) NOT NULL DEFAULT 185000;

ALTER TABLE inv.container
  ADD COLUMN IF NOT EXISTS opened_at            timestamptz,
  ADD COLUMN IF NOT EXISTS open_expiry_date     date,
  ADD COLUMN IF NOT EXISTS max_open_hours       int,
  ADD COLUMN IF NOT EXISTS open_expires_at      timestamptz;

-- 3. Asset & Reagent Slot Extensions (plus HPLC carryover & on-board stability)
ALTER TABLE asset.asset DROP CONSTRAINT IF EXISTS asset_code_check;
ALTER TABLE asset.asset
  ADD COLUMN IF NOT EXISTS location              text,
  ADD COLUMN IF NOT EXISTS equipment_category    text,
  ADD COLUMN IF NOT EXISTS last_calibration_date date,
  ADD COLUMN IF NOT EXISTS notes                 text;

ALTER TABLE asset.reagent_slot
  ADD COLUMN IF NOT EXISTS bottle_volume_base   numeric(14,4) NOT NULL DEFAULT 2500,
  ADD COLUMN IF NOT EXISTS std_qty_per_run      numeric(14,4) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS std_qty_per_purge    numeric(14,4) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS bottle_price_vnd     numeric(18,2) NOT NULL DEFAULT 1850000,
  ADD COLUMN IF NOT EXISTS design_runs          integer NOT NULL DEFAULT 140,
  ADD COLUMN IF NOT EXISTS open_stability_hours integer;

ALTER TABLE asset.lc_column
  ADD COLUMN IF NOT EXISTS lot_code               text,
  ADD COLUMN IF NOT EXISTS catalog_code           text,
  ADD COLUMN IF NOT EXISTS brand                  text DEFAULT 'Waters',
  ADD COLUMN IF NOT EXISTS initial_used_runs      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_runs_override integer,
  ADD COLUMN IF NOT EXISTS last_molecule_type     text,
  ADD COLUMN IF NOT EXISTS last_cleaned_at        timestamptz;

-- 4. Oligo Extensions
ALTER TABLE oligo.synth_port
  ADD COLUMN IF NOT EXISTS item_id              uuid REFERENCES master.item (id),
  ADD COLUMN IF NOT EXISTS open_stability_hours integer;

ALTER TABLE oligo.oligo_order
  ADD COLUMN IF NOT EXISTS pricing_type     text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS price_percentage numeric(6,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS vat_rate         numeric(5,2) NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS total_price      numeric(18,2) NOT NULL DEFAULT 0;

ALTER TABLE oligo.oligo_sequence
  ADD COLUMN IF NOT EXISTS unit_price           numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price                numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_lines_json     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS oligo_role           text NOT NULL DEFAULT 'PRIMER',
  ADD COLUMN IF NOT EXISTS target_pathogen      text,
  ADD COLUMN IF NOT EXISTS synthesis_scale_code text;

CREATE TABLE IF NOT EXISTS oligo.price_config (
  id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);

-- 5. QMS / QA / COA / SPC Extensions & Append-Only Restoration
CREATE TABLE IF NOT EXISTS qms.qc_spec_item (
  spec_id    uuid NOT NULL REFERENCES qms.qc_spec (id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES master.item (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spec_id, item_id)
);

CREATE TABLE IF NOT EXISTS qms.reference_standard (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                varchar(40) NOT NULL UNIQUE,
  name                varchar(250) NOT NULL,
  standard_type       varchar(40) NOT NULL CHECK (standard_type IN (
                        'POSITIVE_CONTROL', 'NEGATIVE_CONTROL', 'LOD_PANEL',
                        'SPECIFICITY_PANEL', 'INTERNAL_CONTROL', 'CALIBRATOR', 'CHEMICAL_STD'
                      )),
  target_domain       varchar(30) NOT NULL DEFAULT 'KIT' CHECK (target_domain IN ('KIT', 'OLIGO', 'DEVICE', 'RAW_MATERIAL', 'ALL')),
  lot_no              varchar(80) NOT NULL,
  source_strain       varchar(200),
  concentration       varchar(120),
  target_metric       varchar(80) NOT NULL DEFAULT 'Ct Value',
  target_value        numeric(18,4),
  lower_limit         numeric(18,4),
  upper_limit         numeric(18,4),
  unit                varchar(40) DEFAULT 'Ct',
  storage_condition   varchar(80) DEFAULT '-20°C đến -80°C',
  storage_location    varchar(120) DEFAULT 'Tủ âm sâu KHO-QA · Kệ A1',
  aliquots_total      int NOT NULL DEFAULT 50 CHECK (aliquots_total >= 0),
  aliquots_remaining  int NOT NULL DEFAULT 50 CHECK (aliquots_remaining >= 0),
  max_freeze_thaw     int NOT NULL DEFAULT 3 CHECK (max_freeze_thaw >= 1),
  current_freeze_thaw int NOT NULL DEFAULT 0 CHECK (current_freeze_thaw >= 0),
  mfg_date            date,
  expiry_date         date,
  status              varchar(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPLETED', 'EXPIRED', 'QUARANTINE')),
  notes               text,
  created_by          int,
  updated_by          int,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qms.qc_method (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   varchar(40) NOT NULL UNIQUE,
  version_no             int NOT NULL DEFAULT 1,
  name                   varchar(250) NOT NULL,
  category               varchar(50) NOT NULL DEFAULT 'QPCR_ASSAY' CHECK (category IN (
                           'QPCR_ASSAY', 'HPLC_CHROMATOGRAPHY', 'PAGE_ELECTROPHORESIS',
                           'UV_VIS_OD', 'ELECTRICAL_SAFETY', 'MECHANICAL_DIMENSIONAL', 'PHYSICOCHEMICAL'
                         )),
  instrument_type        varchar(150),
  required_standard_type varchar(50),
  principle              text,
  sop_steps              jsonb NOT NULL DEFAULT '[]'::jsonb,
  suitability_criteria   text,
  validation_summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 varchar(30) NOT NULL DEFAULT 'EFFECTIVE' CHECK (status IN ('DRAFT', 'VALIDATED', 'EFFECTIVE', 'OBSOLETE')),
  approved_by            int,
  approved_at            timestamptz,
  created_by             int,
  updated_by             int,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qms.reference_standard_usage (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id           uuid NOT NULL REFERENCES qms.reference_standard (id) ON DELETE CASCADE,
  test_id               uuid REFERENCES qms.qc_test (id) ON DELETE SET NULL,
  measured_value        numeric(18,4),
  measured_text         varchar(200),
  passed                boolean NOT NULL DEFAULT true,
  aliquots_used         int NOT NULL DEFAULT 1,
  freeze_thaw_increment int NOT NULL DEFAULT 1,
  notes                 text,
  used_by               int,
  used_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qms.retention_sample (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             varchar(40) NOT NULL UNIQUE,
  lot_id           uuid REFERENCES inv.lot (id) ON DELETE SET NULL,
  item_id          uuid NOT NULL REFERENCES master.item (id),
  sample_category  varchar(40) NOT NULL DEFAULT 'FINISHED_KIT' CHECK (sample_category IN ('RAW_MATERIAL', 'SEMI_FINISHED', 'FINISHED_KIT', 'OLIGO')),
  qty_retained     numeric(14,4) NOT NULL DEFAULT 2,
  uom              varchar(30) NOT NULL DEFAULT 'kit',
  storage_temp     varchar(60) NOT NULL DEFAULT '-20°C',
  storage_location varchar(120) NOT NULL DEFAULT 'KHO-QA · Tủ Mẫu Lưu R1',
  retained_date    date NOT NULL DEFAULT CURRENT_DATE,
  retain_until_date date,
  stability_months int[] NOT NULL DEFAULT ARRAY[0,3,6,9,12,24],
  last_checked_at  timestamptz,
  status           varchar(30) NOT NULL DEFAULT 'STORED' CHECK (status IN ('STORED', 'IN_STABILITY_TEST', 'CONSUMED', 'DISPOSED')),
  notes            text,
  created_by       int,
  updated_by       int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qms.coa_template_config (
  id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name           text NOT NULL DEFAULT 'CÔNG TY TNHH GIẢI PHÁP Y SINH ABT — ABT BIOLOGICAL SOLUTIONS CO., LTD',
  document_title         text NOT NULL DEFAULT 'GIẤY CHỨNG NHẬN PHÂN TÍCH / CERTIFICATE OF ANALYSIS (COA)',
  iso_subtitle           text NOT NULL DEFAULT 'Do Phòng QA/QC Cấp Phát (ISO 13485:2016 & GMP-IVD)',
  address_line           text NOT NULL DEFAULT 'Nhà máy & Phòng Lab QA/QC Đạt Chuẩn ISO 13485:2016',
  footer_statement       text NOT NULL DEFAULT 'Chứng nhận điện tử cấp bởi Phòng QA/QC tuân thủ 21 CFR Part 11 & ISO 13485',
  approver_title         text NOT NULL DEFAULT 'Phòng QA/QC Phê duyệt & Cấp COA / Approved by QA/QC:',
  results_display_mode   text NOT NULL DEFAULT 'MEASURED_VALUES',
  default_coa_parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by             int,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE qms.coa_template_config ALTER COLUMN results_display_mode SET DEFAULT 'MEASURED_VALUES';
INSERT INTO qms.coa_template_config (id, results_display_mode) VALUES (1, 'MEASURED_VALUES') ON CONFLICT (id) DO NOTHING;
UPDATE qms.coa_template_config
   SET results_display_mode = 'MEASURED_VALUES', updated_at = now()
 WHERE id = 1 AND results_display_mode = 'SUMMARY_TEMPLATE';

CREATE TABLE IF NOT EXISTS qms.spc_control_series (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            varchar(50) NOT NULL UNIQUE,
  name            varchar(250) NOT NULL,
  department      varchar(40) NOT NULL DEFAULT 'KIT',
  parameter_name  varchar(120) NOT NULL,
  unit            varchar(40) NOT NULL DEFAULT 'Ct',
  target_mean     numeric(18,4) NOT NULL,
  sd_value        numeric(18,4) NOT NULL CHECK (sd_value > 0),
  spec_lower      numeric(18,4),
  spec_upper      numeric(18,4),
  instrument_code varchar(80),
  standard_code   varchar(80),
  status          varchar(30) NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qms.spc_control_point (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id       uuid NOT NULL REFERENCES qms.spc_control_series (id) ON DELETE CASCADE,
  seq             int NOT NULL,
  batch_or_lot_code varchar(80) NOT NULL,
  measured_value  numeric(18,4) NOT NULL,
  z_score         numeric(10,4) NOT NULL DEFAULT 0,
  westgard_rule   varchar(30) NOT NULL DEFAULT 'OK',
  westgard_status varchar(30) NOT NULL DEFAULT 'IN_CONTROL',
  analyst_name    varchar(120) DEFAULT 'QC Analyst',
  measured_at     date NOT NULL DEFAULT CURRENT_DATE,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE qms.deviation
  ADD COLUMN IF NOT EXISTS category              text,
  ADD COLUMN IF NOT EXISTS capa_verified_by      integer,
  ADD COLUMN IF NOT EXISTS capa_verified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS effectiveness_summary text,
  ADD COLUMN IF NOT EXISTS affected_batches_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE qms.ncr
  ADD COLUMN IF NOT EXISTS qa_approved_by integer,
  ADD COLUMN IF NOT EXISTS qa_approved_at timestamptz;

ALTER TABLE kit.coa_certificate
  ADD COLUMN IF NOT EXISTS revision_no              int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS revision_reason          text,
  ADD COLUMN IF NOT EXISTS superseded_by_id         uuid REFERENCES kit.coa_certificate (id),
  ADD COLUMN IF NOT EXISTS superseded_at            timestamptz,
  ADD COLUMN IF NOT EXISTS qc_test_id               uuid,
  ADD COLUMN IF NOT EXISTS qc_test_code             text,
  ADD COLUMN IF NOT EXISTS spec_code                text,
  ADD COLUMN IF NOT EXISTS analyst_name             text,
  ADD COLUMN IF NOT EXISTS custom_notes             text,
  ADD COLUMN IF NOT EXISTS spec_version             int,
  ADD COLUMN IF NOT EXISTS standard_usages_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS amended_from_id          uuid REFERENCES kit.coa_certificate (id),
  ADD COLUMN IF NOT EXISTS sha256_hash              text;

-- Restore true append-only immutability on kit.coa_certificate (21 CFR Part 11)
DROP TRIGGER IF EXISTS kit_coa_no_delete ON kit.coa_certificate;
DROP TRIGGER IF EXISTS kit_coa_append_only ON kit.coa_certificate;
CREATE TRIGGER kit_coa_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON kit.coa_certificate
  FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_change();

-- Allow USE_AS_IS concessions approved by QA + BOD while keeping strict guard for unresolved NCRs
CREATE OR REPLACE FUNCTION inv.enforce_lot_release_guards()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'RELEASED' AND OLD.status IS DISTINCT FROM 'RELEASED' THEN
    IF EXISTS (
      SELECT 1
        FROM qms.ncr n
       WHERE n.lot_id = NEW.id
         AND n.status <> 'CLOSED'
         AND NOT (n.disposition = 'USE_AS_IS' AND n.status = 'APPROVED')
    ) THEN
      RAISE EXCEPTION 'Không thể giải phóng lô (RELEASED) khi còn Phiếu KPH (NCR) chưa đóng hoặc chưa phê duyệt nhân nhượng cho lô %', NEW.code
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 6. Kit Module Extensions & Frozen Snapshots
ALTER TABLE kit.bom
  ADD COLUMN IF NOT EXISTS label_template_code    text,
  ADD COLUMN IF NOT EXISTS label_dimensions       text,
  ADD COLUMN IF NOT EXISTS udi_di                 text,
  ADD COLUMN IF NOT EXISTS ifu_code               text,
  ADD COLUMN IF NOT EXISTS ifu_version            text,
  ADD COLUMN IF NOT EXISTS ifu_intended_use       text,
  ADD COLUMN IF NOT EXISTS ifu_thermal_profile    text,
  ADD COLUMN IF NOT EXISTS ifu_channels           text,
  ADD COLUMN IF NOT EXISTS ifu_interpretation     text,
  ADD COLUMN IF NOT EXISTS bom_type               text DEFAULT 'finished_good',
  ADD COLUMN IF NOT EXISTS bom_category           text DEFAULT 'PCR Kit',
  ADD COLUMN IF NOT EXISTS variant_code           text DEFAULT 'BASE',
  ADD COLUMN IF NOT EXISTS supply_form            text DEFAULT 'NO_SPLIT_NO_IC',
  ADD COLUMN IF NOT EXISTS parent_item_code       text,
  ADD COLUMN IF NOT EXISTS tccs_code              text,
  ADD COLUMN IF NOT EXISTS tccs_file_name         text,
  ADD COLUMN IF NOT EXISTS tccs_file_url          text,
  ADD COLUMN IF NOT EXISTS registration_no        text,
  ADD COLUMN IF NOT EXISTS responsible_person_id  text,
  ADD COLUMN IF NOT EXISTS responsible_person_name text,
  ADD COLUMN IF NOT EXISTS qc_assignee_name       text,
  ADD COLUMN IF NOT EXISTS specification          text,
  ADD COLUMN IF NOT EXISTS storage_condition      text,
  ADD COLUMN IF NOT EXISTS shelf_life_months      int DEFAULT 12,
  ADD COLUMN IF NOT EXISTS qc_retention_qty       numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ph_min                 numeric,
  ADD COLUMN IF NOT EXISTS ph_max                 numeric,
  ADD COLUMN IF NOT EXISTS ifu_file_name          text,
  ADD COLUMN IF NOT EXISTS ifu_file_url           text,
  ADD COLUMN IF NOT EXISTS ifu_file_size          text,
  ADD COLUMN IF NOT EXISTS ifu_updated_at         timestamptz,
  ADD COLUMN IF NOT EXISTS ifu_aliquoted_file_name text,
  ADD COLUMN IF NOT EXISTS ifu_aliquoted_file_url text,
  ADD COLUMN IF NOT EXISTS ifu_aliquoted_file_size text,
  ADD COLUMN IF NOT EXISTS label_design_json      jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS routing_id             uuid REFERENCES kit.routing (id) ON DELETE SET NULL;

ALTER TABLE kit.routing ALTER COLUMN product_item_id DROP NOT NULL;
ALTER TABLE kit.routing ADD COLUMN IF NOT EXISTS routing_category text DEFAULT 'PCR Kit';
DROP INDEX IF EXISTS kit.kit_routing_one_effective;

ALTER TABLE kit.bom_line
  ADD COLUMN IF NOT EXISTS qty_per_base_aliquoted    numeric CHECK (qty_per_base_aliquoted IS NULL OR qty_per_base_aliquoted > 0),
  ADD COLUMN IF NOT EXISTS is_mix_component          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_demo_fixed_component   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS include_in_qc_retention   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bundle_parent_code        text;

ALTER TABLE kit.bom_line DROP CONSTRAINT IF EXISTS bom_line_component_role_check;
ALTER TABLE kit.bom_line ADD CONSTRAINT bom_line_component_role_check
  CHECK (component_role IN (
    'MASTER_MIX', 'PRIMER_PROBE', 'ENZYME', 'INTERNAL_CONTROL',
    'POSITIVE_CONTROL', 'NEGATIVE_CONTROL', 'EXTRACTION_BUFFER',
    'PCR_TUBE_STRIP', 'PACKAGING', 'SEMI_FINISHED', 'REAGENT'
  ));

DROP INDEX IF EXISTS kit.kit_bom_one_effective;
CREATE UNIQUE INDEX IF NOT EXISTS kit_bom_one_effective_variant
  ON kit.bom (product_item_id, upper(coalesce(nullif(trim(variant_code), ''), 'BASE')))
  WHERE status = 'EFFECTIVE';

ALTER TABLE kit.routing_step
  ADD COLUMN IF NOT EXISTS step_function    text DEFAULT 'FORMULATION_MIXING',
  ADD COLUMN IF NOT EXISTS work_center      text DEFAULT 'Phòng sạch Class 10.000 (ISO 7)',
  ADD COLUMN IF NOT EXISTS functional_flags jsonb DEFAULT '{}'::jsonb;

ALTER TABLE kit.production_step
  ADD COLUMN IF NOT EXISTS step_function      text DEFAULT 'FORMULATION_MIXING',
  ADD COLUMN IF NOT EXISTS work_center        text DEFAULT 'Phòng sạch Class 10.000 (ISO 7)',
  ADD COLUMN IF NOT EXISTS functional_flags   jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_to_name   text,
  ADD COLUMN IF NOT EXISTS shift_code         text DEFAULT 'CA_SANG',
  ADD COLUMN IF NOT EXISTS planned_date       date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS qc_gate_status     text DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS qc_verified_by_name text,
  ADD COLUMN IF NOT EXISTS qc_verified_at     timestamptz,
  ADD COLUMN IF NOT EXISTS qc_gate_note       text,
  ADD COLUMN IF NOT EXISTS qa_assignee_name   text;

ALTER TABLE kit.production_order
  ADD COLUMN IF NOT EXISTS line_clearance_passed     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS line_clearance_by         integer,
  ADD COLUMN IF NOT EXISTS line_clearance_at         timestamptz,
  ADD COLUMN IF NOT EXISTS line_clearance_checklist  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sample_qty                numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retain_qty                numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yield_pct                 numeric,
  ADD COLUMN IF NOT EXISTS materials_reconciled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_mode                text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS is_aliquoted              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_demo                   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_specification        text,
  ADD COLUMN IF NOT EXISTS qc_retention_qty          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_retention              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_ph                 numeric,
  ADD COLUMN IF NOT EXISTS planned_start_date        date,
  ADD COLUMN IF NOT EXISTS planned_end_date          date,
  ADD COLUMN IF NOT EXISTS team_lead_name            text,
  ADD COLUMN IF NOT EXISTS qa_assignee_name          text,
  ADD COLUMN IF NOT EXISTS qa_assigned_at            timestamptz,
  ADD COLUMN IF NOT EXISTS plan_note                 text,
  ADD COLUMN IF NOT EXISTS supply_form               text DEFAULT 'NO_SPLIT_NO_IC',
  ADD COLUMN IF NOT EXISTS tube_code                 text,
  ADD COLUMN IF NOT EXISTS bom_variant_code          text DEFAULT 'BASE',
  ADD COLUMN IF NOT EXISTS mix_tests_per_kit         int,
  ADD COLUMN IF NOT EXISTS pcr_tubes_per_kit         int,
  ADD COLUMN IF NOT EXISTS bom_snapshot_json         jsonb,
  ADD COLUMN IF NOT EXISTS packaging_snapshot_json   jsonb;

-- 7. Device Extensions
ALTER TABLE device.device_model
  ADD COLUMN IF NOT EXISTS specs_json           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accessories_standard jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accessories_optional jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS category_label       text,
  ADD COLUMN IF NOT EXISTS manufacturer         text DEFAULT 'CÔNG TY TNHH GIẢI PHÁP Y SINH ABT - CHI NHÁNH LONG HẬU',
  ADD COLUMN IF NOT EXISTS origin               text DEFAULT 'Việt Nam',
  ADD COLUMN IF NOT EXISTS price                numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_dealer1        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_dealer2        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days       int NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS image_url            text DEFAULT '/logo_abt.png',
  ADD COLUMN IF NOT EXISTS production_stages    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bom_json             jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS baseline_specs_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS base_model_code      text;

ALTER TABLE device.model_revision
  ADD COLUMN IF NOT EXISTS firmware_release_id uuid REFERENCES rd.software_release (id);

ALTER TABLE device.device_order
  ADD COLUMN IF NOT EXISTS lot_no text;

ALTER TABLE device.device_unit
  ADD COLUMN IF NOT EXISTS firmware_release_id  uuid REFERENCES rd.software_release (id),
  ADD COLUMN IF NOT EXISTS lot_id               uuid REFERENCES inv.lot (id),
  ADD COLUMN IF NOT EXISTS handover_accessories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assembled_by         integer,
  ADD COLUMN IF NOT EXISTS fqc_assignee_id      integer;

-- 8. R&D Extensions
ALTER TABLE rd.project
  ADD COLUMN IF NOT EXISTS leader_name_override   varchar(150),
  ADD COLUMN IF NOT EXISTS budget_amount          numeric(18,2) NOT NULL DEFAULT 50000000,
  ADD COLUMN IF NOT EXISTS target_product_item_id uuid REFERENCES master.item (id);

ALTER TABLE rd.experiment
  ADD COLUMN IF NOT EXISTS performer_name varchar(150),
  ADD COLUMN IF NOT EXISTS wbs_task_code  varchar(60);

ALTER TABLE rd.sample
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE rd.tech_transfer_package
  ADD COLUMN IF NOT EXISTS pilot_lot_ref text;

ALTER TABLE rd.software_release
  ADD COLUMN IF NOT EXISTS safety_class     text NOT NULL DEFAULT 'CLASS_B',
  ADD COLUMN IF NOT EXISTS srs_traceability jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS soup_list        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS known_anomalies  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_ref       text;

CREATE TABLE IF NOT EXISTS rd.project_task (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 varchar(40) NOT NULL UNIQUE,
  project_id           uuid NOT NULL REFERENCES rd.project (id) ON DELETE CASCADE,
  gate_no              int NOT NULL DEFAULT 1,
  title                varchar(250) NOT NULL,
  assignee_name        varchar(150),
  due_date             date,
  status               varchar(30) NOT NULL DEFAULT 'TODO',
  progress_pct         int NOT NULL DEFAULT 0,
  linked_experiment_id uuid REFERENCES rd.experiment (id) ON DELETE SET NULL,
  notes                text,
  created_by           int,
  updated_by           int,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  protocol_summary     text,
  result_summary       text,
  key_metrics_json     jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome_verdict      varchar(30) NOT NULL DEFAULT 'PENDING',
  next_steps           text,
  attachment_name      varchar(255),
  attachment_url       text,
  completed_at         timestamptz,
  completed_by_name    varchar(150)
);

CREATE TABLE IF NOT EXISTS rd.project_material_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES rd.project (id) ON DELETE CASCADE,
  gate_no        int,
  entry_type     varchar(30) NOT NULL CHECK (entry_type IN ('DIRECT_ISSUE', 'PR_REQUEST', 'OLIGO_TRIAL')),
  item_id        uuid REFERENCES master.item (id),
  lot_id         uuid REFERENCES inv.lot (id),
  qty            numeric(18,6) NOT NULL DEFAULT 0,
  uom            varchar(30),
  estimated_cost numeric(18,2) NOT NULL DEFAULT 0,
  ref_code       varchar(60),
  ref_entity_id  uuid,
  purpose        text,
  created_by     int,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rd.project_prototype_bom (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES rd.project (id) ON DELETE CASCADE,
  line_no           int NOT NULL,
  component_item_id uuid NOT NULL REFERENCES master.item (id),
  component_role    varchar(40) NOT NULL DEFAULT 'REAGENT',
  qty_per_base      numeric(18,6) NOT NULL CHECK (qty_per_base > 0),
  uom               varchar(30) NOT NULL,
  scrap_pct         numeric(6,2) NOT NULL DEFAULT 0,
  notes             text,
  created_by        int,
  updated_by        int,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, line_no)
);

-- 9. Performance & Audit Indexes
CREATE INDEX IF NOT EXISTS idx_master_item_code_trgm ON master.item USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_master_item_name_trgm ON master.item USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_inv_lot_code_trgm ON inv.lot USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_inv_lot_mfr_trgm ON inv.lot USING gin (mfr_lot_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_inv_stock_balance_active ON inv.stock_balance (location_id, item_id, lot_id) WHERE qty_on_hand > 0;
CREATE INDEX IF NOT EXISTS idx_inv_stock_balance_item_active ON inv.stock_balance (item_id, lot_id) WHERE qty_on_hand > 0;
CREATE INDEX IF NOT EXISTS idx_inv_lot_fefo ON inv.lot (item_id, status, expiry_date ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_inv_stock_doc_wh_created ON inv.stock_document (warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_stock_doc_code_trgm ON inv.stock_document USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_spc_point_series ON qms.spc_control_point (series_id, seq);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_occurred ON core.audit_log (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_e_signature_signer_signed ON core.e_signature (signer_id, signed_at DESC);
CREATE INDEX IF NOT EXISTS idx_oligo_seq_order_status ON oligo.oligo_sequence (order_id, status);
CREATE INDEX IF NOT EXISTS idx_oligo_seq_status_created ON oligo.oligo_sequence (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kit_order_internal_line ON kit.production_order (internal_order_line_id);
CREATE INDEX IF NOT EXISTS idx_kit_order_status_created ON kit.production_order (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qc_test_kind_status ON qms.qc_test (test_kind, status);
CREATE INDEX IF NOT EXISTS idx_deviation_severity_status ON qms.deviation (severity, status);
CREATE INDEX IF NOT EXISTS idx_ncr_lot_status ON qms.ncr (lot_id, status);
CREATE INDEX IF NOT EXISTS idx_device_unit_order_status ON device.device_unit (order_id, status);
CREATE INDEX IF NOT EXISTS idx_kit_coa_lot_rev ON kit.coa_certificate (lot_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS idx_kit_coa_order_rev ON kit.coa_certificate (production_order_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS idx_rd_project_task_proj ON rd.project_task (project_id, gate_no);
CREATE INDEX IF NOT EXISTS idx_rd_ledger_proj ON rd.project_material_ledger (project_id, created_at DESC);
