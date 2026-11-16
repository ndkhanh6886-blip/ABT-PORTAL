-- 0039_prep_dept_scope.sql
-- Isolate reagent preparation formulas (`prep.formula`) per department (`OLIGO`, `RD`, `KIT`)
-- so R&D and Oligo maintain independent formula catalogues, orders, logs, and codes.

ALTER TABLE prep.formula
  ADD COLUMN IF NOT EXISTS dept_scope text NOT NULL DEFAULT 'OLIGO'
  CHECK (dept_scope IN ('OLIGO', 'RD', 'KIT'));

-- Backfill non-Oligo formulas created by R&D / Kit staff into their own scope
UPDATE prep.formula f
   SET dept_scope = ou.module_key
  FROM core.user_profile up
  JOIN core.org_unit ou ON ou.id = up.org_unit_id
 WHERE up.user_id = f.created_by
   AND ou.module_key IN ('RD', 'KIT')
   AND upper(f.code) NOT IN ('DEBLOCK', 'CAP_A', 'AMIDITE_DIL', 'AMA');

-- Replace global UNIQUE(code) with per-department uniqueness on (dept_scope, upper(code))
DO $$
DECLARE c_name text;
BEGIN
  FOR c_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'prep.formula'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (code)'
  LOOP
    EXECUTE format('ALTER TABLE prep.formula DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS prep_formula_dept_code_uq
  ON prep.formula (dept_scope, upper(code));

CREATE INDEX IF NOT EXISTS idx_prep_formula_dept_status
  ON prep.formula (dept_scope, status);
