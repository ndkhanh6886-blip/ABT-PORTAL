-- 0042_rbac_user_permission_overrides.sql
-- Support per-user permission exclusions (revoking individual role-inherited permissions cleanly per person)
-- and trim over-broad production/warehouse execution rights from QA_HEAD & RD_HEAD default roles.

CREATE TABLE IF NOT EXISTS core.user_permission_exclusion (
  user_id         integer NOT NULL REFERENCES core.user_profile (user_id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES core.permission (code) ON DELETE CASCADE,
  reason          text,
  created_by      integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_code)
);
CREATE INDEX IF NOT EXISTS idx_user_perm_exclusion_user ON core.user_permission_exclusion (user_id);

-- Keep QA_HEAD focused on QA/QC review, approval, release and oversight (remove manufacturing/warehouse execution)
DELETE FROM core.role_permission
 WHERE role_id IN (SELECT id FROM core.role WHERE code = 'QA_HEAD')
   AND permission_code IN (
     'kit.bom.manage', 'kit.ebr.execute', 'kit.order.manage', 'kit.rework.manage',
     'oligo.batch.manage', 'oligo.batch.lead', 'oligo.catalog.manage', 'oligo.delivery.manage',
     'oligo.order.manage', 'oligo.post.manage', 'oligo.pricing.manage', 'oligo.reagent.manage', 'oligo.sop.manage',
     'device.assembly.execute', 'device.eco.propose', 'device.model.manage', 'device.order.manage',
     'device.service.manage', 'device.subcontract.manage',
     'rd.idea.propose', 'rd.idea.evaluate', 'rd.idea.approve', 'rd.project.manage',
     'rd.eln.write', 'rd.sample.manage', 'rd.transfer.manage', 'rd.transfer.accept', 'rd.software.release',
     'inv.document.create', 'inv.document.post', 'inv.document.reverse', 'inv.reservation.manage', 'inv.receipt.manage',
     'master.item.manage', 'master.partner.manage', 'master.warehouse.manage',
     'purchase.po.manage', 'purchase.receipt.post',
     'intake.order.accept', 'intake.order.manage', 'intake.shipment.post',
     'prep.formula.manage', 'prep.formula.delete', 'prep.execute'
   );

-- Remove unreachable cross-department manufacturing permissions previously seeded onto RD_HEAD
DELETE FROM core.role_permission
 WHERE role_id IN (SELECT id FROM core.role WHERE code = 'RD_HEAD')
   AND (permission_code LIKE 'kit.%' OR permission_code LIKE 'oligo.%');
