-- 0048_kit_extraction_accessory_set.sql
-- Mã phụ của Kit tách chiết máy (HI-..., HM-...): lệnh sản xuất ghi nhận mã phụ đã chọn trên SO và giữ chỗ / xuất kho
-- các mã vật tư cấp kèm tương ứng (đĩa, tube strip, tipcomb...) vào bảng riêng (không đụng định mức BOM chung).

ALTER TABLE kit.production_order
  ADD COLUMN IF NOT EXISTS accessory_set text;

ALTER TABLE intake.internal_order_line
  ADD COLUMN IF NOT EXISTS accessory_set text;

CREATE TABLE IF NOT EXISTS kit.order_accessory_consumption (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id          uuid NOT NULL REFERENCES kit.production_order (id) ON DELETE CASCADE,
  accessory_set     text NOT NULL,
  item_id           uuid NOT NULL REFERENCES master.item (id),
  lot_id            uuid REFERENCES inv.lot (id),
  location_id       uuid REFERENCES master.location (id),
  reservation_id    uuid REFERENCES inv.reservation (id),
  planned_qty       numeric(18,6) NOT NULL CHECK (planned_qty > 0),
  issued_qty        numeric(18,6) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  uom               text NOT NULL,
  stock_document_id uuid REFERENCES inv.stock_document (id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kit_order_accessory_order ON kit.order_accessory_consumption (order_id);
