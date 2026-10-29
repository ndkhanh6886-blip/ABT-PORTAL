-- Oligo deliveries and tube labels. Oligo is made to order and not stocked: a delivery to Kinh doanh is an
-- intake shipment without a stock issue, listing the sequences handed over; each sequence is delivered once.

ALTER TABLE intake.shipment
  ADD COLUMN kind text NOT NULL DEFAULT 'STOCK' CHECK (kind IN ('STOCK', 'OLIGO')),
  ALTER COLUMN warehouse_id DROP NOT NULL,
  ADD CHECK (kind = 'OLIGO' OR warehouse_id IS NOT NULL);
ALTER TABLE intake.shipment_line
  ALTER COLUMN item_id DROP NOT NULL,
  ALTER COLUMN from_location_id DROP NOT NULL;

CREATE TABLE oligo.delivery (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  code        text NOT NULL UNIQUE,
  order_id    uuid NOT NULL REFERENCES oligo.oligo_order (id),
  shipment_id uuid REFERENCES intake.shipment (id),         -- the delivery to Kinh doanh (orders from a KD PO)
  recipient   text,                                        -- internal hand-over (R&D …) when there is no KD PO
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  integer,
  CHECK (shipment_id IS NOT NULL OR recipient IS NOT NULL)
);
CREATE INDEX ON oligo.delivery (order_id);

CREATE TABLE oligo.delivery_item (
  delivery_id uuid NOT NULL REFERENCES oligo.delivery (id),
  sequence_id uuid NOT NULL UNIQUE REFERENCES oligo.oligo_sequence (id),
  tube_count  integer NOT NULL CHECK (tube_count > 0),
  PRIMARY KEY (delivery_id, sequence_id)
);

-- every label print is recorded (who, when, which tubes, how many copies)
CREATE TABLE oligo.label_print (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  sequence_id uuid NOT NULL REFERENCES oligo.oligo_sequence (id),
  labels      integer NOT NULL CHECK (labels > 0),
  reprint     boolean NOT NULL DEFAULT false,
  reason      text,
  printed_at  timestamptz NOT NULL DEFAULT now(),
  printed_by  integer,
  CHECK (NOT reprint OR reason IS NOT NULL)
);
CREATE INDEX ON oligo.label_print (sequence_id);
