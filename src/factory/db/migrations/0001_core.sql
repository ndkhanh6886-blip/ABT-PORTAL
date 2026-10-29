-- Core: organisation, factory roles & permissions, numbering, audit trail, e-signatures,
-- idempotency, outbox, settings. User ids are ABT Portal `users.id` (shared login).

CREATE SCHEMA IF NOT EXISTS core;

-- Records that must never change once written (audit trail, e-signatures).
CREATE FUNCTION core.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % chỉ cho phép ghi thêm', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TABLE core.org_unit (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  unit_type   text NOT NULL CHECK (unit_type IN ('COMPANY', 'DEPARTMENT', 'TEAM')),
  parent_id   uuid REFERENCES core.org_unit (id),
  module_key  text CHECK (module_key IN ('RD', 'KIT', 'OLIGO', 'DEVICE', 'QA', 'WH', 'SALES', 'PURCHASE', 'HR', 'BOD')),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  integer,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  integer,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX ON core.org_unit (parent_id);

CREATE TABLE core.user_profile (
  user_id             integer PRIMARY KEY,           -- abt_portal.users.id
  display_name        text NOT NULL,
  org_unit_id         uuid REFERENCES core.org_unit (id),
  pin_hash            text,
  pin_failed_attempts integer NOT NULL DEFAULT 0,
  pin_locked_until    timestamptz,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON core.user_profile (org_unit_id);

CREATE TABLE core.permission (
  code            text PRIMARY KEY,                  -- e.g. oligo.batch.create
  module          text NOT NULL,
  action          text NOT NULL,
  description     text NOT NULL,
  is_gxp_critical boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true      -- synced from the registry in code
);

CREATE TABLE core.role (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  integer
);

CREATE TABLE core.role_permission (
  role_id         uuid NOT NULL REFERENCES core.role (id),
  permission_code text NOT NULL REFERENCES core.permission (code),
  PRIMARY KEY (role_id, permission_code)
);

-- Role granted to a user, optionally limited to an org unit and its sub-units.
CREATE TABLE core.user_role (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id           integer NOT NULL REFERENCES core.user_profile (user_id),
  role_id           uuid NOT NULL REFERENCES core.role (id),
  scope_org_unit_id uuid REFERENCES core.org_unit (id),   -- NULL = whole company
  valid_from        timestamptz NOT NULL DEFAULT now(),
  valid_to          timestamptz,
  granted_by        integer,
  granted_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoked_by        integer,
  revoke_reason     text,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX user_role_active_uq ON core.user_role (user_id, role_id, scope_org_unit_id)
  NULLS NOT DISTINCT WHERE revoked_at IS NULL;

CREATE TABLE core.delegation (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  from_user_id integer NOT NULL REFERENCES core.user_profile (user_id),
  to_user_id   integer NOT NULL REFERENCES core.user_profile (user_id),
  role_id      uuid NOT NULL REFERENCES core.role (id),
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz NOT NULL,
  reason       text NOT NULL,
  created_by   integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  CHECK (from_user_id <> to_user_id),
  CHECK (valid_to > valid_from)
);
CREATE INDEX ON core.delegation (to_user_id);

-- Numbering. A counter row exists per sequence and per "scope" = the rendered code without its
-- counter (e.g. 'DN2610-#'), so periodic reset and per-model serials need no reset job.
CREATE TABLE core.sequence_definition (
  sequence_key text PRIMARY KEY,
  name         text NOT NULL,
  pattern      text NOT NULL,
  version      integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   integer
);

CREATE TABLE core.number_counter (
  sequence_key text NOT NULL REFERENCES core.sequence_definition (sequence_key),
  scope_key    text NOT NULL,
  last_value   bigint NOT NULL CHECK (last_value > 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sequence_key, scope_key)
);

CREATE TABLE core.audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  user_id      integer,
  user_name    text,
  on_behalf_of integer,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  action       text NOT NULL,
  changes      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {field: [old, new]}
  reason       text,
  request_id   text,
  ip           text
);
CREATE INDEX ON core.audit_log (entity_type, entity_id);
CREATE INDEX ON core.audit_log (occurred_at);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON core.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_change();

CREATE TABLE core.e_signature (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  entity_type    text NOT NULL,
  entity_id      text NOT NULL,
  entity_version integer NOT NULL,
  meaning        text NOT NULL CHECK (meaning IN ('PERFORMED', 'CHECKED', 'REVIEWED', 'APPROVED', 'RELEASED')),
  signer_id      integer NOT NULL,
  signer_name    text NOT NULL,
  signed_at      timestamptz NOT NULL DEFAULT now(),
  reason         text,
  auth_method    text NOT NULL CHECK (auth_method IN ('PIN', 'PASSWORD')),
  record_hash    text NOT NULL CHECK (record_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX ON core.e_signature (entity_type, entity_id);
CREATE TRIGGER e_signature_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON core.e_signature
  FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_change();

CREATE TABLE core.idempotency_key (
  user_id      integer NOT NULL,
  endpoint     text NOT NULL,
  key          text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  request_hash text NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);
CREATE INDEX ON core.idempotency_key (created_at);

CREATE TABLE core.outbox_event (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  event_type   text NOT NULL,
  target       text NOT NULL DEFAULT 'FACTORY' CHECK (target IN ('FACTORY', 'KD')),
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX outbox_pending_idx ON core.outbox_event (available_at) WHERE processed_at IS NULL;

CREATE TABLE core.setting (
  key         text PRIMARY KEY,
  value       jsonb,
  description text NOT NULL,
  version     integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  integer
);

-- Configuration (not demo data): default numbering patterns and tunable thresholds.
INSERT INTO core.sequence_definition (sequence_key, name, pattern) VALUES
  ('INTERNAL_ORDER',   'Đơn nội bộ',                 'DN{YY}{MM}-{NNNN}'),
  ('PURCHASE_REQUEST', 'Đề nghị mua NVL',            'PR{YY}{MM}-{NNNN}'),
  ('PURCHASE_ORDER',   'Đơn mua NVL',                'PM{YY}{MM}-{NNNN}'),
  ('GOODS_RECEIPT',    'Phiếu nhận hàng',            'GR{YY}{MM}-{NNNN}'),
  ('STOCK_RECEIPT',    'Phiếu nhập kho',             'NK{YY}{MM}-{NNNN}'),
  ('STOCK_ISSUE',      'Phiếu xuất kho',             'XK{YY}{MM}-{NNNN}'),
  ('STOCK_TRANSFER',   'Phiếu chuyển kho',           'CK{YY}{MM}-{NNNN}'),
  ('STOCK_ADJUST',     'Phiếu điều chỉnh kho',       'DC{YY}{MM}-{NNNN}'),
  ('LOT_RECEIVED',     'Lô NVL nhận',                'R{YY}{MM}{DD}{NN}'),
  ('LOT_KIT',          'Lô Kit thành phẩm',          'K{YY}{MM}{NNN}'),
  ('LOT_PREPARATION',  'Lô hóa chất pha',            'P{YY}{MM}{NNN}'),
  ('OLIGO_SEQUENCE',   'Mã trình tự Oligo',          'O{YY}{MM}{NNNNN}'),
  ('SYNTHESIS_BATCH',  'Mẻ tổng hợp',                'SB{YY}{MM}{DD}-{NN}'),
  ('DEVICE_SERIAL',    'Serial thiết bị',            '{MODEL}-{YY}{NNNN}'),
  ('DEVIATION',        'Sai lệch',                   'DEV{YY}-{NNNN}'),
  ('NCR',              'Báo cáo không phù hợp',      'NCR{YY}-{NNNN}'),
  ('CAPA',             'CAPA',                       'CAPA{YY}-{NNNN}'),
  ('CHANGE_REQUEST',   'Yêu cầu thay đổi',           'CR{YY}-{NNNN}'),
  ('DELIVERY_NOTE',    'Phiếu giao hàng',            'GH{YY}{MM}-{NNNN}');

INSERT INTO core.setting (key, value, description) VALUES
  ('purchase.pr_bod_approval_threshold_vnd', 'null',
   'Đề nghị mua có tổng giá trị ước tính từ mức này trở lên cần Ban giám đốc ký duyệt. null = không yêu cầu.'),
  ('purchase.receipt_over_tolerance_pct', '0',
   'Tỉ lệ % cho phép nhận vượt số lượng đặt trên mỗi dòng đơn mua.'),
  ('security.pin_max_failed_attempts', '5', 'Số lần nhập sai PIN chữ ký trước khi tạm khóa.'),
  ('security.pin_lock_minutes', '15', 'Số phút tạm khóa PIN sau khi nhập sai quá số lần cho phép.');
