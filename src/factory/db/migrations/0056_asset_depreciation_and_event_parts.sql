-- 0056: Asset depreciation, warranty tracking, spare parts replacement on maintenance/repair events
ALTER TABLE asset.asset
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS purchase_cost_vnd numeric(18,0) CHECK (purchase_cost_vnd IS NULL OR purchase_cost_vnd >= 0),
  ADD COLUMN IF NOT EXISTS depreciation_months integer CHECK (depreciation_months IS NULL OR (depreciation_months > 0 AND depreciation_months <= 600)),
  ADD COLUMN IF NOT EXISTS warranty_expiry date,
  ADD COLUMN IF NOT EXISTS supplier_name text;

ALTER TABLE asset.event
  ADD COLUMN IF NOT EXISTS spare_parts text,
  ADD COLUMN IF NOT EXISTS parts_json jsonb NOT NULL DEFAULT '[]'::jsonb;
