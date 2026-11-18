-- 0050_coa_templates_and_custom_fields.sql
-- Supports multiple COA templates (Standard, OEM HN/TBR/Celltek/Medi/Metalab, Self-prepared, Positive Control, Raw Material)
-- and stores per-COA template_key + manual/custom fields (contract_no, volume, concentration, sequence, ct_standard, supplier_lot_no, etc.).

ALTER TABLE kit.coa_certificate
  ADD COLUMN IF NOT EXISTS template_key  text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
