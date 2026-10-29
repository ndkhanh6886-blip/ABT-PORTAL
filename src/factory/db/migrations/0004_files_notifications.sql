-- File metadata (content lives in the file store) and in-app notifications.

CREATE TABLE core.attachment (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  category     text NOT NULL CHECK (category IN ('COA', 'SDS', 'IMAGE', 'RAW_DATA', 'DOCUMENT', 'DRAWING', 'SIGNED_RECORD')),
  file_name    text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key  text NOT NULL,
  uploaded_by  integer NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,
  voided_by    integer,
  void_reason  text,
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX ON core.attachment (entity_type, entity_id);

CREATE TABLE core.notification (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     integer NOT NULL,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  entity_type text,
  entity_id   text,
  link        text,
  source_key  text,               -- e.g. outbox event id; a redelivered event never notifies twice
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notification_unread ON core.notification (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE UNIQUE INDEX notification_dedupe ON core.notification (user_id, source_key) WHERE source_key IS NOT NULL;

CREATE TABLE core.job_run (
  job_name    text NOT NULL,
  run_date    date NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result      jsonb,
  PRIMARY KEY (job_name, run_date)
);
