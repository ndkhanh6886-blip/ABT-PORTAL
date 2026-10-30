-- Post-synthesis extras (as OligoFlow): HPLC column depreciation, aliquots of a pooled synthesis per customer
-- tube, and corrections of a logged SOP step.

-- HPLC / purification columns: bought at a price for a design number of runs; each sequence run on it counts once.
CREATE TABLE asset.lc_column (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  code         text NOT NULL UNIQUE,                 -- serial / internal code
  name         text NOT NULL,
  asset_id     uuid REFERENCES asset.asset (id),     -- the instrument it is mounted on
  price_vnd    numeric(18,0) NOT NULL CHECK (price_vnd >= 0),
  design_runs  integer NOT NULL CHECK (design_runs > 0),
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  retired_reason text,
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   integer,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   integer,
  CHECK (status <> 'RETIRED' OR retired_reason IS NOT NULL)
);
CREATE TABLE asset.lc_column_run (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  column_id       uuid NOT NULL REFERENCES asset.lc_column (id),
  post_process_id uuid REFERENCES oligo.post_process (id),
  sequence_code   text,
  step_name       text,
  cost_vnd        numeric(18,2) NOT NULL,              -- price / design runs at the time of the run
  run_at          timestamptz NOT NULL DEFAULT now(),
  run_by          integer
);
CREATE INDEX ON asset.lc_column_run (column_id, run_at);

-- Pooled synthesis: after the OD of the pool master, each member (customer tube) gets its share.
CREATE TABLE oligo.pool_aliquot (
  master_post_process_id uuid NOT NULL REFERENCES oligo.post_process (id),
  sequence_id            uuid NOT NULL REFERENCES oligo.oligo_sequence (id),
  ratio_pct              numeric(6,2) NOT NULL CHECK (ratio_pct > 0 AND ratio_pct <= 100),
  od                     numeric(12,3) NOT NULL CHECK (od > 0),
  nmol                   numeric(12,3) NOT NULL,
  ug                     numeric(12,3) NOT NULL,
  volume_ul              numeric(12,2),
  tube_count             integer NOT NULL DEFAULT 1 CHECK (tube_count BETWEEN 1 AND 100),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             integer,
  PRIMARY KEY (master_post_process_id, sequence_id)
);

-- corrections of a logged step keep the previous values (the audit log has every change too)
ALTER TABLE oligo.ps_step_log ADD COLUMN corrected_at timestamptz, ADD COLUMN corrected_by integer, ADD COLUMN previous_values jsonb;
