-- Internal orders from Kinh doanh (docs/nha-may/00 §4, D1/D4/D13): the factory's customer is the
-- Kinh doanh block; its PO to an internal supplier becomes an internal order here, shipments go back
-- as events. The two databases never share a transaction, so every message is deduplicated by id.

CREATE SCHEMA IF NOT EXISTS intake;

-- Messages received from ABT Portal (Kinh doanh), processed at most once.
CREATE TABLE core.inbox_event (
  event_id    uuid PRIMARY KEY,
  source      text NOT NULL,
  event_type  text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- How a Kinh doanh product maps to the factory item: kd_item_code exists since 0002; one KD unit
-- (e.g. "Hộp") equals kd_unit_factor base units of the factory item.
ALTER TABLE master.item
  ADD COLUMN kd_unit text,
  ADD COLUMN kd_unit_factor numeric(18,6) NOT NULL DEFAULT 1 CHECK (kd_unit_factor > 0);

CREATE TABLE intake.internal_order (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  code                  text NOT NULL UNIQUE,
  kd_po_id              integer NOT NULL,
  kd_po_code            text NOT NULL UNIQUE,
  org_unit_id           uuid NOT NULL REFERENCES core.org_unit (id),        -- producing department
  ship_mode             text NOT NULL CHECK (ship_mode IN ('TO_KD', 'DROP_SHIP')),
  ship_to               jsonb,                                              -- end customer snapshot (drop ship)
  kd_so_code            text,
  requested_date        date,
  committed_date        date,
  initial_committed_date date,
  due_date_change_count integer NOT NULL DEFAULT 0,
  notes                 text,
  status                text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN
                        ('RECEIVED', 'ACCEPTED', 'IN_PRODUCTION', 'READY', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED', 'REJECTED', 'CANCELLED')),
  version               integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            integer,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            integer,
  CHECK (ship_mode = 'TO_KD' OR ship_to IS NOT NULL)
);
CREATE INDEX ON intake.internal_order (org_unit_id, status);

CREATE TABLE intake.internal_order_line (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id       uuid NOT NULL REFERENCES intake.internal_order (id),
  line_no        integer NOT NULL,
  kd_line_index  integer NOT NULL,
  kd_item_code   text NOT NULL,
  kd_item_name   text,
  kd_unit        text,
  item_id        uuid REFERENCES master.item (id),                 -- resolved through master.item.kd_item_code
  qty            numeric(18,6) NOT NULL CHECK (qty > 0),         -- in the Kinh doanh unit
  transfer_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (transfer_price >= 0),
  qty_delivered  numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_delivered >= 0),
  UNIQUE (order_id, line_no),
  UNIQUE (order_id, kd_line_index),
  CHECK (qty_delivered <= qty)
);

CREATE TABLE intake.shipment (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  order_id            uuid NOT NULL REFERENCES intake.internal_order (id),
  warehouse_id        uuid NOT NULL REFERENCES master.warehouse (id),
  ship_mode           text NOT NULL CHECK (ship_mode IN ('TO_KD', 'DROP_SHIP')),
  stock_document_id   uuid REFERENCES inv.stock_document (id),
  proof_attachment_id uuid REFERENCES core.attachment (id),
  delivered_at        timestamptz,
  kd_acknowledged_at  timestamptz,
  kd_inbound_code     text,
  notes               text,
  status              text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'DELIVERED', 'ACKNOWLEDGED')),
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer
);
CREATE INDEX ON intake.shipment (order_id);

CREATE TABLE intake.shipment_line (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  shipment_id      uuid NOT NULL REFERENCES intake.shipment (id),
  order_line_id    uuid NOT NULL REFERENCES intake.internal_order_line (id),
  item_id          uuid NOT NULL REFERENCES master.item (id),
  lot_id           uuid REFERENCES inv.lot (id),
  from_location_id uuid NOT NULL REFERENCES master.location (id),
  qty              numeric(18,6) NOT NULL CHECK (qty > 0)          -- Kinh doanh unit
);
CREATE INDEX ON intake.shipment_line (lot_id);
