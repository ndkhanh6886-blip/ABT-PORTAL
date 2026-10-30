-- Reagent / solvent positions of lab equipment (HPLC buffers A/B, wash solvent …), as in OligoFlow: each position
-- takes one item, the bottle (lot) on it is what runs, purges and maintenance consume from stock.

CREATE TABLE asset.reagent_slot (
  asset_id       uuid NOT NULL REFERENCES asset.asset (id),
  slot_no        integer NOT NULL CHECK (slot_no BETWEEN 1 AND 50),
  label          text NOT NULL,
  item_id        uuid NOT NULL REFERENCES master.item (id),
  current_lot_id uuid REFERENCES inv.lot (id),
  installed_at   timestamptz,
  installed_by   integer,
  version        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (asset_id, slot_no)
);

CREATE TABLE asset.slot_event (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  asset_id          uuid NOT NULL REFERENCES asset.asset (id),
  slot_no           integer NOT NULL,
  event             text NOT NULL CHECK (event IN ('INSTALL', 'REMOVE', 'USAGE')),
  lot_id            uuid REFERENCES inv.lot (id),
  usage_kind        text CHECK (usage_kind IN ('RUN', 'PURGE', 'MAINTENANCE', 'LOSS')),
  qty_base          numeric(18,6) CHECK (qty_base > 0),
  stock_document_id uuid REFERENCES inv.stock_document (id),
  source_ref        text,                                  -- e.g. the sequence / post-processing step of a run
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        integer,
  CHECK ((event = 'USAGE') = (usage_kind IS NOT NULL AND qty_base IS NOT NULL))
);
CREATE INDEX ON asset.slot_event (asset_id, slot_no, created_at);
CREATE INDEX ON asset.slot_event (lot_id);
