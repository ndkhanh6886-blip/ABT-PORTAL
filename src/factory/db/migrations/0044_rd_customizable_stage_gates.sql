-- 0044_rd_customizable_stage_gates.sql
-- Support customizable Stage-Gate templates (rd.gate_template / rd.gate_template_item)
-- and direct per-project Stage-Gate / DHF deliverable criteria customization.

ALTER TABLE rd.gate_template
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by integer;

ALTER TABLE rd.gate_deliverable
  ALTER COLUMN template_item_id DROP NOT NULL;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'rd'
       AND rel.relname = 'gate_deliverable'
       AND con.contype = 'f'
       AND EXISTS (
         SELECT 1
           FROM unnest(con.conkey) k(attnum)
           JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
          WHERE att.attname = 'template_item_id'
       )
  LOOP
    EXECUTE format('ALTER TABLE rd.gate_deliverable DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE rd.gate_deliverable
    ADD CONSTRAINT gate_deliverable_template_item_fk
    FOREIGN KEY (template_item_id) REFERENCES rd.gate_template_item (id) ON DELETE SET NULL;

  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'rd'
       AND rel.relname = 'gate_template_item'
       AND con.contype = 'f'
       AND EXISTS (
         SELECT 1
           FROM unnest(con.conkey) k(attnum)
           JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
          WHERE att.attname = 'template_id'
       )
  LOOP
    EXECUTE format('ALTER TABLE rd.gate_template_item DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE rd.gate_template_item
    ADD CONSTRAINT gate_template_item_template_fk
    FOREIGN KEY (template_id) REFERENCES rd.gate_template (id) ON DELETE CASCADE;
END $$;
