-- 0041_remove_erroneous_rd_project_prj26_009.sql
-- Idempotently remove erroneous project PRJ26-009 created with premature TRANSFERRED status (0/5 gates passed, no handoffs)

DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT p.id, p.code, p.name, p.status, p.idea_id, p.owner_org_unit_id
    INTO rec
    FROM rd.project p
   WHERE p.code = 'PRJ26-009'
     AND p.name ILIKE '%xylene%formalin%'
     AND NOT EXISTS (SELECT 1 FROM rd.project_gate g WHERE g.project_id = p.id AND g.status = 'PASSED')
     AND NOT EXISTS (SELECT 1 FROM rd.tech_transfer_package ttp WHERE ttp.project_id = p.id AND ttp.status <> 'DRAFT')
     AND NOT EXISTS (SELECT 1 FROM rd.software_release sr WHERE sr.project_id = p.id AND sr.status <> 'DRAFT')
     AND NOT EXISTS (SELECT 1 FROM device.device_model dm WHERE dm.rd_project_id = p.id AND dm.status = 'COMMERCIAL')
     AND NOT EXISTS (
       SELECT 1
         FROM rd.sw_test_run tr
         JOIN rd.sw_test_case tc ON tc.id = tr.test_case_id
        WHERE tc.project_id = p.id
     )
   LIMIT 1;

  IF FOUND THEN
    UPDATE rd.experiment
       SET project_id = NULL,
           org_unit_id = COALESCE(org_unit_id, rec.owner_org_unit_id)
     WHERE project_id = rec.id;

    UPDATE rd.sample SET project_id = NULL WHERE project_id = rec.id;
    UPDATE work.work_task SET project_id = NULL WHERE project_id = rec.id;
    UPDATE device.device_model SET rd_project_id = NULL WHERE rd_project_id = rec.id;

    DELETE FROM rd.project_task WHERE project_id = rec.id;
    DELETE FROM rd.project_material_ledger WHERE project_id = rec.id;
    DELETE FROM rd.project_prototype_bom WHERE project_id = rec.id;
    DELETE FROM rd.gate_deliverable USING rd.project_gate pg
     WHERE pg.id = rd.gate_deliverable.project_gate_id
       AND pg.project_id = rec.id;
    DELETE FROM rd.project_gate WHERE project_id = rec.id;
    DELETE FROM rd.project_member WHERE project_id = rec.id;
    DELETE FROM rd.spec_evaluation WHERE project_id = rec.id;
    DELETE FROM rd.sw_test_case WHERE project_id = rec.id;
    DELETE FROM rd.sw_requirement WHERE project_id = rec.id;
    DELETE FROM rd.sw_problem WHERE project_id = rec.id;
    DELETE FROM rd.risk_item WHERE project_id = rec.id;
    DELETE FROM rd.roadmap_milestone WHERE project_id = rec.id;
    DELETE FROM rd.tech_transfer_package WHERE project_id = rec.id;
    DELETE FROM rd.software_release WHERE project_id = rec.id;
    DELETE FROM rd.project WHERE id = rec.id;

    IF rec.idea_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rd.project WHERE idea_id = rec.idea_id) THEN
      UPDATE rd.idea
         SET status = 'APPROVED',
             version = version + 1
       WHERE id = rec.idea_id
         AND status = 'CONVERTED';
    END IF;

    INSERT INTO core.audit_log (user_id, user_name, entity_type, entity_id, action, changes, reason)
    VALUES (
      1,
      'Quản Trị Viên Hệ Thống',
      'rd_project',
      rec.id::text,
      'delete',
      jsonb_build_object(
        'deleted', jsonb_build_array(false, true),
        'code', jsonb_build_array(rec.code, null),
        'name', jsonb_build_array(rec.name, null),
        'status', jsonb_build_array(rec.status, null)
      ),
      'Xóa dự án PRJ26-009 do nhân viên tạo sai theo yêu cầu quản trị viên'
    );
  END IF;
END $$;
