-- Work planner (as OligoFlow's "Kế hoạch & khối lượng công việc"): tasks per person and day with a time slot;
-- hours inside the regular window count as regular time, the rest (and weekends) as overtime.
CREATE SCHEMA IF NOT EXISTS plan;

CREATE TABLE plan.task (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_unit_id  uuid NOT NULL REFERENCES core.org_unit (id),
  kind         text NOT NULL CHECK (kind IN ('SYNTHESIS', 'POST_PROCESS', 'QC', 'PREPARATION', 'EQUIPMENT', 'OTHER')),
  title        text NOT NULL,
  assignee_id  integer,                          -- null: waiting to be assigned
  work_date    date NOT NULL,
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  duration_h   numeric(6,2) NOT NULL,
  regular_h    numeric(6,2) NOT NULL,
  overtime_h   numeric(6,2) NOT NULL,
  notes        text,
  ref_type     text,                             -- what the task is about (batch, prep order, lot, equipment event …)
  ref_id       text,
  status       text NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   integer,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   integer,
  CHECK (start_time <> end_time)
);
CREATE INDEX ON plan.task (org_unit_id, work_date);
CREATE INDEX ON plan.task (assignee_id, work_date);

INSERT INTO core.setting (key, value, description) VALUES
  ('planner.regular_start', '"08:00"', 'Giờ bắt đầu khung giờ hành chính (tính giờ chuẩn); ngoài khung là tăng ca.'),
  ('planner.regular_end', '"17:00"', 'Giờ kết thúc khung giờ hành chính.')
ON CONFLICT (key) DO NOTHING;
