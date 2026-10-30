-- Reagent preparation (as OligoFlow's "Pha chế hóa chất"): a formula turns ingredients into a prepared reagent;
-- a preparation consumes the ingredient lots and creates a lot of the prepared item (P{YY}{MM}{NNN}), released at
-- once or kept in quarantine for QC. Shared by every department (Oligo, Kit …).

CREATE SCHEMA IF NOT EXISTS prep;

CREATE TABLE prep.formula (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  category         text,                                  -- Tổng hợp, Tinh sạch, Khử bảo vệ, Pha loãng amidite …
  output_item_id   uuid NOT NULL REFERENCES master.item (id),
  basis_qty        numeric(18,6) NOT NULL CHECK (basis_qty > 0),   -- the lines make this much of the output
  basis_uom        text NOT NULL REFERENCES master.uom (code),
  shelf_life_days  integer CHECK (shelf_life_days > 0),
  requires_qc      boolean NOT NULL DEFAULT false,
  instructions     text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       integer,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       integer
);

CREATE TABLE prep.formula_line (
  formula_id uuid NOT NULL REFERENCES prep.formula (id),
  line_no    integer NOT NULL CHECK (line_no > 0),
  item_id    uuid NOT NULL REFERENCES master.item (id),
  qty        numeric(18,6) NOT NULL CHECK (qty > 0),       -- per basis_qty of output
  uom        text NOT NULL REFERENCES master.uom (code),
  PRIMARY KEY (formula_id, line_no)
);

CREATE TABLE prep.preparation (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  code               text NOT NULL UNIQUE,
  formula_id         uuid NOT NULL REFERENCES prep.formula (id),
  formula_version    integer NOT NULL,
  lines              jsonb NOT NULL,                     -- ingredients as used: item, lot, qty (base unit)
  qty_out            numeric(18,6) NOT NULL CHECK (qty_out > 0),
  uom_out            text NOT NULL,
  warehouse_id       uuid NOT NULL REFERENCES master.warehouse (id),
  lot_id             uuid NOT NULL REFERENCES inv.lot (id),
  issue_document_id  uuid REFERENCES inv.stock_document (id),
  receipt_document_id uuid REFERENCES inv.stock_document (id),
  status             text NOT NULL DEFAULT 'DONE' CHECK (status IN ('DONE', 'CANCELLED')),
  notes              text,
  cancel_reason      text,
  prepared_at        timestamptz NOT NULL DEFAULT now(),
  prepared_by        integer NOT NULL,
  version            integer NOT NULL DEFAULT 0,
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
CREATE INDEX ON prep.preparation (formula_id, prepared_at);

INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('PREPARATION', 'Lệnh pha chế', 'PC{YY}{MM}-{NNNN}')
ON CONFLICT DO NOTHING;
