-- 0040_rd_project_eln_edit_delete.sql
-- Granular edit/delete permissions for R&D Stage-Gate Projects and Electronic Lab Notebook (ELN)

INSERT INTO core.permission (code, module, action, description, is_gxp_critical, is_active)
VALUES
  (
    'rd.project.edit',
    'rd',
    'project.edit',
    'Chỉnh sửa thông tin dự án R&D (tên, loại đề tài, lĩnh vực, phân loại IVD, chủ nhiệm, ngân sách, tiến độ, trạng thái)',
    false,
    true
  ),
  (
    'rd.project.delete',
    'rd',
    'project.delete',
    'Xóa dự án R&D khỏi hệ thống (ghi nhật ký kiểm toán)',
    true,
    true
  ),
  (
    'rd.eln.edit',
    'rd',
    'eln.edit',
    'Chỉnh sửa thông tin sổ thí nghiệm điện tử ELN (tiêu đề, mục tiêu, giả thuyết, quy trình, phạm vi, NCV, mã WBS, trạng thái)',
    false,
    true
  ),
  (
    'rd.eln.delete',
    'rd',
    'eln.delete',
    'Xóa sổ thí nghiệm điện tử ELN chưa ký duyệt / chưa xuất vật tư kho (ghi nhật ký kiểm toán)',
    true,
    true
  )
ON CONFLICT (code) DO UPDATE SET
  description = EXCLUDED.description,
  is_gxp_critical = EXCLUDED.is_gxp_critical,
  is_active = true;

-- Grant Project & ELN edit/delete defaults to R&D Heads, QA Head, and Board of Directors
INSERT INTO core.role_permission (role_id, permission_code)
SELECT r.id, p.code
  FROM core.role r
 CROSS JOIN (
   VALUES ('rd.project.edit'), ('rd.project.delete'), ('rd.eln.edit'), ('rd.eln.delete')
 ) AS p(code)
 WHERE r.code IN ('RD_HEAD', 'RD_TRUONG_PHONG', 'QA_HEAD', 'BAN_GIAM_DOC')
ON CONFLICT DO NOTHING;

-- Grant Project edit/delete defaults to Engineering/Device Heads (software / device DHF projects)
INSERT INTO core.role_permission (role_id, permission_code)
SELECT r.id, p.code
  FROM core.role r
 CROSS JOIN (
   VALUES ('rd.project.edit'), ('rd.project.delete')
 ) AS p(code)
 WHERE r.code IN ('DEVICE_HEAD', 'DEVICE_TRUONG_PHONG')
ON CONFLICT DO NOTHING;
