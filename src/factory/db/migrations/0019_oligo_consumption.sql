-- Consumption reports and rule calibration from bottles taken off a synthesizer port.
INSERT INTO core.setting (key, value, description) VALUES
  ('oligo.consumption_variance_pct', '10', 'Chênh lệch tiêu hao thực tế so với định mức (%) vượt mức này thì báo cáo đánh dấu cần xem lại định mức.')
ON CONFLICT (key) DO NOTHING;

-- When a bottle is taken off a port: what it really gave (volume at install − volume left) against what the
-- batches booked from it while installed; the ratio proposes a corrected rule.
CREATE TABLE oligo.bottle_calibration (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  synthesizer_id  uuid NOT NULL REFERENCES oligo.synthesizer (asset_id),
  port_no         integer NOT NULL,
  role            text NOT NULL,
  lot_id          uuid NOT NULL REFERENCES inv.lot (id),
  installed_at    timestamptz,
  removed_at      timestamptz NOT NULL DEFAULT now(),
  volume_start    numeric(18,6) NOT NULL CHECK (volume_start > 0),
  volume_left     numeric(18,6) NOT NULL CHECK (volume_left >= 0),
  actual_qty      numeric(18,6) NOT NULL,                    -- volume_start − volume_left (base unit)
  booked_qty      numeric(18,6) NOT NULL,                    -- issued to batches from this lot while installed
  ratio           numeric(10,4),                             -- actual / booked
  rule_qty_before numeric(12,4),
  suggested_qty   numeric(12,4),
  applied         boolean NOT NULL DEFAULT false,
  applied_at      timestamptz,
  applied_by      integer,
  adjustment_document_id uuid REFERENCES inv.stock_document (id),
  notes           text,
  created_by      integer NOT NULL,
  CHECK (volume_left <= volume_start)
);
CREATE INDEX ON oligo.bottle_calibration (role, removed_at);
