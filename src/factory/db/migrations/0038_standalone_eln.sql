-- 0038_standalone_eln.sql
-- Allow standalone R&D ELN experiments that are not linked to a specific rd.project.

ALTER TABLE rd.experiment
  ADD COLUMN IF NOT EXISTS org_unit_id uuid REFERENCES core.org_unit (id);

UPDATE rd.experiment e
   SET org_unit_id = p.owner_org_unit_id
  FROM rd.project p
 WHERE p.id = e.project_id
   AND e.org_unit_id IS NULL;

ALTER TABLE rd.experiment
  ALTER COLUMN project_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'experiment_owner_chk'
       AND conrelid = 'rd.experiment'::regclass
  ) THEN
    ALTER TABLE rd.experiment
      ADD CONSTRAINT experiment_owner_chk
      CHECK (project_id IS NOT NULL OR org_unit_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rd_experiment_org_status
  ON rd.experiment (org_unit_id, status);
