-- Preparation orders waiting to be made (ingredients reserved), and incubation of prepared reagents
-- (as OligoFlow: "Lệnh pha chế chờ thực hiện", "Cần ủ", "Ủ xong").
ALTER TABLE prep.formula ADD COLUMN incubation_days integer NOT NULL DEFAULT 0 CHECK (incubation_days >= 0);
ALTER TABLE prep.preparation
  ADD COLUMN to_location_id   uuid REFERENCES master.location (id),   -- where it goes once incubated (no QC)
  ADD COLUMN incubation_until date,
  ADD COLUMN incubated_at     timestamptz,
  ADD COLUMN incubated_by     integer;

CREATE TABLE prep.prep_order (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  code           text NOT NULL UNIQUE,
  formula_id     uuid NOT NULL REFERENCES prep.formula (id),
  qty            numeric(18,6) NOT NULL CHECK (qty > 0),
  uom            text NOT NULL,
  warehouse_id   uuid NOT NULL REFERENCES master.warehouse (id),
  to_location_id uuid REFERENCES master.location (id),
  planned_date   date NOT NULL,
  notes          text,
  status         text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DONE', 'CANCELLED')),
  preparation_id uuid REFERENCES prep.preparation (id),
  cancel_reason  text,
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     integer,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     integer,
  CHECK (status <> 'DONE' OR preparation_id IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES ('PREP_ORDER', 'Lệnh pha chế chờ', 'LP{YY}{MM}-{NNNN}') ON CONFLICT DO NOTHING;
