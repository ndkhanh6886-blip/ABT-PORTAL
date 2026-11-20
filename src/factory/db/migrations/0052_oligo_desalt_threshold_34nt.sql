-- Ngưỡng tinh sạch mặc định theo chiều dài của bảng giá Oligo: Desalt áp cho ≤ 34 nt (PRI-01 / PRI-02);
-- trình tự 35-60 nt (PRI-03) mặc định Cartridge (OPC). Mặc định cũ sao chép từ OligoFlow là ≤ 35 nt.
--
-- Chỉ đổi khi danh sách ngưỡng đã lưu còn y nguyên bản gốc (35 Desalt / 60 OPC / 120 HPLC).
-- Nếu đã được chỉnh tay thì giữ nguyên và chỉ ghi NOTICE. Chạy lại không đổi gì (idempotent):
-- sau lần đổi đầu tiên danh sách không còn khớp bản gốc.
DO $$
DECLARE
  original jsonb := '[{"max_len": 35, "method": "Desalt"}, {"max_len": 60, "method": "OPC"}, {"max_len": 120, "method": "HPLC"}]'::jsonb;
  updated  jsonb := '[{"max_len": 34, "method": "Desalt"}, {"max_len": 60, "method": "OPC"}, {"max_len": 120, "method": "HPLC"}]'::jsonb;
  saved_rules  jsonb;
BEGIN
  SELECT config -> 'purification_default_by_length' INTO saved_rules FROM oligo.price_config WHERE id = 1;
  IF NOT FOUND THEN
    RAISE NOTICE '[oligo price_config] chưa có cấu hình đã lưu — bỏ qua (mặc định trong code đã là ≤ 34 nt).';
  ELSIF saved_rules = original THEN
    UPDATE oligo.price_config
       SET config = jsonb_set(config, '{purification_default_by_length}', updated),
           version = version + 1,
           updated_at = now()
     WHERE id = 1;
    RAISE NOTICE '[oligo price_config] đã đổi ngưỡng Desalt 35 → 34 nt.';
  ELSIF saved_rules = updated THEN
    RAISE NOTICE '[oligo price_config] ngưỡng Desalt đã là 34 nt — không đổi.';
  ELSE
    RAISE NOTICE '[oligo price_config] ngưỡng tinh sạch theo chiều dài đã được chỉnh tay (%), giữ nguyên.', saved_rules;
  END IF;
END
$$;
