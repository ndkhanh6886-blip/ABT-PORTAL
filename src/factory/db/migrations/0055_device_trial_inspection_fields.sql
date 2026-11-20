-- Add Trial Inspection (Kiểm tra thử nghiệm, ký phiếu thử nghiệm & up NAS) fields to device.burn_in_run
ALTER TABLE device.burn_in_run
  ADD COLUMN IF NOT EXISTS nas_path text,
  ADD COLUMN IF NOT EXISTS checklist_json jsonb,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_data text;
