-- Material purchasing (Cung ứng NVL): department requests → purchase orders → partial receipts into quarantine.
-- Separate from the Kinh doanh purchasing in ABT Portal (Q1/Q4).

CREATE SCHEMA IF NOT EXISTS purchase;

CREATE TABLE purchase.purchase_request (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  org_unit_id         uuid NOT NULL REFERENCES core.org_unit (id),      -- requesting department
  requester_id        integer NOT NULL,
  target_warehouse_id uuid NOT NULL REFERENCES master.warehouse (id),
  needed_by           date,
  reason              text NOT NULL,
  purpose_entity_type text,
  purpose_entity_id   uuid,
  est_total           numeric(18,2) NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'VND',
  requires_bod        boolean NOT NULL DEFAULT false,
  approved_by         integer,
  status              text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'SUBMITTED', 'PENDING_BOD', 'APPROVED', 'REJECTED', 'ORDERED', 'CLOSED', 'CANCELLED')),
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer
);
CREATE INDEX ON purchase.purchase_request (org_unit_id, status);

CREATE TABLE purchase.purchase_request_line (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  pr_id       uuid NOT NULL REFERENCES purchase.purchase_request (id),
  line_no     integer NOT NULL,
  item_id     uuid NOT NULL REFERENCES master.item (id),
  qty         numeric(18,6) NOT NULL CHECK (qty > 0),
  uom         text NOT NULL REFERENCES master.uom (code),
  est_price   numeric(18,2) CHECK (est_price >= 0),
  qty_ordered numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_ordered >= 0),
  notes       text,
  UNIQUE (pr_id, line_no),
  CHECK (qty_ordered <= qty)
);
CREATE INDEX ON purchase.purchase_request_line (item_id);

CREATE TABLE purchase.purchase_order (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  code          text NOT NULL UNIQUE,
  supplier_id   uuid NOT NULL REFERENCES master.partner (id),
  order_date    date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  expected_date date,
  currency      text NOT NULL DEFAULT 'VND',
  payment_terms text,
  notes         text,
  total_amount  numeric(18,2) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED')),
  issued_at     timestamptz,
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer
);
CREATE INDEX ON purchase.purchase_order (supplier_id, status);

CREATE TABLE purchase.purchase_order_line (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  po_id               uuid NOT NULL REFERENCES purchase.purchase_order (id),
  line_no             integer NOT NULL,
  pr_line_id          uuid NOT NULL REFERENCES purchase.purchase_request_line (id),
  item_id             uuid NOT NULL REFERENCES master.item (id),
  target_warehouse_id uuid NOT NULL REFERENCES master.warehouse (id),
  qty_ordered         numeric(18,6) NOT NULL CHECK (qty_ordered > 0),
  uom                 text NOT NULL REFERENCES master.uom (code),
  qty_received        numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_price          numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  vat_rate            numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate IN (0, 5, 8, 10)),
  UNIQUE (po_id, line_no)
);
CREATE INDEX ON purchase.purchase_order_line (pr_line_id);

CREATE TABLE purchase.goods_receipt (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  code              text NOT NULL UNIQUE,
  po_id             uuid NOT NULL REFERENCES purchase.purchase_order (id),
  received_at       timestamptz NOT NULL DEFAULT now(),
  received_by       integer NOT NULL,
  delivery_note_no  text,                                  -- supplier's delivery note
  notes             text,
  status            text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED')),
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        integer
);
CREATE INDEX ON purchase.goods_receipt (po_id);

CREATE TABLE purchase.goods_receipt_line (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  receipt_id         uuid NOT NULL REFERENCES purchase.goods_receipt (id),
  po_line_id         uuid NOT NULL REFERENCES purchase.purchase_order_line (id),
  item_id            uuid NOT NULL REFERENCES master.item (id),
  qty                numeric(18,6) NOT NULL CHECK (qty > 0),
  uom                text NOT NULL REFERENCES master.uom (code),
  mfr_lot_no         text,
  mfg_date           date,
  expiry_date        date,
  lot_id             uuid REFERENCES inv.lot (id),
  location_id        uuid NOT NULL REFERENCES master.location (id),
  stock_document_id  uuid REFERENCES inv.stock_document (id)
);
CREATE INDEX ON purchase.goods_receipt_line (lot_id);
