-- Sequence analysis screens (as OligoFlow): plasmid backbones for amplicons cloned into a plasmid, and amplicons
-- assembled from overlapping oligo fragments (children with relation FRAGMENT, synthesised like any oligo).
CREATE TABLE oligo.plasmid (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL UNIQUE,
  length_bp  integer NOT NULL CHECK (length_bp > 0),
  notes      text,
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);
ALTER TABLE oligo.oligo_sequence
  ADD COLUMN plasmid_id uuid REFERENCES oligo.plasmid (id),
  ADD CONSTRAINT plasmid_only_for_plasmid_amplicon CHECK (plasmid_id IS NULL OR product_type = 'AMPLICON_PLASMID');
-- how an amplicon was cut into fragments (oligo length, overlap, adapters), kept with the parent
ALTER TABLE oligo.oligo_sequence ADD COLUMN fragment_design jsonb;
CREATE INDEX ON oligo.oligo_sequence (product_type, status);
