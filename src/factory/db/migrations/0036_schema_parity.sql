-- 0036_schema_parity.sql
-- Captures remaining runtime DDL columns from incidents.ts and device/models.ts.

ALTER TABLE inv.lot
  ADD COLUMN IF NOT EXISTS hold_reason text;

ALTER TABLE device.model_bom_line
  ADD COLUMN IF NOT EXISTS unit_cost        numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS display_uom      text,
  ADD COLUMN IF NOT EXISTS part_category    text,
  ADD COLUMN IF NOT EXISTS station_label    text,
  ADD COLUMN IF NOT EXISTS preferred_vendor text;

ALTER TABLE qms.reference_standard
  ALTER COLUMN source_strain TYPE text;
