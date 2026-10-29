-- Auto-generated complete database schema for ABT & VIA Portal

CREATE TABLE IF NOT EXISTS "app_storage" (
  "key" VARCHAR(255) NOT NULL,
  "data" JSONB,
  "version" INTEGER DEFAULT 1,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "application_daily_logs" (
  "id" SERIAL,
  "log_date" DATE NOT NULL,
  "employee_name" VARCHAR(150),
  "content" TEXT,
  "result" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "application_issues" (
  "id" SERIAL,
  "ticket_code" VARCHAR(50) NOT NULL,
  "customer_name" VARCHAR(255) NOT NULL,
  "device_name" VARCHAR(255),
  "issue_description" TEXT NOT NULL,
  "severity" VARCHAR(50) DEFAULT 'MEDIUM'::character varying,
  "status" VARCHAR(50) DEFAULT 'OPEN'::character varying,
  "assigned_technician" VARCHAR(150),
  "resolution_steps" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "application_plans" (
  "id" SERIAL,
  "week_number" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "employee_name" VARCHAR(150),
  "plan_data" JSONB DEFAULT '{}'::jsonb NOT NULL,
  "status" VARCHAR(50) DEFAULT 'DRAFT'::character varying,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "application_resources" (
  "id" SERIAL,
  "resource_code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "status" VARCHAR(50) DEFAULT 'AVAILABLE'::character varying,
  "current_location" VARCHAR(255),
  "assigned_to" VARCHAR(150),
  "notes" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "application_tasks" (
  "id" SERIAL,
  "task_code" VARCHAR(50),
  "title" VARCHAR(255) NOT NULL,
  "assignee_name" VARCHAR(150),
  "customer_name" VARCHAR(255),
  "task_type" VARCHAR(100) DEFAULT 'Demo máy / Chạy thử nghiệm'::character varying,
  "priority" VARCHAR(50) DEFAULT 'MEDIUM'::character varying,
  "status" VARCHAR(50) DEFAULT 'TODO'::character varying,
  "deadline" DATE,
  "description" TEXT,
  "logs" JSONB DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" SERIAL,
  "action" VARCHAR(100) NOT NULL,
  "module" VARCHAR(100) NOT NULL,
  "details" TEXT,
  "actor_username" VARCHAR(100),
  "actor_name" VARCHAR(150),
  "ip_address" VARCHAR(50),
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_channels" (
  "id" SERIAL,
  "channel_code" VARCHAR(100) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "channel_type" VARCHAR(50) DEFAULT 'CHANNEL'::character varying,
  "department" VARCHAR(100),
  "description" TEXT,
  "is_private" BOOLEAN DEFAULT false,
  "created_by" VARCHAR(100),
  "members" JSONB DEFAULT '[]'::jsonb,
  "pinned_messages" JSONB DEFAULT '[]'::jsonb,
  "last_message_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" SERIAL,
  "channel_id" INTEGER,
  "channel_code" VARCHAR(100),
  "sender_id" VARCHAR(100),
  "sender_name" VARCHAR(100) NOT NULL,
  "sender_avatar" VARCHAR(255),
  "sender_role" VARCHAR(100),
  "sender_dept" VARCHAR(100),
  "content" TEXT NOT NULL,
  "attachments" JSONB DEFAULT '[]'::jsonb,
  "related_work" JSONB,
  "reactions" JSONB DEFAULT '{}'::jsonb,
  "is_pinned" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "company_daily_logs" (
  "id" SERIAL,
  "log_date" DATE DEFAULT CURRENT_DATE NOT NULL,
  "department" VARCHAR(100) NOT NULL,
  "employee_name" VARCHAR(100) NOT NULL,
  "work_content" TEXT NOT NULL,
  "result" TEXT,
  "issues" TEXT,
  "next_day_plan" TEXT,
  "related_task_code" VARCHAR(50),
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "plan_items" JSONB DEFAULT '[]'::jsonb,
  "manager_feedback" TEXT,
  "manager_name" VARCHAR(255),
  "manager_feedback_at" TIMESTAMP WITHOUT TIME ZONE,
  "staff_feedback" TEXT,
  "staff_feedback_at" TIMESTAMP WITHOUT TIME ZONE,
  "performance_rating" VARCHAR(50),
  "work_hours" NUMERIC DEFAULT 8,
  "proportionality_score" VARCHAR(100),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "company_tasks" (
  "id" SERIAL,
  "task_code" VARCHAR(50) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "department" VARCHAR(100) NOT NULL,
  "task_category" VARCHAR(100) NOT NULL,
  "assignee_name" VARCHAR(100),
  "customer_name" VARCHAR(255),
  "priority" VARCHAR(20) DEFAULT 'MEDIUM'::character varying,
  "status" VARCHAR(30) DEFAULT 'TODO'::character varying,
  "deadline" DATE,
  "description" TEXT,
  "related_workflow_code" VARCHAR(50),
  "logs" JSONB DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "result" TEXT,
  "attachments" JSONB DEFAULT '[]'::jsonb,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_contacts" (
  "id" SERIAL,
  "customer_code" VARCHAR(100) NOT NULL,
  "customer_id" INTEGER,
  "name" VARCHAR(255) NOT NULL,
  "position" VARCHAR(150),
  "department" VARCHAR(150),
  "phone" VARCHAR(50),
  "email" VARCHAR(150),
  "role_type" VARCHAR(100) DEFAULT 'Kỹ thuật / Quyết định mua'::character varying,
  "is_primary" BOOLEAN DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_feedback" (
  "id" SERIAL,
  "customer_name" VARCHAR(255) NOT NULL,
  "customer_phone" VARCHAR(50),
  "organization" VARCHAR(255),
  "order_code" VARCHAR(100),
  "nps_score" INTEGER,
  "csat_cold_chain" INTEGER,
  "csat_delivery" INTEGER,
  "csat_product" INTEGER,
  "csat_support" INTEGER,
  "comments" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_incidents" (
  "id" SERIAL,
  "incident_code" VARCHAR(100) NOT NULL,
  "customer_name" VARCHAR(255) NOT NULL,
  "customer_phone" VARCHAR(50),
  "customer_email" VARCHAR(255),
  "organization" VARCHAR(255),
  "order_code" VARCHAR(100),
  "product_code" VARCHAR(100),
  "product_name" VARCHAR(255),
  "lot_number" VARCHAR(100),
  "incident_category" VARCHAR(100) NOT NULL,
  "severity" VARCHAR(50) DEFAULT 'MEDIUM'::character varying,
  "patient_impact" VARCHAR(100),
  "instrument_model" VARCHAR(100),
  "affected_tests" INTEGER DEFAULT 1,
  "description" TEXT NOT NULL,
  "attachments" JSONB DEFAULT '[]'::jsonb,
  "status" VARCHAR(50) DEFAULT 'RECEIVED'::character varying,
  "capa_action" TEXT,
  "assigned_to" VARCHAR(100),
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "root_cause_data" JSONB DEFAULT '{}'::jsonb,
  "incident_categories" JSONB DEFAULT '[]'::jsonb,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "current_step" VARCHAR(50) DEFAULT 'Step1'::character varying,
  "resolution_status" VARCHAR(50) DEFAULT 'Investigating'::character varying,
  "root_cause_conclusion" TEXT,
  "final_customer_solution" TEXT,
  "corrective_actions" TEXT,
  "preventive_actions" TEXT,
  "not_real_issue_reason" TEXT,
  "investigation_details" JSONB DEFAULT '{}'::jsonb,
  "handled_by" VARCHAR(100),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_sequences" (
  "doc_type" VARCHAR(30) NOT NULL,
  "prefix" VARCHAR(50) NOT NULL,
  "current_seq" INTEGER DEFAULT 0 NOT NULL,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("doc_type", "prefix")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_sequences_composite" ON "document_sequences" ("doc_type", "prefix");

CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id" SERIAL,
  "product_id" INTEGER,
  "product_code" VARCHAR(50) NOT NULL UNIQUE,
  "product_name" VARCHAR(255) NOT NULL,
  "quantity_on_hand" INTEGER DEFAULT 0 CHECK (quantity_on_hand >= 0),
  "quantity_allocated" INTEGER DEFAULT 0 CHECK (quantity_allocated >= 0),
  "warehouse_location" VARCHAR(100) DEFAULT 'Kho ABT Trung Tâm'::character varying,
  "shelf_position" VARCHAR(100),
  "last_updated" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "lot_number" VARCHAR(100),
  "expiry_date" VARCHAR(50),
  "is_quarantined" BOOLEAN DEFAULT false,
  "quarantine_reason" TEXT,
  "components" JSONB DEFAULT '[]'::jsonb,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_lots" (
  "id" SERIAL PRIMARY KEY,
  "product_code" VARCHAR(100) NOT NULL,
  "lot_number" VARCHAR(100) NOT NULL DEFAULT 'NO-LOT',
  "expiry_date" VARCHAR(50),
  "warehouse_location" VARCHAR(100) NOT NULL DEFAULT 'Kho Trung Tâm',
  "quantity_on_hand" INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  "is_quarantined" BOOLEAN NOT NULL DEFAULT false,
  "quarantine_reason" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "last_updated" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_lots_unique" UNIQUE ("product_code", "lot_number", "warehouse_location")
);


CREATE TABLE IF NOT EXISTS "inventory_reservations" (
  "id" SERIAL,
  "order_code" VARCHAR(100),
  "customer_name" VARCHAR(255),
  "sales_rep_name" VARCHAR(100),
  "product_code" VARCHAR(100),
  "product_name" VARCHAR(255),
  "lot_number" VARCHAR(100),
  "quantity_reserved" INTEGER DEFAULT 1,
  "reserved_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "hold_until_date" DATE,
  "status" VARCHAR(50) DEFAULT 'ACTIVE'::character varying,
  "notes" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_transactions" (
  "id" SERIAL,
  "transaction_code" VARCHAR(120) NOT NULL UNIQUE,
  "transaction_type" VARCHAR(50) NOT NULL,
  "reference_code" VARCHAR(100),
  "date" DATE NOT NULL,
  "performed_by" VARCHAR(150),
  "warehouse_name" VARCHAR(100) DEFAULT 'Kho ABT Trung Tâm'::character varying,
  "items" JSONB DEFAULT '[]'::jsonb NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lot_recalls" (
  "id" SERIAL,
  "recall_code" VARCHAR(100) NOT NULL,
  "product_code" VARCHAR(100) NOT NULL,
  "product_name" VARCHAR(255),
  "lot_number" VARCHAR(100) NOT NULL,
  "reason" TEXT NOT NULL,
  "severity" VARCHAR(50) DEFAULT 'HIGH'::character varying,
  "status" VARCHAR(50) DEFAULT 'ACTIVE'::character varying,
  "quarantine_stock" BOOLEAN DEFAULT true,
  "affected_orders" JSONB DEFAULT '[]'::jsonb,
  "action_taken" TEXT,
  "reported_by" VARCHAR(100),
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "personnel" (
  "id" SERIAL,
  "employee_code" VARCHAR(50) NOT NULL,
  "full_name" VARCHAR(150) NOT NULL,
  "department" VARCHAR(100) NOT NULL,
  "position" VARCHAR(100) NOT NULL,
  "email" VARCHAR(150),
  "phone" VARCHAR(50),
  "status" VARCHAR(50) DEFAULT 'ACTIVE'::character varying,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "procurement_orders" (
  "id" SERIAL,
  "po_code" VARCHAR(50) NOT NULL UNIQUE,
  "supplier_id" INTEGER,
  "supplier_name" VARCHAR(255) NOT NULL,
  "order_date" DATE NOT NULL,
  "expected_delivery_date" DATE,
  "items" JSONB DEFAULT '[]'::jsonb NOT NULL,
  "total_amount" NUMERIC DEFAULT 0,
  "amount_paid" NUMERIC DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'PENDING'::character varying,
  "inbound_transaction_code" VARCHAR(120),
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "procurement_payments" (
  "id" SERIAL PRIMARY KEY,
  "po_id" INTEGER NOT NULL REFERENCES procurement_orders(id) ON DELETE RESTRICT,
  "request_id" VARCHAR(64) NOT NULL,
  "amount" NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  "method" VARCHAR(100),
  "reference_doc" VARCHAR(150),
  "payment_date" DATE NOT NULL DEFAULT CURRENT_DATE,
  "notes" TEXT,
  "created_by" VARCHAR(150),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "procurement_payments_idem" UNIQUE ("po_id", "request_id")
);


CREATE TABLE IF NOT EXISTS "procurement_suppliers" (
  "id" SERIAL,
  "supplier_code" VARCHAR(50) NOT NULL UNIQUE,
  "name" VARCHAR(255) NOT NULL,
  "short_name" VARCHAR(100),
  "contact_person" VARCHAR(150),
  "phone" VARCHAR(50),
  "email" VARCHAR(150),
  "address" TEXT,
  "product_lines" TEXT,
  "payment_terms" VARCHAR(100) DEFAULT '30 ngày'::character varying,
  "rating" INTEGER DEFAULT 5,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supplier_products" (
  "id" SERIAL,
  "supplier_id" INTEGER NOT NULL REFERENCES procurement_suppliers(id) ON DELETE CASCADE,
  "product_code" VARCHAR(100) NOT NULL,
  "product_name" VARCHAR(255) NOT NULL,
  "specification" VARCHAR(255),
  "unit" VARCHAR(50) DEFAULT 'Cái'::character varying,
  "currency" VARCHAR(10) DEFAULT 'VND'::character varying,
  "purchase_price" NUMERIC DEFAULT 0,
  "tax_rate" NUMERIC DEFAULT 0,
  "lead_time_days" INTEGER DEFAULT 7,
  "min_order_qty" INTEGER DEFAULT 1,
  "notes" TEXT,
  "price_history" JSONB DEFAULT '[]'::jsonb,
  "last_updated_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "supplier_products_unique" UNIQUE ("supplier_id", "product_code")
);

CREATE TABLE IF NOT EXISTS "product_components" (
  "id" SERIAL,
  "parent_product_code" VARCHAR(100) NOT NULL,
  "component_code" VARCHAR(100) NOT NULL,
  "component_name" VARCHAR(255) NOT NULL,
  "specification" VARCHAR(255),
  "unit" VARCHAR(50) DEFAULT 'Cái'::character varying,
  "quantity_per_kit" NUMERIC DEFAULT 1,
  "tracking_type" VARCHAR(50) DEFAULT 'LOT'::character varying,
  "storage_condition" VARCHAR(100) DEFAULT '15-25°C'::character varying,
  "is_mandatory" BOOLEAN DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "products" (
  "id" SERIAL,
  "code" VARCHAR(50) NOT NULL UNIQUE,
  "name" VARCHAR(255) NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "unit" VARCHAR(50) NOT NULL,
  "specification" VARCHAR(255),
  "standard_price" NUMERIC DEFAULT 0,
  "cost_price" NUMERIC DEFAULT 0,
  "manufacturer" VARCHAR(150),
  "origin" VARCHAR(100),
  "min_stock_level" INTEGER DEFAULT 10,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "storage_condition" VARCHAR(255),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "rma_returns" (
  "id" SERIAL,
  "rma_code" VARCHAR(100) NOT NULL UNIQUE,
  "order_code" VARCHAR(100),
  "customer_id" INTEGER,
  "customer_name" VARCHAR(255) NOT NULL,
  "items" JSONB DEFAULT '[]'::jsonb,
  "total_amount" NUMERIC DEFAULT 0,
  "reason_category" VARCHAR(100),
  "status" VARCHAR(50) DEFAULT 'PENDING_APPROVAL'::character varying,
  "restock_action" VARCHAR(50) DEFAULT 'RESTOCK'::character varying,
  "refund_type" VARCHAR(50) DEFAULT 'CREDIT_OFFSET'::character varying,
  "approved_by" VARCHAR(100),
  "notes" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_contracts" (
  "id" SERIAL,
  "contract_code" VARCHAR(100) NOT NULL,
  "customer_id" INTEGER,
  "customer_name" VARCHAR(255) NOT NULL,
  "sales_rep_name" VARCHAR(100),
  "title" VARCHAR(255),
  "sign_date" DATE DEFAULT CURRENT_DATE,
  "valid_until" DATE,
  "total_value" NUMERIC DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'ACTIVE'::character varying,
  "notes" TEXT,
  "contract_files" JSONB DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "items" JSONB DEFAULT '[]'::jsonb,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_delivery_slips" (
  "id" SERIAL,
  "slip_code" VARCHAR(100) NOT NULL UNIQUE,
  "order_id" VARCHAR(100),
  "order_code" VARCHAR(100),
  "customer_name" VARCHAR(255),
  "customer_address" TEXT,
  "customer_phone" VARCHAR(50),
  "customer_contact" VARCHAR(150),
  "delivery_date" VARCHAR(50),
  "timeliness" VARCHAR(100),
  "dispatch_location" VARCHAR(255),
  "dispatcher_name" VARCHAR(150),
  "dispatcher_phone" VARCHAR(50),
  "creator_name" VARCHAR(150),
  "notes" TEXT,
  "items" JSONB DEFAULT '[]'::jsonb,
  "invoice_number" VARCHAR(100),
  "invoice_date" VARCHAR(50),
  "status" VARCHAR(50) DEFAULT 'COMPLETED'::character varying,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_customers" (
  "id" SERIAL,
  "customer_code" VARCHAR(50) NOT NULL UNIQUE,
  "name" VARCHAR(255) NOT NULL,
  "contact_person" VARCHAR(150),
  "contact_position" VARCHAR(100),
  "phone" VARCHAR(50),
  "email" VARCHAR(150),
  "address" TEXT,
  "tax_code" VARCHAR(50),
  "sales_rep_id" VARCHAR(50),
  "sales_rep_name" VARCHAR(150),
  "classification" VARCHAR(50) DEFAULT 'Khách hàng trực tiếp'::character varying,
  "payment_terms" VARCHAR(100) DEFAULT 'Thanh toán 30 ngày'::character varying,
  "notes" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "credit_limit" NUMERIC DEFAULT 100000000,
  "credit_term_days" INTEGER DEFAULT 30,
  "customer_type" VARCHAR(50) DEFAULT 'END_USER'::character varying,
  "special_price_list" JSONB DEFAULT '[]'::jsonb,
  "contract_files" JSONB DEFAULT '[]'::jsonb,
  "contacts" JSONB DEFAULT '[]'::jsonb,
  "region" VARCHAR(50),
  "province" VARCHAR(100),
  "industry" VARCHAR(255),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_daily_logs" (
  "id" SERIAL,
  "log_date" DATE NOT NULL,
  "employee_code" VARCHAR(50),
  "employee_name" VARCHAR(150),
  "work_content" TEXT,
  "result" TEXT,
  "issues" TEXT,
  "next_day_plan" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" SERIAL,
  "order_code" VARCHAR(50) NOT NULL,
  "customer_id" INTEGER,
  "customer_name" VARCHAR(255) NOT NULL,
  "sales_rep_name" VARCHAR(150),
  "order_date" DATE NOT NULL,
  "items" JSONB DEFAULT '[]'::jsonb NOT NULL,
  "total_amount" NUMERIC DEFAULT 0,
  "delivery_status" VARCHAR(50) DEFAULT 'PENDING'::character varying,
  "payment_status" VARCHAR(50) DEFAULT 'UNPAID'::character varying,
  "invoice_status" VARCHAR(50) DEFAULT 'PENDING_INVOICE'::character varying,
  "invoice_no" VARCHAR(100),
  "invoice_date" DATE,
  "invoice_files" JSONB DEFAULT '[]'::jsonb,
  "delivery_notes" JSONB DEFAULT '[]'::jsonb,
  "notes" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "is_credit_blocked" BOOLEAN DEFAULT false,
  "credit_block_reason" TEXT,
  "credit_override_by" VARCHAR(100),
  "credit_override_at" TIMESTAMP WITHOUT TIME ZONE,
  "credit_override_reason" TEXT,
  "price_approval_status" VARCHAR(50) DEFAULT 'APPROVED'::character varying,
  "has_zero_price_items" BOOLEAN DEFAULT false,
  "price_approval_notes" TEXT,
  "applied_price_policy" VARCHAR(50) DEFAULT 'STANDARD'::character varying,
  "vat_requested" BOOLEAN DEFAULT false,
  "vat_company_name" VARCHAR(255),
  "vat_tax_code" VARCHAR(100),
  "vat_address" TEXT,
  "vat_email" VARCHAR(255),
  "shipping_method" VARCHAR(100),
  "tracking_code" VARCHAR(100),
  "invoiced_delivery_slips" JSONB DEFAULT '[]'::jsonb,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_plans" (
  "id" SERIAL,
  "week_number" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "employee_code" VARCHAR(50),
  "employee_name" VARCHAR(150),
  "plan_data" JSONB DEFAULT '{}'::jsonb NOT NULL,
  "status" VARCHAR(50) DEFAULT 'DRAFT'::character varying,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_quotations" (
  "id" SERIAL,
  "quote_code" VARCHAR(50) NOT NULL,
  "customer_id" INTEGER,
  "customer_name" VARCHAR(255) NOT NULL,
  "sales_rep_name" VARCHAR(150),
  "date" DATE NOT NULL,
  "valid_until" DATE,
  "items" JSONB DEFAULT '[]'::jsonb NOT NULL,
  "subtotal" NUMERIC DEFAULT 0,
  "discount_rate" NUMERIC DEFAULT 0,
  "discount_amount" NUMERIC DEFAULT 0,
  "tax_rate" NUMERIC DEFAULT 8,
  "tax_amount" NUMERIC DEFAULT 0,
  "total_amount" NUMERIC DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'DRAFT'::character varying,
  "terms" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_targets" (
  "id" SERIAL,
  "period_type" VARCHAR(20) DEFAULT 'MONTH'::character varying,
  "period_value" VARCHAR(20) NOT NULL,
  "employee_code" VARCHAR(50),
  "employee_name" VARCHAR(150),
  "target_revenue" NUMERIC DEFAULT 0,
  "notes" TEXT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_tasks" (
  "id" SERIAL,
  "task_code" VARCHAR(50),
  "title" VARCHAR(255) NOT NULL,
  "assignee_code" VARCHAR(50),
  "assignee_name" VARCHAR(150),
  "customer_name" VARCHAR(255),
  "priority" VARCHAR(50) DEFAULT 'MEDIUM'::character varying,
  "status" VARCHAR(50) DEFAULT 'TODO'::character varying,
  "deadline" DATE,
  "description" TEXT,
  "logs" JSONB DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_reservations" (
  "id" SERIAL,
  "reservation_code" VARCHAR(50),
  "customer_name" VARCHAR(150),
  "sales_rep_name" VARCHAR(100),
  "items" JSONB,
  "expires_at" TIMESTAMP WITH TIME ZONE,
  "status" VARCHAR(30) DEFAULT 'ACTIVE'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" SERIAL,
  "username" VARCHAR(50) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "full_name" VARCHAR(150) NOT NULL,
  "role" VARCHAR(50) NOT NULL,
  "department" VARCHAR(100) NOT NULL,
  "email" VARCHAR(150),
  "avatar" VARCHAR(255),
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "permissions" JSONB DEFAULT '{}'::jsonb,
  "last_seen_at" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_requests" (
  "id" SERIAL,
  "workflow_code" VARCHAR(50) NOT NULL,
  "workflow_type" VARCHAR(50) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "priority" VARCHAR(20) DEFAULT 'MEDIUM'::character varying,
  "status" VARCHAR(30) DEFAULT 'PENDING'::character varying,
  "requester_name" VARCHAR(100),
  "requester_dept" VARCHAR(100),
  "assignee_name" VARCHAR(100),
  "target_dept" VARCHAR(100),
  "customer_name" VARCHAR(255),
  "product_info" VARCHAR(255),
  "due_date" DATE,
  "description" TEXT,
  "results_summary" TEXT,
  "attachments" JSONB DEFAULT '[]'::jsonb,
  "comments" JSONB DEFAULT '[]'::jsonb,
  "logs" JSONB DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "steps" JSONB DEFAULT '[]'::jsonb,
  "current_step_index" INTEGER DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_templates" (
  "id" SERIAL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "source_dept" VARCHAR(100) NOT NULL,
  "target_dept" VARCHAR(100) NOT NULL,
  "icon" VARCHAR(50) DEFAULT 'ArrowRight'::character varying,
  "description" TEXT,
  "sla_days" INTEGER DEFAULT 3,
  "steps" JSONB DEFAULT '[]'::jsonb,
  "is_active" BOOLEAN DEFAULT true,
  "created_by" VARCHAR(100),
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "zalo_config" (
  "id" SERIAL,
  "oa_id" VARCHAR(100) DEFAULT ''::character varying,
  "oa_name" VARCHAR(150) DEFAULT 'Công Ty TNHH Thiết Bị & Hóa Chất ABT (Zalo OA Doanh Nghiệp)'::character varying,
  "app_id" VARCHAR(100) DEFAULT ''::character varying,
  "secret_key" VARCHAR(150) DEFAULT ''::character varying,
  "access_token" TEXT DEFAULT ''::text,
  "refresh_token" TEXT DEFAULT ''::text,
  "webhook_verify_token" VARCHAR(100) DEFAULT ''::character varying,
  "director_discount_threshold" NUMERIC DEFAULT 10.00,
  "director_phone" VARCHAR(20) DEFAULT ''::character varying,
  "director_zalo_id" VARCHAR(100) DEFAULT ''::character varying,
  "is_active" BOOLEAN DEFAULT true,
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "zalo_message_logs" (
  "id" SERIAL,
  "zalo_user_id" VARCHAR(100) NOT NULL,
  "sender_name" VARCHAR(150),
  "direction" VARCHAR(15) NOT NULL,
  "message_type" VARCHAR(30) NOT NULL,
  "content" TEXT,
  "intent_detected" VARCHAR(50),
  "payload" JSONB,
  "status" VARCHAR(20) DEFAULT 'SUCCESS'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "zalo_user_bindings" (
  "id" SERIAL,
  "zalo_user_id" VARCHAR(100),
  "phone_number" VARCHAR(20),
  "display_name" VARCHAR(150) NOT NULL,
  "user_type" VARCHAR(30) DEFAULT 'EMPLOYEE'::character varying NOT NULL,
  "employee_id" VARCHAR(50),
  "department" VARCHAR(100),
  "role" VARCHAR(50) DEFAULT 'STAFF'::character varying,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "personnel_id" INTEGER,
  "position" VARCHAR(150),
  "connection_status" VARCHAR(40) DEFAULT 'NO_PHONE'::character varying,
  "notes" TEXT,
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

