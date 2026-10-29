-- Oligo orders and their sequences (docs/nha-may/01 §11, 02 §9.1–9.2), split and pooling.
-- Prices are not kept here: the selling price belongs to Kinh doanh (Q1).

-- Synthesis scales (configuration). Customers may order by guaranteed OD; each OD range maps to a
-- synthesis scale, as in the former OligoFlow.
CREATE TABLE oligo.scale (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  synth_nmol numeric(10,1) NOT NULL CHECK (synth_nmol > 0),
  od_min     numeric(10,2),
  od_max     numeric(10,2),
  sort_order integer NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CHECK ((od_min IS NULL) = (od_max IS NULL) AND (od_min IS NULL OR od_min < od_max))
);
INSERT INTO oligo.scale (code, label, synth_nmol, od_min, od_max, sort_order) VALUES
  ('100NMOL', '100 nmol', 100, NULL, NULL, 10),
  ('200NMOL', '200 nmol', 200, NULL, NULL, 20),
  ('500NMOL', '500 nmol', 500, NULL, NULL, 30),
  ('1UMOL', '1 µmol', 1000, NULL, NULL, 40),
  ('OD2-5', '2–5 OD', 100, 2, 5, 50),
  ('OD5-10', '5–10 OD', 100, 5, 10, 60),
  ('OD10-20', '10–20 OD', 200, 10, 20, 70),
  ('OD20-50', '20–50 OD', 200, 20, 50, 80),
  ('OD50-100', '50–100 OD', 500, 50, 100, 90);

CREATE TABLE oligo.oligo_order (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  code                  text NOT NULL UNIQUE,
  org_unit_id           uuid NOT NULL REFERENCES core.org_unit (id),          -- the Oligo department
  internal_order_id     uuid REFERENCES intake.internal_order (id),          -- order from Kinh doanh, if any
  customer_label        text,                                                -- end customer / requester shown on labels
  due_date              date,
  initial_due_date      date,
  due_date_change_count integer NOT NULL DEFAULT 0,
  notes                 text,
  status                text NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED', 'FAILED', 'CANCELLED')),
  version               integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            integer,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            integer
);
CREATE INDEX ON oligo.oligo_order (org_unit_id, status);
CREATE INDEX ON oligo.oligo_order (internal_order_id);

CREATE TABLE oligo.oligo_sequence (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  code                text NOT NULL UNIQUE,
  order_id            uuid REFERENCES oligo.oligo_order (id),     -- NULL only for a pool master (several orders)
  org_unit_id         uuid NOT NULL REFERENCES core.org_unit (id),
  line_no             integer,
  name                text NOT NULL,
  raw_sequence        text NOT NULL,
  normalized_sequence text NOT NULL,
  base_count          integer NOT NULL CHECK (base_count > 0),
  molecule_type       text NOT NULL CHECK (molecule_type IN ('DNA', 'RNA')),
  product_type        text NOT NULL CHECK (product_type IN ('PRIMER', 'PROBE', 'AMPLICON_LINEAR', 'AMPLICON_PLASMID')),
  scale_code          text NOT NULL REFERENCES oligo.scale (code),
  purification        text NOT NULL CHECK (purification IN ('DESALT', 'OPC', 'HPLC', 'PAGE')),
  format              text NOT NULL CHECK (format IN ('LYOPHILIZED', 'LIQUID')),
  mw                  numeric(12,2) NOT NULL,
  ext_coeff_260       numeric(12,1) NOT NULL,
  tm                  numeric(6,1) NOT NULL,
  nmol_per_od         numeric(10,2) NOT NULL,
  ug_per_od           numeric(10,2) NOT NULL,
  gc_percent          numeric(5,1) NOT NULL,
  modifications       text[] NOT NULL DEFAULT '{}',
  warnings            jsonb NOT NULL DEFAULT '[]'::jsonb,
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN
                      ('PENDING', 'SPLIT', 'POOLED', 'QUEUED', 'SYNTHESIZING', 'SYNTHESIZED', 'POST_PROCESSING', 'QC', 'COMPLETED', 'DELIVERED', 'FAILED', 'CANCELLED')),
  parent_sequence_id  uuid REFERENCES oligo.oligo_sequence (id),
  relation            text CHECK (relation IN ('SPLIT', 'POOL_MASTER', 'RESYNTH', 'FRAGMENT')),
  pool_id             uuid,
  notes               text,
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          integer,
  CHECK (order_id IS NOT NULL OR relation = 'POOL_MASTER'),
  CHECK ((parent_sequence_id IS NULL) = (relation IS NULL OR relation = 'POOL_MASTER'))
);
CREATE INDEX ON oligo.oligo_sequence (order_id);
CREATE INDEX ON oligo.oligo_sequence (status);
CREATE INDEX ON oligo.oligo_sequence (parent_sequence_id);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX oligo_sequence_norm_trgm ON oligo.oligo_sequence USING gin (normalized_sequence gin_trgm_ops);
CREATE INDEX oligo_sequence_name_trgm ON oligo.oligo_sequence USING gin (name gin_trgm_ops);

CREATE TABLE oligo.oligo_pool (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  master_sequence_id uuid NOT NULL UNIQUE REFERENCES oligo.oligo_sequence (id),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISSOLVED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer
);
CREATE TABLE oligo.oligo_pool_member (
  pool_id     uuid NOT NULL REFERENCES oligo.oligo_pool (id),
  sequence_id uuid NOT NULL REFERENCES oligo.oligo_sequence (id),
  ratio_pct   numeric(6,2) NOT NULL CHECK (ratio_pct > 0 AND ratio_pct <= 100),
  PRIMARY KEY (pool_id, sequence_id)
);
ALTER TABLE oligo.oligo_sequence ADD FOREIGN KEY (pool_id) REFERENCES oligo.oligo_pool (id);

INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('OLIGO_ORDER', 'Đơn Oligo', 'OL{YY}{MM}-{NNNN}');
