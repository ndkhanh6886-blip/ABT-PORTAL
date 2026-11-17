-- 0047_it_department_separation.sql
-- Phòng IT tách hẳn khỏi Phòng Kỹ thuật – Công nghệ (KTCN / P-DEVICE) và Khối Kỹ thuật:
-- đơn vị tổ chức riêng (module_key = 'IT'), dự án / hồ sơ phần mềm chuyển sang Phòng IT,
-- vai trò Kỹ thuật – Thiết bị không còn quyền ký phát hành phần mềm.

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'core.org_unit'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%module_key%'
  LOOP
    EXECUTE format('ALTER TABLE core.org_unit DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE core.org_unit
  ADD CONSTRAINT org_unit_module_key_check
  CHECK (module_key IN ('RD', 'KIT', 'OLIGO', 'DEVICE', 'IT', 'QA', 'WH', 'SALES', 'PURCHASE', 'HR', 'BOD'));

INSERT INTO core.org_unit (code, name, unit_type, parent_id, module_key, status)
SELECT 'P-IT', 'Phòng IT (Công nghệ thông tin & Phát triển phần mềm)', 'DEPARTMENT',
       (SELECT id FROM core.org_unit WHERE unit_type = 'COMPANY' ORDER BY created_at LIMIT 1), 'IT', 'ACTIVE'
 WHERE NOT EXISTS (SELECT 1 FROM core.org_unit WHERE code = 'P-IT');

UPDATE core.org_unit SET module_key = 'IT', status = 'ACTIVE' WHERE code = 'P-IT' AND (module_key IS DISTINCT FROM 'IT');

DO $$
DECLARE it_id uuid;
BEGIN
  SELECT id INTO it_id FROM core.org_unit WHERE code = 'P-IT';
  IF it_id IS NULL THEN RETURN; END IF;

  UPDATE rd.project
     SET owner_org_unit_id = it_id
   WHERE target_domain = 'SOFTWARE'
     AND owner_org_unit_id IN (SELECT id FROM core.org_unit WHERE module_key = 'DEVICE');

  UPDATE rd.tech_transfer_package
     SET target_org_unit_id = it_id
   WHERE target_domain = 'SOFTWARE'
     AND target_org_unit_id IN (SELECT id FROM core.org_unit WHERE module_key = 'DEVICE');

  UPDATE rd.sw_validation
     SET org_unit_id = it_id
   WHERE org_unit_id IN (SELECT id FROM core.org_unit WHERE module_key = 'DEVICE');
END $$;

-- Kỹ thuật – Thiết bị không còn quyền ký phát hành phần mềm (thuộc Phòng IT)
DELETE FROM core.role_permission
 WHERE permission_code LIKE 'rd.software.%'
   AND role_id IN (SELECT id FROM core.role WHERE code IN ('DEVICE_HEAD', 'DEVICE_STAFF'));
