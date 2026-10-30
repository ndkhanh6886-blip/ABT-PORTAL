-- Equipment maintenance, calibration, repair and cleaning (as OligoFlow's "Kế hoạch bảo trì, hiệu chuẩn & sửa chữa"):
-- planned events, completed with the actual date, who did it (staff or an outside service), the result, cost and
-- documents. A completed calibration sets the next due date; a breakdown takes the instrument out of service.

CREATE TABLE asset.event (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  code             text NOT NULL UNIQUE,
  asset_id         uuid NOT NULL REFERENCES asset.asset (id),
  kind             text NOT NULL CHECK (kind IN ('MAINTENANCE', 'CALIBRATION', 'REPAIR', 'CLEANING', 'QUALIFICATION')),
  status           text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DONE', 'CANCELLED')),
  planned_date     date NOT NULL,
  assignee         text,                                -- staff member or outside service expected to do it
  description      text,
  out_of_service   boolean NOT NULL DEFAULT false,      -- a breakdown: the instrument may not be used until done
  done_date        date,
  performed_by     text,
  result           text,
  passed           boolean,                             -- calibration / qualification verdict
  next_due         date,                                -- calibration: next due date set on the instrument
  cost_vnd         numeric(18,0) CHECK (cost_vnd >= 0),
  cancel_reason    text,
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       integer,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       integer,
  CHECK (status <> 'DONE' OR (done_date IS NOT NULL AND performed_by IS NOT NULL AND result IS NOT NULL)),
  CHECK (status <> 'DONE' OR kind NOT IN ('CALIBRATION', 'QUALIFICATION') OR passed IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
CREATE INDEX ON asset.event (asset_id, planned_date);
CREATE INDEX ON asset.event (status, planned_date);

INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('ASSET_EVENT', 'Phiếu bảo trì / hiệu chuẩn thiết bị', 'BT{YY}{MM}-{NNNN}')
ON CONFLICT DO NOTHING;
