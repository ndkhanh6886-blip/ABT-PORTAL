-- QMS (shared by every department): QC specifications, QC tests and results, deviations, NCRs.
-- `version` is the optimistic lock everywhere; a specification's revision number is `spec_version`.

CREATE SCHEMA IF NOT EXISTS qms;

CREATE TABLE qms.qc_spec (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  code         text NOT NULL,
  spec_version integer NOT NULL DEFAULT 1 CHECK (spec_version > 0),
  name         text NOT NULL,
  applies_to   text NOT NULL CHECK (applies_to IN ('ITEM', 'RECEIPT', 'PRODUCT', 'OLIGO', 'DEVICE_MODEL')),
  item_id      uuid REFERENCES master.item (id),
  status       text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'EFFECTIVE', 'OBSOLETE')),
  notes        text,
  effective_at timestamptz,
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   integer,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   integer,
  UNIQUE (code, spec_version),
  CHECK (applies_to NOT IN ('ITEM', 'RECEIPT', 'PRODUCT') OR item_id IS NOT NULL)
);
-- one effective revision per item and use
CREATE UNIQUE INDEX qc_spec_one_effective ON qms.qc_spec (item_id, applies_to) NULLS NOT DISTINCT WHERE status = 'EFFECTIVE';
CREATE UNIQUE INDEX qc_spec_one_draft ON qms.qc_spec (code) WHERE status = 'DRAFT';

CREATE TABLE qms.qc_spec_parameter (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  spec_id     uuid NOT NULL REFERENCES qms.qc_spec (id),
  seq         integer NOT NULL CHECK (seq > 0),
  name        text NOT NULL,
  method      text,
  unit        text,
  value_type  text NOT NULL CHECK (value_type IN ('NUMERIC', 'TEXT', 'PASS_FAIL')),
  lower_limit numeric(24,8),
  upper_limit numeric(24,8),
  target      text,
  is_critical boolean NOT NULL DEFAULT true,
  UNIQUE (spec_id, seq),
  CHECK (lower_limit IS NULL OR upper_limit IS NULL OR lower_limit <= upper_limit),
  CHECK (value_type = 'NUMERIC' OR (lower_limit IS NULL AND upper_limit IS NULL))
);

CREATE TABLE qms.qc_test (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  code           text NOT NULL UNIQUE,
  entity_type    text NOT NULL CHECK (entity_type IN ('LOT', 'PRODUCTION_ORDER', 'PRODUCTION_STEP', 'OLIGO_SEQUENCE', 'DEVICE_UNIT', 'RECEIPT_LINE', 'CONTAINER')),
  entity_id      uuid NOT NULL,
  spec_id        uuid NOT NULL REFERENCES qms.qc_spec (id),
  test_kind      text NOT NULL CHECK (test_kind IN ('IQC', 'IPQC', 'FQC', 'RELEASE', 'STABILITY')),
  status         text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'RESULTS_ENTERED', 'REVIEWED', 'CANCELLED')),
  analyst_id     integer,
  reviewer_id    integer,
  overall_result text CHECK (overall_result IN ('PASS', 'FAIL')),
  reviewed_at    timestamptz,
  retest_of_id   uuid REFERENCES qms.qc_test (id),
  retest_reason  text,
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     integer,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     integer,
  CHECK (retest_of_id IS NULL OR retest_reason IS NOT NULL),
  CHECK (status <> 'REVIEWED' OR (overall_result IS NOT NULL AND reviewer_id IS NOT NULL))
);
CREATE INDEX ON qms.qc_test (entity_type, entity_id);
CREATE INDEX ON qms.qc_test (status);

CREATE TABLE qms.qc_result (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  test_id             uuid NOT NULL REFERENCES qms.qc_test (id),
  parameter_id        uuid NOT NULL REFERENCES qms.qc_spec_parameter (id),
  value_numeric       numeric(24,8),
  value_text          text,
  passed              boolean,                      -- computed by the server from the spec limits
  instrument_asset_id uuid,
  raw_attachment_id   uuid REFERENCES core.attachment (id),
  entered_by          integer NOT NULL,
  entered_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_id, parameter_id)
);

CREATE TABLE qms.deviation (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  code          text NOT NULL UNIQUE,
  source_module text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid NOT NULL,
  step_ref      text,
  severity      text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  description   text NOT NULL,
  detected_by   integer NOT NULL,
  performer_id  integer,
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_INVESTIGATION', 'ACTION_DEFINED', 'CLOSED')),
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer
);
CREATE INDEX ON qms.deviation (entity_type, entity_id);

CREATE TABLE qms.ncr (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  code                    text NOT NULL UNIQUE,
  deviation_id            uuid REFERENCES qms.deviation (id),
  entity_type             text NOT NULL,
  entity_id               uuid NOT NULL,
  item_id                 uuid REFERENCES master.item (id),
  lot_id                  uuid REFERENCES inv.lot (id),
  qty_affected            numeric(18,6),
  description             text NOT NULL,
  disposition             text NOT NULL DEFAULT 'PENDING'
                          CHECK (disposition IN ('PENDING', 'SCRAP', 'REWORK', 'RESYNTHESIZE', 'USE_AS_IS', 'RETURN_TO_SUPPLIER')),
  disposition_approved_by integer,
  status                  text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DISPOSITION_PROPOSED', 'APPROVED', 'CLOSED')),
  version                 integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              integer,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              integer
);
CREATE INDEX ON qms.ncr (lot_id);
CREATE INDEX ncr_open ON qms.ncr (entity_type, entity_id) WHERE status <> 'CLOSED';

INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('QC_SPEC', 'Tiêu chuẩn QC', 'TC{NNNN}'),
  ('QC_TEST', 'Phiếu QC', 'QC{YY}{MM}-{NNNN}');
