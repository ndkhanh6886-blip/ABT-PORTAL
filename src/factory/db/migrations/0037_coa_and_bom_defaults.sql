-- 0037_coa_and_bom_defaults.sql
-- Ensures parity on fresh DB rebuilds (non-production-order CoA, BOM line defaults, qc_spec_item backfill).

ALTER TABLE kit.coa_certificate
  ALTER COLUMN production_order_id DROP NOT NULL;

ALTER TABLE kit.bom_line
  ALTER COLUMN is_mix_component SET DEFAULT true,
  ALTER COLUMN include_in_qc_retention SET DEFAULT true;

INSERT INTO qms.qc_spec_item (spec_id, item_id)
SELECT id, item_id FROM qms.qc_spec WHERE item_id IS NOT NULL
ON CONFLICT (spec_id, item_id) DO NOTHING;
