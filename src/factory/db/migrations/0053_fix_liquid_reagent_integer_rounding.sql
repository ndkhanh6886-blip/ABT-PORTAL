-- 0053_fix_liquid_reagent_integer_rounding.sql
-- Ensure liquid/mass reagents and solutions (mL, µL, L, g, mg, kg, µg, nmol, pmol, OD)
-- such as LN024 (Water Molecular Biology) are not flagged with whole-integer rounding
-- (is_integer_uom / is_integer_qty), preserving exact decimal mix formulation quantities.

UPDATE master.item
   SET is_integer_uom = false
 WHERE is_integer_uom = true
   AND tracking <> 'SERIAL'
   AND code NOT ILIKE 'VT-TUBE-%'
   AND NOT (
     upper(trim(base_uom)) IN (
       'EA', 'PCS', 'CAI', 'CÁI', 'CHIẾC', 'CHIEC', 'TUBE', 'ONG', 'ỐNG', 'VIAL', 'LO', 'LỌ',
       'BOTTLE', 'CHAI', 'BOX', 'HOP', 'HỘP', 'BAG', 'TUI', 'TÚI', 'GOI', 'GÓI', 'PACK',
       'SET', 'BO', 'BỘ', 'KIT', 'PLATE', 'DIA', 'ĐĨA', 'TEM', 'NHAN', 'NHÃN', 'LABEL',
       'SHEET', 'TO', 'TỜ', 'STRIP', 'DẢI', 'DAI', 'CAP', 'NAP', 'NẮP', 'RACK', 'COL', 'COT', 'CỘT', 'CUON', 'CUỘN', 'ROLL'
     )
   );

UPDATE kit.bom_line bl
   SET is_integer_qty = false
 WHERE bl.is_integer_qty = true
   AND bl.component_role NOT IN ('PACKAGING', 'PCR_TUBE_STRIP')
   AND NOT (
     upper(trim(bl.uom)) IN (
       'EA', 'PCS', 'CAI', 'CÁI', 'CHIẾC', 'CHIEC', 'TUBE', 'ONG', 'ỐNG', 'VIAL', 'LO', 'LỌ',
       'BOTTLE', 'CHAI', 'BOX', 'HOP', 'HỘP', 'BAG', 'TUI', 'TÚI', 'GOI', 'GÓI', 'PACK',
       'SET', 'BO', 'BỘ', 'KIT', 'PLATE', 'DIA', 'ĐĨA', 'TEM', 'NHAN', 'NHÃN', 'LABEL',
       'SHEET', 'TO', 'TỜ', 'STRIP', 'DẢI', 'DAI', 'CAP', 'NAP', 'NẮP', 'RACK', 'COL', 'COT', 'CỘT', 'CUON', 'CUỘN', 'ROLL'
     )
   );
