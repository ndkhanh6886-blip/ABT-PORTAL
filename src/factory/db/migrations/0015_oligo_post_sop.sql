-- Post-synthesis SOPs, organised as in OligoFlow: a library of step methods (what is recorded at a step),
-- workflows made of methods in order, and per sequence a log of every step done. Values are versioned with
-- the workflow: a record keeps the workflow revision it started with.

CREATE TABLE oligo.ps_method (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  category     text NOT NULL,                       -- Cắt & khử bảo vệ, Tinh sạch, Đo OD, Click chemistry …
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'STANDARD' CHECK (kind IN ('STANDARD', 'QUANTIFICATION')),
  target_hours numeric(8,2) CHECK (target_hours > 0),
  -- [{key, label, type: NUMBER|TEXT|EQUIPMENT|REAGENT, unit?, required, item_id?, default_qty?, uom?}]
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   integer,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   integer,
  UNIQUE (category, name)
);

CREATE TABLE oligo.ps_workflow (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  name          text NOT NULL UNIQUE,
  description   text,
  -- default workflow for these purifications (one active workflow per purification)
  purifications text[] NOT NULL DEFAULT '{}',
  -- steps frozen as a list of {method_id, name}; a change makes a new revision
  steps         jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) > 0),
  revision      integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer
);

ALTER TABLE oligo.post_process
  ADD COLUMN workflow_id uuid REFERENCES oligo.ps_workflow (id),
  ADD COLUMN workflow_revision integer,
  -- the steps as they were when the record started (the workflow can change later)
  ADD COLUMN workflow_steps jsonb;

CREATE TABLE oligo.ps_step_log (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  post_process_id uuid NOT NULL REFERENCES oligo.post_process (id),
  step_no         integer NOT NULL CHECK (step_no > 0),
  method_id       uuid NOT NULL REFERENCES oligo.ps_method (id),
  step_name       text NOT NULL,
  values          jsonb NOT NULL DEFAULT '{}'::jsonb,
  stock_document_id uuid REFERENCES inv.stock_document (id),       -- reagents of the step issued from stock
  performed_at    timestamptz NOT NULL DEFAULT now(),
  performed_by    integer NOT NULL,
  UNIQUE (post_process_id, step_no)
);
