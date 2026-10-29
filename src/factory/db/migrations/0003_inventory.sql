-- Inventory: lots, containers, stock documents, append-only ledger, balances, reservations.
-- Stock = sum of the ledger; stock_balance is kept in the same transaction and reconciled nightly.

CREATE SCHEMA IF NOT EXISTS inv;

-- `status` is the lot quality status (docs/nha-may/02 §1.1).
CREATE TABLE inv.lot (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  code               text NOT NULL,
  item_id            uuid NOT NULL REFERENCES master.item (id),
  mfr_lot_no         text,
  supplier_id        uuid REFERENCES master.partner (id),
  mfg_date           date,
  expiry_date        date,
  received_date      date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  status             text NOT NULL DEFAULT 'QUARANTINE'
                     CHECK (status IN ('QUARANTINE', 'PENDING_QC', 'RELEASED', 'ON_HOLD', 'REJECTED', 'EXPIRED')),
  origin             text NOT NULL CHECK (origin IN ('PURCHASE', 'PRODUCTION', 'PREPARATION', 'SYNTHESIS', 'RETURN', 'OPENING')),
  origin_entity_type text,
  origin_entity_id   uuid,
  coa_attachment_id  uuid,
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         integer,
  UNIQUE (item_id, code),
  CHECK (expiry_date IS NULL OR mfg_date IS NULL OR expiry_date >= mfg_date)
);
CREATE INDEX ON inv.lot (item_id, expiry_date);
CREATE INDEX ON inv.lot (status);

-- Bottles / tubes of a lot, tracked one by one (opened date, in-use expiry).
CREATE TABLE inv.container (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  code             text NOT NULL UNIQUE,
  lot_id           uuid NOT NULL REFERENCES inv.lot (id),
  initial_qty_base numeric(18,6) NOT NULL CHECK (initial_qty_base > 0),
  opened_at        timestamptz,
  open_expiry_date date,
  status           text NOT NULL DEFAULT 'AVAILABLE'
                   CHECK (status IN ('INCUBATING', 'PENDING_QC', 'AVAILABLE', 'IN_USE', 'EMPTY', 'REJECTED', 'DISCARDED')),
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       integer,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       integer
);
CREATE INDEX ON inv.container (lot_id);

CREATE TABLE inv.stock_document (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  code               text NOT NULL UNIQUE,
  doc_type           text NOT NULL CHECK (doc_type IN ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'COUNT_ADJUST', 'RETURN')),
  reason_code        text NOT NULL,
  warehouse_id       uuid NOT NULL REFERENCES master.warehouse (id),
  source_entity_type text,
  source_entity_id   uuid,
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED')),
  posted_at          timestamptz,
  posted_by          integer,
  reversal_of_id     uuid REFERENCES inv.stock_document (id),
  notes              text,
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         integer
);
CREATE INDEX ON inv.stock_document (warehouse_id, status);
CREATE INDEX ON inv.stock_document (source_entity_type, source_entity_id);
CREATE UNIQUE INDEX stock_document_one_reversal ON inv.stock_document (reversal_of_id) WHERE reversal_of_id IS NOT NULL;

CREATE TABLE inv.stock_document_line (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  document_id      uuid NOT NULL REFERENCES inv.stock_document (id),
  line_no          integer NOT NULL,
  item_id          uuid NOT NULL REFERENCES master.item (id),
  lot_id           uuid REFERENCES inv.lot (id),
  container_id     uuid REFERENCES inv.container (id),
  from_location_id uuid REFERENCES master.location (id),
  to_location_id   uuid REFERENCES master.location (id),
  qty              numeric(18,6) NOT NULL CHECK (qty > 0),
  uom              text NOT NULL REFERENCES master.uom (code),
  qty_base         numeric(18,6) NOT NULL CHECK (qty_base > 0),
  unit_cost        numeric(18,2) CHECK (unit_cost >= 0),
  reservation_id   uuid,
  UNIQUE (document_id, line_no),
  CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
  CHECK (from_location_id IS DISTINCT FROM to_location_id)
);
CREATE INDEX ON inv.stock_document_line (lot_id);

CREATE TABLE inv.stock_ledger (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posted_at        timestamptz NOT NULL DEFAULT now(),
  document_line_id uuid NOT NULL REFERENCES inv.stock_document_line (id),
  item_id          uuid NOT NULL REFERENCES master.item (id),
  lot_id           uuid REFERENCES inv.lot (id),
  container_id     uuid REFERENCES inv.container (id),
  location_id      uuid NOT NULL REFERENCES master.location (id),
  qty_delta_base   numeric(18,6) NOT NULL CHECK (qty_delta_base <> 0)
);
CREATE INDEX ON inv.stock_ledger (item_id, lot_id, location_id);
CREATE INDEX ON inv.stock_ledger (posted_at);
CREATE TRIGGER stock_ledger_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON inv.stock_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_change();

CREATE TABLE inv.stock_balance (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  item_id      uuid NOT NULL REFERENCES master.item (id),
  lot_id       uuid REFERENCES inv.lot (id),
  container_id uuid REFERENCES inv.container (id),
  location_id  uuid NOT NULL REFERENCES master.location (id),
  qty_on_hand  numeric(18,6) NOT NULL DEFAULT 0,
  qty_reserved numeric(18,6) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_on_hand >= 0 AND qty_reserved >= 0 AND qty_reserved <= qty_on_hand)
);
CREATE UNIQUE INDEX stock_balance_key ON inv.stock_balance (item_id, lot_id, container_id, location_id) NULLS NOT DISTINCT;
CREATE INDEX ON inv.stock_balance (lot_id);

CREATE TABLE inv.reservation (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  balance_id         uuid NOT NULL REFERENCES inv.stock_balance (id),
  item_id            uuid NOT NULL REFERENCES master.item (id),
  lot_id             uuid REFERENCES inv.lot (id),
  location_id        uuid NOT NULL REFERENCES master.location (id),
  qty_base           numeric(18,6) NOT NULL CHECK (qty_base > 0),
  qty_consumed       numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_consumed >= 0),
  demand_entity_type text NOT NULL CHECK (demand_entity_type IN
                     ('PRODUCTION_ORDER', 'SYNTHESIS_BATCH', 'EXPERIMENT', 'DEVICE_WO', 'DELIVERY', 'PREPARATION', 'OTHER')),
  demand_entity_id   uuid NOT NULL,
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         integer,
  CHECK (qty_consumed <= qty_base)
);
CREATE INDEX ON inv.reservation (demand_entity_type, demand_entity_id);
CREATE INDEX reservation_active_lot ON inv.reservation (lot_id) WHERE status = 'ACTIVE';
ALTER TABLE inv.stock_document_line ADD FOREIGN KEY (reservation_id) REFERENCES inv.reservation (id);
