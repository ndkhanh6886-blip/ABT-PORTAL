-- 0033_software_release_approval.sql
-- Phát hành / thu hồi phần mềm do Trưởng phòng chủ trì dự án (KTCN hoặc R&D) hoặc Ban Giám Đốc ký,
-- tách khỏi quyền lập bản phát hành (rd.transfer.manage). Phòng KTCN chủ trì dự án phần mềm.

INSERT INTO core.permission (code, module, action, description, is_gxp_critical) VALUES
  ('rd.software.release', 'rd', 'software.release', 'Ký phê duyệt phát hành / thu hồi phiên bản phần mềm (Trưởng phòng chủ trì dự án — KTCN hoặc R&D — hoặc Ban Giám Đốc)', true)
ON CONFLICT (code) DO NOTHING;

-- Roles that approve R&D stage gates (department heads) and the board approve releases
INSERT INTO core.role_permission (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'rd.software.release' FROM core.role_permission rp WHERE rp.permission_code = 'rd.gate.review'
ON CONFLICT DO NOTHING;
INSERT INTO core.role_permission (role_id, permission_code)
SELECT r.id, 'rd.software.release' FROM core.role r WHERE r.code IN ('BAN_GIAM_DOC', 'DEVICE_HEAD')
ON CONFLICT DO NOTHING;

-- KTCN runs software projects: head plans, reviews gates, approves releases; staff manage projects and draft releases
INSERT INTO core.role_permission (role_id, permission_code)
SELECT r.id, p.code FROM core.role r
  CROSS JOIN (VALUES ('rd.view'), ('rd.project.manage'), ('rd.gate.review'), ('rd.transfer.manage')) AS p(code)
 WHERE r.code = 'DEVICE_HEAD' AND EXISTS (SELECT 1 FROM core.permission WHERE code = p.code)
ON CONFLICT DO NOTHING;
INSERT INTO core.role_permission (role_id, permission_code)
SELECT r.id, p.code FROM core.role r
  CROSS JOIN (VALUES ('rd.view'), ('rd.project.manage'), ('rd.transfer.manage')) AS p(code)
 WHERE r.code = 'DEVICE_STAFF' AND EXISTS (SELECT 1 FROM core.permission WHERE code = p.code)
ON CONFLICT DO NOTHING;
