-- Oligo post-synthesis (cleavage, deprotection, purification, quantification, resuspension / aliquots)
-- and the hooks that let QA/QC test a synthesised sequence against the OLIGO specification.

CREATE TABLE oligo.post_process (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  sequence_id         uuid NOT NULL REFERENCES oligo.oligo_sequence (id),
  batch_id            uuid REFERENCES oligo.synthesis_batch (id),
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'VOID')),
  purification        text NOT NULL CHECK (purification IN ('DESALT', 'OPC', 'HPLC', 'PAGE')),
  format              text NOT NULL CHECK (format IN ('LYOPHILIZED', 'LIQUID')),
  cleavage_done       boolean NOT NULL DEFAULT false,
  deprotection_done   boolean NOT NULL DEFAULT false,
  purification_done   boolean NOT NULL DEFAULT false,
  -- quantification: OD_total = A260 × dilution × volume (mL) / path length (cm)
  a260                numeric(10,4) CHECK (a260 >= 0),
  dilution_factor     numeric(10,2) NOT NULL DEFAULT 1 CHECK (dilution_factor >= 1),
  path_cm             numeric(6,3) NOT NULL DEFAULT 1 CHECK (path_cm > 0),
  stock_volume_ul     numeric(12,2) CHECK (stock_volume_ul > 0),
  od_total            numeric(12,3),
  nmol                numeric(12,3),
  ug                  numeric(12,3),
  -- delivery form: liquid at a target concentration, or dried aliquots
  target_conc_um      numeric(10,2) CHECK (target_conc_um > 0),
  resuspend_volume_ul numeric(12,2),
  tube_count          integer NOT NULL DEFAULT 1 CHECK (tube_count BETWEEN 1 AND 100),
  od_per_tube         numeric(12,3),
  notes               text,
  submitted_at        timestamptz,
  submitted_by        integer,
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer,
  CHECK (format <> 'LIQUID' OR status <> 'SUBMITTED' OR resuspend_volume_ul IS NOT NULL),
  CHECK (status <> 'SUBMITTED' OR (od_total > 0 AND cleavage_done AND deprotection_done AND purification_done))
);
-- one live post-processing record per sequence (a voided one stays for the history)
CREATE UNIQUE INDEX post_process_one_live ON oligo.post_process (sequence_id) WHERE status <> 'VOID';

-- Specification parameters whose value the server derives from the subject instead of the analyst
-- (e.g. ΔMW = observed − theoretical MW of the sequence), and parameters limited to some purifications.
ALTER TABLE qms.qc_spec_parameter
  ADD COLUMN derived_metric text CHECK (derived_metric IN ('MW_DELTA_DA', 'OD_TOTAL', 'YIELD_NMOL', 'YIELD_UG')),
  ADD COLUMN oligo_purifications text[],
  ADD CHECK (derived_metric IS NULL OR value_type = 'NUMERIC');
-- the raw reading behind a derived value (observed MW for ΔMW)
ALTER TABLE qms.qc_result ADD COLUMN observed_numeric numeric(24,8);
