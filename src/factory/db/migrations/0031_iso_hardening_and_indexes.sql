-- 0031_iso_hardening_and_indexes.sql
-- ISO 13485:2016, ISO 14971:2019, IEC 62304, WHO TRS 986 GMP & 21 CFR Part 11 Hardening:
-- 1. Consolidate runtime DDL tables & columns into formal schema migrations
-- 2. Correct Oligo modification catalog extinction coefficients (260 nm) and nearest-neighbor role
-- 3. Enforce DB-level lot release guard against open NCRs on inv.lot
-- 4. Add missing foreign-key & status indexes across inv, kit, qms, oligo, device, rd, and core.audit_log

-- ============================================================================
-- 1. CONSOLIDATE RUNTIME DDL TABLES & COLUMNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS qms.qc_spec_item (
  spec_id uuid NOT NULL REFERENCES qms.qc_spec(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES master.item(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spec_id, item_id)
);

INSERT INTO qms.qc_spec_item (spec_id, item_id)
SELECT id, item_id
  FROM qms.qc_spec
 WHERE item_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS qms.coa_template_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name text NOT NULL DEFAULT 'CÔNG TY TNHH GIẢI PHÁP Y SINH ABT — ABT BIOLOGICAL SOLUTIONS CO., LTD',
  document_title text NOT NULL DEFAULT 'GIẤY CHỨNG NHẬN PHÂN TÍCH / CERTIFICATE OF ANALYSIS (COA)',
  iso_subtitle text NOT NULL DEFAULT 'Do Phòng QA/QC Cấp Phát (ISO 13485:2016 & GMP-IVD)',
  address_line text NOT NULL DEFAULT 'Nhà máy & Phòng Lab QA/QC Đạt Chuẩn ISO 13485:2016',
  footer_statement text NOT NULL DEFAULT 'Chứng nhận điện tử cấp bởi Phòng QA/QC tuân thủ 21 CFR Part 11 & ISO 13485',
  approver_title text NOT NULL DEFAULT 'Phòng QA/QC Phê duyệt & Cấp COA / Approved by QA/QC:',
  results_display_mode text NOT NULL DEFAULT 'SUMMARY_TEMPLATE',
  default_coa_parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by int,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kit.coa_certificate
  ADD COLUMN IF NOT EXISTS revision_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS revision_reason text,
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid REFERENCES kit.coa_certificate(id),
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS qc_test_id uuid,
  ADD COLUMN IF NOT EXISTS qc_test_code text,
  ADD COLUMN IF NOT EXISTS spec_code text,
  ADD COLUMN IF NOT EXISTS uom text DEFAULT 'Kit',
  ADD COLUMN IF NOT EXISTS analyst_name text,
  ADD COLUMN IF NOT EXISTS custom_notes text;

ALTER TABLE qms.deviation
  ADD COLUMN IF NOT EXISTS category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'rd' AND table_name = 'risk_item' AND column_name = 'residual_rpn'
  ) THEN
    ALTER TABLE rd.risk_item
      ADD COLUMN residual_rpn integer GENERATED ALWAYS AS (residual_severity * residual_occurrence * residual_detection) STORED;
  END IF;
END $$;

ALTER TABLE device.device_unit
  ADD COLUMN IF NOT EXISTS assembled_by integer REFERENCES core.user_profile(user_id);

CREATE OR REPLACE VIEW device.unit AS
  SELECT * FROM device.device_unit;

CREATE OR REPLACE VIEW asset.instrument AS
  SELECT * FROM asset.asset;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'qc_result_instrument_asset_id_fkey'
  ) THEN
    ALTER TABLE qms.qc_result
      ADD CONSTRAINT qc_result_instrument_asset_id_fkey
      FOREIGN KEY (instrument_asset_id) REFERENCES asset.asset(id);
  END IF;
END $$;

-- ============================================================================
-- 2. OLIGO MODIFICATION CATALOG CHEMISTRY CORRECTIONS
-- ============================================================================

UPDATE oligo.modification
   SET ext_coeff_260 = 10000
 WHERE code = 'CY7' AND ext_coeff_260 = 199000;

UPDATE oligo.modification
   SET ext_coeff_260 = 11000
 WHERE code = 'DABCYL' AND ext_coeff_260 = 32000;

UPDATE oligo.modification
   SET nn_role = 'BASE'
 WHERE code IN ('5MC', '5-MC', 'M5C');

CREATE OR REPLACE VIEW oligo.modification_catalog AS
  SELECT * FROM oligo.modification;

-- ============================================================================
-- 3. DB TRIGGER: ENFORCE LOT RELEASE GUARDS ON inv.lot
-- ============================================================================

CREATE OR REPLACE FUNCTION inv.enforce_lot_release_guards()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'RELEASED' AND OLD.status IS DISTINCT FROM 'RELEASED' THEN
    IF EXISTS (
      SELECT 1
        FROM qms.ncr n
       WHERE n.lot_id = NEW.id
         AND n.status <> 'CLOSED'
    ) THEN
      RAISE EXCEPTION 'Không thể giải phóng lô (RELEASED) khi còn Phiếu KPH (NCR) chưa đóng cho lô %', NEW.code
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_lot_release_guards ON inv.lot;
CREATE TRIGGER trg_inv_lot_release_guards
  BEFORE UPDATE OF status ON inv.lot
  FOR EACH ROW
  EXECUTE FUNCTION inv.enforce_lot_release_guards();

-- ============================================================================
-- 4. FOREIGN-KEY & STATUS INDEXES
-- ============================================================================

-- inv
CREATE INDEX IF NOT EXISTS idx_inv_lot_item_status ON inv.lot(item_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_lot_expiry_date ON inv.lot(expiry_date);
CREATE INDEX IF NOT EXISTS idx_inv_stock_doc_line_doc ON inv.stock_document_line(document_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_doc_line_item_lot ON inv.stock_document_line(item_id, lot_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_item_lot ON inv.stock_ledger(item_id, lot_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_location ON inv.stock_ledger(location_id);
CREATE INDEX IF NOT EXISTS idx_inv_reservation_balance ON inv.reservation(balance_id);

-- kit
CREATE INDEX IF NOT EXISTS idx_kit_prod_order_status ON kit.production_order(status);
CREATE INDEX IF NOT EXISTS idx_kit_prod_order_bom ON kit.production_order(bom_id);
CREATE INDEX IF NOT EXISTS idx_kit_mat_cons_order ON kit.material_consumption(order_id);
CREATE INDEX IF NOT EXISTS idx_kit_mat_cons_lot ON kit.material_consumption(lot_id);
CREATE INDEX IF NOT EXISTS idx_kit_coa_cert_order ON kit.coa_certificate(production_order_id);
CREATE INDEX IF NOT EXISTS idx_kit_coa_cert_lot ON kit.coa_certificate(lot_id);

-- qms
CREATE INDEX IF NOT EXISTS idx_qms_qc_spec_item_spec ON qms.qc_spec_item(spec_id);
CREATE INDEX IF NOT EXISTS idx_qms_qc_spec_item_item ON qms.qc_spec_item(item_id);
CREATE INDEX IF NOT EXISTS idx_qms_qc_test_entity_status ON qms.qc_test(entity_type, entity_id, status);
CREATE INDEX IF NOT EXISTS idx_qms_qc_result_test ON qms.qc_result(test_id);
CREATE INDEX IF NOT EXISTS idx_qms_qc_result_instrument ON qms.qc_result(instrument_asset_id);
CREATE INDEX IF NOT EXISTS idx_qms_deviation_entity ON qms.deviation(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_qms_deviation_status ON qms.deviation(status);
CREATE INDEX IF NOT EXISTS idx_qms_ncr_lot_status ON qms.ncr(lot_id, status);
CREATE INDEX IF NOT EXISTS idx_qms_ncr_deviation ON qms.ncr(deviation_id);

-- oligo
CREATE INDEX IF NOT EXISTS idx_oligo_order_status ON oligo.oligo_order(status);
CREATE INDEX IF NOT EXISTS idx_oligo_seq_order_status ON oligo.oligo_sequence(order_id, status);
CREATE INDEX IF NOT EXISTS idx_oligo_batch_status ON oligo.synthesis_batch(status);

-- device
CREATE INDEX IF NOT EXISTS idx_device_model_status ON device.device_model(status);
CREATE INDEX IF NOT EXISTS idx_device_rev_model_status ON device.model_revision(model_id, status);
CREATE INDEX IF NOT EXISTS idx_device_order_status ON device.device_order(status);
CREATE INDEX IF NOT EXISTS idx_device_unit_order_status ON device.device_unit(order_id, status);
CREATE INDEX IF NOT EXISTS idx_device_unit_comp_unit ON device.device_unit_component(unit_id);
CREATE INDEX IF NOT EXISTS idx_device_subcontract_order_status ON device.subcontract_order(status);

-- rd
CREATE INDEX IF NOT EXISTS idx_rd_project_status ON rd.project(status);
CREATE INDEX IF NOT EXISTS idx_rd_project_gate_proj_status ON rd.project_gate(project_id, status);
CREATE INDEX IF NOT EXISTS idx_rd_spec_eval_proj_result ON rd.spec_evaluation(project_id, result);
CREATE INDEX IF NOT EXISTS idx_rd_risk_item_proj_status ON rd.risk_item(project_id, status);
CREATE INDEX IF NOT EXISTS idx_rd_experiment_proj_status ON rd.experiment(project_id, status);
CREATE INDEX IF NOT EXISTS idx_rd_sample_proj_status ON rd.sample(project_id, status);
CREATE INDEX IF NOT EXISTS idx_rd_sw_release_proj_status ON rd.software_release(project_id, status);

-- core.audit_log
CREATE INDEX IF NOT EXISTS idx_core_audit_log_entity ON core.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_core_audit_log_occurred_at ON core.audit_log(occurred_at DESC);
