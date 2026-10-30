-- Certificate of analysis: the header printed on every COA is a setting (company name, address, contact),
-- edited in Cấu hình by whoever holds core.setting.manage.
INSERT INTO core.setting (key, value, description) VALUES
  ('company.coa_header', 'null', 'Tên công ty, địa chỉ, điện thoại / email in ở đầu phiếu kết quả phân tích (COA). Mỗi dòng một ý.'),
  ('company.coa_footer', 'null', 'Ghi chú cuối phiếu COA (bảo quản, điều kiện sử dụng …).')
ON CONFLICT (key) DO NOTHING;
