-- Reagent ports of a synthesizer (as OligoFlow): each port feeds one reagent role; the bottle (lot) on it is
-- what a batch reserves and consumes. A bottle changed during a run splits the consumption at the swap cycle.

CREATE TABLE oligo.synth_port (
  synthesizer_id      uuid NOT NULL REFERENCES oligo.synthesizer (asset_id),
  port_no             integer NOT NULL CHECK (port_no BETWEEN 1 AND 200),
  role                text NOT NULL,                              -- reagent rule role, or MOD:<modification code>
  label               text,
  current_lot_id      uuid REFERENCES inv.lot (id),
  installed_at        timestamptz,
  installed_by        integer,
  version             integer NOT NULL DEFAULT 0,
  PRIMARY KEY (synthesizer_id, port_no),
  UNIQUE (synthesizer_id, role)
);

-- history of bottles on the ports (install, removal, change during a run at a given cycle)
CREATE TABLE oligo.bottle_event (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  synthesizer_id uuid NOT NULL REFERENCES oligo.synthesizer (asset_id),
  port_no        integer NOT NULL,
  role           text NOT NULL,
  event          text NOT NULL CHECK (event IN ('INSTALL', 'REMOVE', 'SWAP')),
  lot_id         uuid REFERENCES inv.lot (id),
  old_lot_id     uuid REFERENCES inv.lot (id),
  batch_id       uuid REFERENCES oligo.synthesis_batch (id),
  swap_cycle     integer CHECK (swap_cycle > 0),
  qty_moved_base numeric(18,6),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     integer,
  CHECK (event <> 'SWAP' OR (batch_id IS NOT NULL AND swap_cycle IS NOT NULL AND lot_id IS NOT NULL AND old_lot_id IS NOT NULL))
);
CREATE INDEX ON oligo.bottle_event (synthesizer_id, created_at);

-- which port bottle each batch holds, per role (a port role is taken from its bottle, not FEFO)
CREATE TABLE oligo.batch_port_use (
  batch_id uuid NOT NULL REFERENCES oligo.synthesis_batch (id),
  port_no  integer NOT NULL,
  role     text NOT NULL,
  item_id  uuid NOT NULL REFERENCES master.item (id),
  lot_id   uuid NOT NULL REFERENCES inv.lot (id),
  qty_base numeric(18,6) NOT NULL CHECK (qty_base >= 0),
  PRIMARY KEY (batch_id, role)
);

-- reagent rules: a display name shown on screens and a flag to hide a role from the operator view
ALTER TABLE oligo.reagent_rule ADD COLUMN display_name text, ADD COLUMN is_visible boolean NOT NULL DEFAULT true;
