-- 0046_kit_decimal_retention_and_stock_modes.sql
-- Support decimal QC retention quantities (e.g. 0.5 set/lot) and per-item / per-BOM-line
-- warehouse stocking (`is_stocked`) and whole-integer rounding (`is_integer_uom` / `is_integer_qty`) flags.

ALTER TABLE kit.bom
  ALTER COLUMN qc_retention_qty TYPE numeric(18,6) USING coalesce(qc_retention_qty, 0)::numeric(18,6);

ALTER TABLE kit.production_order
  ALTER COLUMN qc_retention_qty TYPE numeric(18,6) USING coalesce(qc_retention_qty, 0)::numeric(18,6),
  ALTER COLUMN retain_qty TYPE numeric(18,6) USING coalesce(retain_qty, 0)::numeric(18,6);

ALTER TABLE master.item
  ADD COLUMN IF NOT EXISTS is_stocked boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_integer_uom boolean NOT NULL DEFAULT false;

UPDATE master.item
   SET is_integer_uom = true
 WHERE tracking = 'SERIAL'
    OR code ILIKE 'VT-TUBE-%'
    OR upper(trim(base_uom)) IN (
      'EA', 'PCS', 'CAI', 'CÁI', 'TUBE', 'ONG', 'ỐNG', 'VIAL', 'LO', 'LỌ',
      'BOTTLE', 'CHAI', 'BOX', 'HOP', 'HỘP', 'BAG', 'TUI', 'TÚI', 'GOI', 'GÓI',
      'SET', 'BO', 'BỘ', 'KIT', 'PLATE', 'DIA', 'ĐĨA', 'TEM', 'NHAN', 'NHÃN',
      'SHEET', 'TO', 'TỜ', 'STRIP', 'CAP', 'NAP', 'NẮP', 'RACK', 'COL', 'COT', 'CỘT', 'CUON', 'CUỘN'
    );

ALTER TABLE kit.bom_line
  ADD COLUMN IF NOT EXISTS is_stocked boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_integer_qty boolean NOT NULL DEFAULT false;

UPDATE kit.bom_line bl
   SET is_integer_qty = true
  FROM master.item it
 WHERE it.id = bl.component_item_id
   AND (
     it.is_integer_uom = true
     OR bl.component_role IN ('PACKAGING', 'PCR_TUBE_STRIP')
     OR upper(trim(bl.uom)) IN (
       'EA', 'PCS', 'CAI', 'CÁI', 'TUBE', 'ONG', 'ỐNG', 'VIAL', 'LO', 'LỌ',
       'BOTTLE', 'CHAI', 'BOX', 'HOP', 'HỘP', 'BAG', 'TUI', 'TÚI', 'GOI', 'GÓI',
       'SET', 'BO', 'BỘ', 'KIT', 'PLATE', 'DIA', 'ĐĨA', 'TEM', 'NHAN', 'NHÃN',
       'SHEET', 'TO', 'TỜ', 'STRIP', 'CAP', 'NAP', 'NẮP', 'RACK', 'COL', 'COT', 'CỘT', 'CUON', 'CUỘN'
     )
   );

-- Preserve legacy behavior for untouched packaging rows that inherited DEFAULT true from 0037
UPDATE kit.bom_line
   SET include_in_qc_retention = false
 WHERE updated_by IS NULL
   AND component_role IN ('PACKAGING', 'PCR_TUBE_STRIP')
   AND include_in_qc_retention = true;
