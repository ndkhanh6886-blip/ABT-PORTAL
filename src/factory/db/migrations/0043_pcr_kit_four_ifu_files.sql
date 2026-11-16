-- 0043_pcr_kit_four_ifu_files.sql
-- Support 4 separate PCR Kit IFU (HDSD) file attachments across supply & IC variants:
--   NO_SPLIT_NO_IC, NO_SPLIT_WITH_IC (.IC), SPLIT_NO_IC (.C), SPLIT_WITH_IC (.C.IC)

ALTER TABLE kit.bom
  ADD COLUMN IF NOT EXISTS ifu_files_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE kit.bom
   SET ifu_files_json = (
     COALESCE(ifu_files_json, '{}'::jsonb)
     || CASE
          WHEN ifu_file_name IS NOT NULL OR ifu_file_url IS NOT NULL THEN
            jsonb_build_object(
              'NO_SPLIT_NO_IC',
              jsonb_strip_nulls(
                jsonb_build_object(
                  'file_name', ifu_file_name,
                  'file_url', ifu_file_url,
                  'file_size', ifu_file_size
                )
              )
            )
          ELSE '{}'::jsonb
        END
     || CASE
          WHEN ifu_aliquoted_file_name IS NOT NULL OR ifu_aliquoted_file_url IS NOT NULL THEN
            jsonb_build_object(
              'SPLIT_WITH_IC',
              jsonb_strip_nulls(
                jsonb_build_object(
                  'file_name', ifu_aliquoted_file_name,
                  'file_url', ifu_aliquoted_file_url,
                  'file_size', ifu_aliquoted_file_size
                )
              )
            )
          ELSE '{}'::jsonb
        END
   )
 WHERE (ifu_file_name IS NOT NULL OR ifu_file_url IS NOT NULL OR ifu_aliquoted_file_name IS NOT NULL OR ifu_aliquoted_file_url IS NOT NULL)
   AND NOT (ifu_files_json ? 'NO_SPLIT_NO_IC' AND ifu_files_json ? 'SPLIT_WITH_IC');
