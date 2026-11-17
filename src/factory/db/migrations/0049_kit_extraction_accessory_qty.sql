-- 0049_kit_extraction_accessory_qty.sql
-- Định mức vật tư cấp kèm cho mỗi mã phụ kit tách chiết máy (số lượng / 1 kit). Không có dòng = dùng mặc định 1 / kit.

CREATE TABLE IF NOT EXISTS kit.extraction_accessory_qty (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  accessory_set text NOT NULL,
  item_code     text NOT NULL,
  qty_per_kit   numeric(18,6) NOT NULL CHECK (qty_per_kit > 0),
  updated_by    integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (accessory_set, item_code)
);
