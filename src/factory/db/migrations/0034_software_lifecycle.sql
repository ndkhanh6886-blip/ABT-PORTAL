-- 0034_software_lifecycle.sql
-- Vòng đời phát triển phần mềm của phòng KTCN (IEC 62304 cho phần mềm sản phẩm / thiết bị; GAMP 5 cho phần mềm nội bộ GMP):
-- 1. Yêu cầu phần mềm (SRS), ca kiểm thử, lần chạy kiểm thử → ma trận truy vết tự sinh khi phát hành (§5.2, §5.7, §5.8)
-- 2. Phiếu báo lỗi phần mềm (problem report, §9) nối với phiếu bảo hành và ECO
-- 3. Thẩm định phần mềm nội bộ dùng cho GMP (URS → IQ → OQ → PQ → đưa vào sử dụng)

CREATE TABLE rd.sw_requirement (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id    uuid NOT NULL REFERENCES rd.project (id),
  req_code      text NOT NULL,                                   -- SRS-001, unique within the project
  title         text NOT NULL,
  description   text,
  kind          text NOT NULL DEFAULT 'FUNCTIONAL'
                CHECK (kind IN ('FUNCTIONAL', 'PERFORMANCE', 'SAFETY', 'SECURITY', 'USABILITY', 'INTERFACE', 'REGULATORY')),
  risk_item_id  uuid REFERENCES rd.risk_item (id),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'OBSOLETE')),
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer,
  UNIQUE (project_id, req_code)
);

CREATE TABLE rd.sw_test_case (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id    uuid NOT NULL REFERENCES rd.project (id),
  tc_code       text NOT NULL,                                   -- TC-001
  title         text NOT NULL,
  level         text NOT NULL DEFAULT 'SYSTEM' CHECK (level IN ('UNIT', 'INTEGRATION', 'SYSTEM')),
  steps         text,
  expected      text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'OBSOLETE')),
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer,
  UNIQUE (project_id, tc_code)
);

-- which requirements a test case verifies
CREATE TABLE rd.sw_test_trace (
  test_case_id   uuid NOT NULL REFERENCES rd.sw_test_case (id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES rd.sw_requirement (id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, requirement_id)
);

-- executions are records: append-only (a re-test is a new run)
CREATE TABLE rd.sw_test_run (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  test_case_id  uuid NOT NULL REFERENCES rd.sw_test_case (id),
  version_tag   text NOT NULL,                                   -- the build tested, e.g. v1.2.0
  result        text NOT NULL CHECK (result IN ('PASS', 'FAIL', 'BLOCKED')),
  actual        text,
  executed_by   integer NOT NULL,
  executed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rd.sw_test_run (test_case_id, version_tag, executed_at DESC);
CREATE TRIGGER sw_test_run_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON rd.sw_test_run
  FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_change();

CREATE TABLE rd.sw_problem (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  code               text NOT NULL UNIQUE,
  project_id         uuid NOT NULL REFERENCES rd.project (id),
  title              text NOT NULL,
  description        text NOT NULL,
  severity           text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  source             text NOT NULL DEFAULT 'INTERNAL_TEST' CHECK (source IN ('INTERNAL_TEST', 'FIELD', 'SERVICE_TICKET', 'CUSTOMER', 'REVIEW')),
  found_in_version   text,
  service_ticket_id  uuid REFERENCES device.service_ticket (id),
  eco_id             uuid REFERENCES device.eco_request (id),
  root_cause         text,
  fix_summary        text,
  fixed_in_version   text,
  fixed_by           integer,
  verified_by        integer,
  verified_at        timestamptz,
  reject_reason      text,
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'FIXED', 'VERIFIED', 'REJECTED')),
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         integer
);
CREATE INDEX ON rd.sw_problem (project_id, status);

ALTER TABLE rd.software_release ADD COLUMN IF NOT EXISTS source_ref text;   -- commit / tag of the released build

CREATE TABLE rd.sw_validation (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  code               text NOT NULL UNIQUE,
  org_unit_id        uuid NOT NULL REFERENCES core.org_unit (id),
  system_name        text NOT NULL,
  system_version     text NOT NULL,
  gamp_category      text NOT NULL DEFAULT '4' CHECK (gamp_category IN ('1', '3', '4', '5')),
  gxp_impact         boolean NOT NULL DEFAULT true,
  intended_use       text NOT NULL,                              -- URS summary
  risk_level         text NOT NULL DEFAULT 'MEDIUM' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  iq_summary         text,
  oq_summary         text,
  pq_summary         text,
  iq_by              integer,
  oq_by              integer,
  pq_by              integer,
  approved_by        integer,
  approved_at        timestamptz,
  retire_reason      text,
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IQ_DONE', 'OQ_DONE', 'PQ_DONE', 'IN_USE', 'RETIRED')),
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         integer
);

INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('SW_PROBLEM',    'Phiếu báo lỗi phần mềm',               'SPR{YY}-{NNNN}'),
  ('SW_VALIDATION', 'Hồ sơ thẩm định phần mềm nội bộ (CSV)', 'CSV{YY}-{NNN}')
ON CONFLICT (sequence_key) DO NOTHING;
