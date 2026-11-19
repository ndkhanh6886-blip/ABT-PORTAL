-- 0051_partner_contact_and_oligo_qc_spec.sql
-- 1. Ensure master.partner has inline contact_name, phone, email, and asl_status columns for subcontract vendors and suppliers.
-- 2. Seed a default EFFECTIVE Oligo QC specification (TC-OLIGO-STD) if no effective Oligo QC spec exists yet.

ALTER TABLE master.partner
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS phone        text,
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS asl_status   text NOT NULL DEFAULT 'APPROVED';

DO $$
DECLARE
  v_spec_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM qms.qc_spec WHERE applies_to = 'OLIGO' AND status = 'EFFECTIVE') THEN
    SELECT id INTO v_spec_id
      FROM qms.qc_spec
     WHERE code = 'TC-OLIGO-STD' AND spec_version = 1
     LIMIT 1;

    IF v_spec_id IS NULL THEN
      INSERT INTO qms.qc_spec (code, spec_version, name, applies_to, status, notes, effective_at)
      VALUES (
        'TC-OLIGO-STD',
        1,
        'Tiêu chuẩn Kiểm nghiệm Xuất xưởng Oligo',
        'OLIGO',
        'EFFECTIVE',
        'Tiêu chuẩn xuất xưởng mặc định cho trình tự Oligonucleotide (Tổng OD260, Hiệu suất thu hồi, Cảm quan).',
        now()
      )
      RETURNING id INTO v_spec_id;
    ELSE
      UPDATE qms.qc_spec
         SET status = 'EFFECTIVE',
             effective_at = COALESCE(effective_at, now()),
             updated_at = now()
       WHERE id = v_spec_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM qms.qc_spec_parameter WHERE spec_id = v_spec_id) THEN
      INSERT INTO qms.qc_spec_parameter
        (spec_id, seq, name, method, unit, value_type, lower_limit, upper_limit, target, is_critical, derived_metric)
      VALUES
        (v_spec_id, 1, 'Tổng OD260', 'Quang phổ UV 260nm (Nanodrop / Reader)', 'OD', 'NUMERIC', 0.05, NULL, '≥ 0.05 OD', true, 'OD_TOTAL'),
        (v_spec_id, 2, 'Hiệu suất thu hồi (nmol)', 'Tính từ OD260 và hệ số tắt phân tử', 'nmol', 'NUMERIC', 0.1, NULL, '≥ 0.1 nmol', true, 'YIELD_NMOL'),
        (v_spec_id, 3, 'Ngoại quan & Cảm quan ống thành phẩm', 'Kiểm tra trực quan', NULL, 'PASS_FAIL', NULL, NULL, 'Đạt', true, NULL);
    END IF;
  END IF;
END $$;
