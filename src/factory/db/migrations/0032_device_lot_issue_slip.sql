-- 0032_device_lot_issue_slip.sql
-- Đề xuất P.KTCN (11/2026), đợt 1:
-- 1. Số Lô thiết bị trên lệnh lắp ráp (gợi ý Model-YYMMDD-Cỡ lô, sửa được, không trùng); Serial sinh từ Lô.
-- 2. Mã biểu mẫu in của P.KTCN cấu hình được (BM 21-01 và phiếu thử nghiệm).
-- 3. QC phụ trách được chỉ định khi chuyển thiết bị sang kiểm tra cuối (FQC).

ALTER TABLE device.device_order ADD COLUMN IF NOT EXISTS lot_no text;
CREATE UNIQUE INDEX IF NOT EXISTS device_order_lot_no_uq ON device.device_order (lower(lot_no)) WHERE lot_no IS NOT NULL;

-- Serial numbers are unique whatever their case (they are typed by hand, printed on labels).
CREATE UNIQUE INDEX IF NOT EXISTS device_unit_serial_no_ci_uq ON device.device_unit (lower(serial_no));

ALTER TABLE device.device_unit ADD COLUMN IF NOT EXISTS fqc_assignee_id integer;

INSERT INTO core.setting (key, value, description) VALUES
  ('device.form_codes',
   '{"issue_slip": {"code": "BM 21-01", "name": "Phiếu sản xuất và xuất kho nguyên vật liệu"}, "test_record": {"code": "", "name": "Phiếu thử nghiệm thiết bị"}}',
   'Mã và tên biểu mẫu in của Phòng Kỹ thuật – Công nghệ (theo QT 21). Sửa khi biểu mẫu kiểm soát đổi phiên bản.')
ON CONFLICT (key) DO NOTHING;
