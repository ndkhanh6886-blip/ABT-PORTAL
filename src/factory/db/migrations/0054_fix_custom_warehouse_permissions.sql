-- Fix custom warehouse permissions for users granted individual/group warehouse permissions (USER_CUSTOM_<id>)
-- 1. If a user's USER_CUSTOM_<id> role holds any warehouse or master item/warehouse permission,
--    remove accidental exclusions on inv.stock.view / master.data.view and ensure both are included
--    in USER_CUSTOM_<id> so company-wide warehouse view & operations work across all 6 factory warehouses.

DELETE FROM core.user_permission_exclusion upe
 WHERE upe.permission_code IN ('inv.stock.view', 'master.data.view')
   AND EXISTS (
     SELECT 1
       FROM core.user_role ur
       JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       JOIN core.role_permission rp ON rp.role_id = r.id
      WHERE ur.user_id = upe.user_id
        AND ur.revoked_at IS NULL
        AND r.code = 'USER_CUSTOM_' || upe.user_id::text
        AND (rp.permission_code LIKE 'inv.%' OR rp.permission_code LIKE 'master.%')
   );

INSERT INTO core.role_permission (role_id, permission_code)
SELECT DISTINCT r.id, p.code
  FROM core.role r
  JOIN core.role_permission rp ON rp.role_id = r.id
  CROSS JOIN (VALUES ('inv.stock.view'), ('master.data.view')) AS p(code)
 WHERE r.code LIKE 'USER_CUSTOM_%'
   AND r.status = 'ACTIVE'
   AND (rp.permission_code LIKE 'inv.%' OR rp.permission_code LIKE 'master.%')
   AND EXISTS (SELECT 1 FROM core.permission cp WHERE cp.code = p.code)
ON CONFLICT DO NOTHING;
