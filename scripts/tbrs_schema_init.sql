--
-- PostgreSQL database dump
--


-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0; (chỉ có từ PostgreSQL 17)
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_storage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_storage (
    key character varying(255) NOT NULL,
    data jsonb,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    version integer DEFAULT 1
);


--
-- Name: application_daily_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_daily_logs (
    id integer NOT NULL,
    log_date date NOT NULL,
    employee_name character varying(150),
    content text,
    result text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: application_daily_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_daily_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_daily_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_daily_logs_id_seq OWNED BY public.application_daily_logs.id;


--
-- Name: application_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_issues (
    id integer NOT NULL,
    ticket_code character varying(50) NOT NULL,
    customer_name character varying(255) NOT NULL,
    device_name character varying(255),
    issue_description text NOT NULL,
    severity character varying(50) DEFAULT 'MEDIUM'::character varying,
    status character varying(50) DEFAULT 'OPEN'::character varying,
    assigned_technician character varying(150),
    resolution_steps text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: application_issues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_issues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_issues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_issues_id_seq OWNED BY public.application_issues.id;


--
-- Name: application_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_plans (
    id integer NOT NULL,
    week_number integer NOT NULL,
    year integer NOT NULL,
    employee_name character varying(150),
    plan_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(50) DEFAULT 'DRAFT'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: application_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_plans_id_seq OWNED BY public.application_plans.id;


--
-- Name: application_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_resources (
    id integer NOT NULL,
    resource_code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'AVAILABLE'::character varying,
    current_location character varying(255),
    assigned_to character varying(150),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: application_resources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_resources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_resources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_resources_id_seq OWNED BY public.application_resources.id;


--
-- Name: application_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_tasks (
    id integer NOT NULL,
    task_code character varying(50),
    title character varying(255) NOT NULL,
    assignee_name character varying(150),
    customer_name character varying(255),
    task_type character varying(100) DEFAULT 'Demo máy / Chạy thử nghiệm'::character varying,
    priority character varying(50) DEFAULT 'MEDIUM'::character varying,
    status character varying(50) DEFAULT 'TODO'::character varying,
    deadline date,
    description text,
    logs jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: application_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_tasks_id_seq OWNED BY public.application_tasks.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    action character varying(100) NOT NULL,
    module character varying(100) NOT NULL,
    details text,
    actor_username character varying(100),
    actor_name character varying(150),
    ip_address character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: chat_channel_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_channel_reads (
    channel_id integer NOT NULL,
    user_name character varying(150) NOT NULL,
    last_read_message_id integer DEFAULT 0 NOT NULL,
    last_read_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: chat_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_channels (
    id integer NOT NULL,
    channel_code character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    channel_type character varying(50) DEFAULT 'CHANNEL'::character varying,
    department character varying(100),
    description text,
    is_private boolean DEFAULT false,
    created_by character varying(100),
    members jsonb DEFAULT '[]'::jsonb,
    pinned_messages jsonb DEFAULT '[]'::jsonb,
    last_message_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: chat_channels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_channels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_channels_id_seq OWNED BY public.chat_channels.id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    channel_id integer,
    channel_code character varying(100),
    sender_id character varying(100),
    sender_name character varying(100) NOT NULL,
    sender_avatar character varying(255),
    sender_role character varying(100),
    sender_dept character varying(100),
    content text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb,
    related_work jsonb,
    reactions jsonb DEFAULT '{}'::jsonb,
    is_pinned boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reply_to jsonb
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: company_daily_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_daily_logs (
    id integer NOT NULL,
    log_date date DEFAULT CURRENT_DATE NOT NULL,
    department character varying(100) NOT NULL,
    employee_name character varying(100) NOT NULL,
    work_content text NOT NULL,
    result text,
    issues text,
    next_day_plan text,
    related_task_code character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    plan_items jsonb DEFAULT '[]'::jsonb,
    manager_feedback text,
    manager_name character varying(255),
    manager_feedback_at timestamp without time zone,
    staff_feedback text,
    staff_feedback_at timestamp without time zone,
    performance_rating character varying(50),
    work_hours numeric DEFAULT 8,
    proportionality_score character varying(100)
);


--
-- Name: company_daily_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_daily_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_daily_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_daily_logs_id_seq OWNED BY public.company_daily_logs.id;


--
-- Name: company_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_tasks (
    id integer NOT NULL,
    task_code character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    department character varying(100) NOT NULL,
    task_category character varying(100) NOT NULL,
    assignee_name character varying(100),
    customer_name character varying(255),
    priority character varying(20) DEFAULT 'MEDIUM'::character varying,
    status character varying(30) DEFAULT 'TODO'::character varying,
    deadline date,
    description text,
    related_workflow_code character varying(50),
    logs jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    result text,
    attachments jsonb DEFAULT '[]'::jsonb
);


--
-- Name: company_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_tasks_id_seq OWNED BY public.company_tasks.id;


--
-- Name: customer_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_contacts (
    id integer NOT NULL,
    customer_code character varying(100) NOT NULL,
    customer_id integer,
    name character varying(255) NOT NULL,
    "position" character varying(150),
    department character varying(150),
    phone character varying(50),
    email character varying(150),
    role_type character varying(100) DEFAULT 'Kỹ thuật / Quyết định mua'::character varying,
    is_primary boolean DEFAULT false,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: customer_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_contacts_id_seq OWNED BY public.customer_contacts.id;


--
-- Name: customer_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_feedback (
    id integer NOT NULL,
    customer_name character varying(255) NOT NULL,
    customer_phone character varying(50),
    organization character varying(255),
    order_code character varying(100),
    nps_score integer,
    csat_cold_chain integer,
    csat_delivery integer,
    csat_product integer,
    csat_support integer,
    comments text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: customer_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_feedback_id_seq OWNED BY public.customer_feedback.id;


--
-- Name: customer_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_incidents (
    id integer NOT NULL,
    incident_code character varying(100) NOT NULL,
    customer_name character varying(255) NOT NULL,
    customer_phone character varying(50),
    customer_email character varying(255),
    organization character varying(255),
    order_code character varying(100),
    product_code character varying(100),
    product_name character varying(255),
    lot_number character varying(100),
    incident_category character varying(100) NOT NULL,
    severity character varying(50) DEFAULT 'MEDIUM'::character varying,
    patient_impact character varying(100),
    instrument_model character varying(100),
    affected_tests integer DEFAULT 1,
    description text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb,
    status character varying(50) DEFAULT 'RECEIVED'::character varying,
    capa_action text,
    assigned_to character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    root_cause_data jsonb DEFAULT '{}'::jsonb,
    incident_categories jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    current_step character varying(50) DEFAULT 'Step1'::character varying,
    resolution_status character varying(50) DEFAULT 'Investigating'::character varying,
    root_cause_conclusion text,
    final_customer_solution text,
    corrective_actions text,
    preventive_actions text,
    not_real_issue_reason text,
    investigation_details jsonb DEFAULT '{}'::jsonb,
    handled_by character varying(100)
);


--
-- Name: customer_incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_incidents_id_seq OWNED BY public.customer_incidents.id;


--
-- Name: document_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_sequences (
    doc_type character varying(30) NOT NULL,
    prefix character varying(50) NOT NULL,
    current_seq integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id integer NOT NULL,
    product_id integer,
    product_code character varying(50) NOT NULL,
    product_name character varying(255) NOT NULL,
    quantity_on_hand integer DEFAULT 0,
    quantity_allocated integer DEFAULT 0,
    warehouse_location character varying(100) DEFAULT 'Kho TBR Trung Tâm'::character varying,
    shelf_position character varying(100),
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    lot_number character varying(100),
    expiry_date character varying(50),
    is_quarantined boolean DEFAULT false,
    quarantine_reason text,
    components jsonb DEFAULT '[]'::jsonb,
    quantity_reserved integer DEFAULT 0,
    quantity_available integer DEFAULT 0,
    CONSTRAINT inventory_items_allocated_nonneg CHECK ((quantity_allocated >= 0)),
    CONSTRAINT inventory_items_on_hand_nonneg CHECK ((quantity_on_hand >= 0))
);


--
-- Name: inventory_items_backup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items_backup (
    id integer,
    product_id integer,
    product_code character varying(50),
    product_name character varying(255),
    quantity_on_hand integer,
    quantity_allocated integer,
    warehouse_location character varying(100),
    shelf_position character varying(100),
    last_updated timestamp without time zone,
    lot_number character varying(100),
    expiry_date character varying(50),
    is_quarantined boolean,
    quarantine_reason text
);


--
-- Name: inventory_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_items_id_seq OWNED BY public.inventory_items.id;


--
-- Name: inventory_lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_lots (
    id integer NOT NULL,
    product_code character varying(100) NOT NULL,
    lot_number character varying(100) DEFAULT 'NO-LOT'::character varying NOT NULL,
    expiry_date character varying(50),
    warehouse_location character varying(100) DEFAULT 'Kho Trung Tâm'::character varying NOT NULL,
    quantity_on_hand integer DEFAULT 0 NOT NULL,
    is_quarantined boolean DEFAULT false NOT NULL,
    quarantine_reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT inventory_lots_quantity_on_hand_check CHECK ((quantity_on_hand >= 0))
);


--
-- Name: inventory_lots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_lots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_lots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_lots_id_seq OWNED BY public.inventory_lots.id;


--
-- Name: inventory_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_reservations (
    id integer NOT NULL,
    order_code character varying(100),
    customer_name character varying(255),
    sales_rep_name character varying(100),
    product_code character varying(100),
    product_name character varying(255),
    lot_number character varying(100),
    quantity_reserved integer DEFAULT 1,
    reserved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    hold_until_date date,
    status character varying(50) DEFAULT 'ACTIVE'::character varying,
    notes text
);


--
-- Name: inventory_reservations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_reservations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_reservations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_reservations_id_seq OWNED BY public.inventory_reservations.id;


--
-- Name: inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transactions (
    id integer NOT NULL,
    transaction_code character varying(120) NOT NULL,
    transaction_type character varying(50) NOT NULL,
    reference_code character varying(100),
    date date NOT NULL,
    performed_by character varying(150),
    warehouse_name character varying(100) DEFAULT 'Kho TBR Trung Tâm'::character varying,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inventory_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_transactions_id_seq OWNED BY public.inventory_transactions.id;


--
-- Name: lot_recalls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lot_recalls (
    id integer NOT NULL,
    recall_code character varying(100) NOT NULL,
    product_code character varying(100) NOT NULL,
    product_name character varying(255),
    lot_number character varying(100) NOT NULL,
    reason text NOT NULL,
    severity character varying(50) DEFAULT 'HIGH'::character varying,
    status character varying(50) DEFAULT 'ACTIVE'::character varying,
    quarantine_stock boolean DEFAULT true,
    affected_orders jsonb DEFAULT '[]'::jsonb,
    action_taken text,
    reported_by character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: lot_recalls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lot_recalls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lot_recalls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lot_recalls_id_seq OWNED BY public.lot_recalls.id;


--
-- Name: personnel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personnel (
    id integer NOT NULL,
    employee_code character varying(50) NOT NULL,
    full_name character varying(150) NOT NULL,
    department character varying(100) NOT NULL,
    "position" character varying(100) NOT NULL,
    email character varying(150),
    phone character varying(50),
    status character varying(50) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: personnel_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.personnel_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: personnel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.personnel_id_seq OWNED BY public.personnel.id;


--
-- Name: procurement_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_orders (
    id integer NOT NULL,
    po_code character varying(50) NOT NULL,
    supplier_id integer,
    supplier_name character varying(255) NOT NULL,
    order_date date NOT NULL,
    expected_delivery_date date,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_amount numeric(15,2) DEFAULT 0,
    amount_paid numeric(15,2) DEFAULT 0,
    status character varying(50) DEFAULT 'PENDING'::character varying,
    inbound_transaction_code character varying(120),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    version integer DEFAULT 0 NOT NULL,
    received_qty jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: procurement_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_orders_id_seq OWNED BY public.procurement_orders.id;


--
-- Name: procurement_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_payments (
    id integer NOT NULL,
    po_id integer NOT NULL,
    request_id character varying(64) NOT NULL,
    amount numeric(18,2) NOT NULL,
    method character varying(100),
    reference_doc character varying(150),
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_by character varying(150),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT procurement_payments_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: procurement_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_payments_id_seq OWNED BY public.procurement_payments.id;


--
-- Name: procurement_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_suppliers (
    id integer NOT NULL,
    supplier_code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    contact_person character varying(150),
    phone character varying(50),
    email character varying(150),
    address text,
    product_lines text,
    payment_terms character varying(100) DEFAULT '30 ngày'::character varying,
    rating integer DEFAULT 5,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    short_name character varying(100)
);


--
-- Name: procurement_suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_suppliers_id_seq OWNED BY public.procurement_suppliers.id;


--
-- Name: product_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_components (
    id integer NOT NULL,
    parent_product_code character varying(100) NOT NULL,
    component_code character varying(100) NOT NULL,
    component_name character varying(255) NOT NULL,
    specification character varying(255),
    unit character varying(50) DEFAULT 'Cái'::character varying,
    quantity_per_kit numeric(10,2) DEFAULT 1,
    tracking_type character varying(50) DEFAULT 'LOT'::character varying,
    storage_condition character varying(100) DEFAULT '15-25°C'::character varying,
    is_mandatory boolean DEFAULT true,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: product_components_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_components_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_components_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_components_id_seq OWNED BY public.product_components.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    unit character varying(50) NOT NULL,
    specification character varying(255),
    standard_price numeric(15,2) DEFAULT 0,
    cost_price numeric(15,2) DEFAULT 0,
    manufacturer character varying(150),
    origin character varying(100),
    min_stock_level integer DEFAULT 10,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    storage_condition character varying(255)
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: rma_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rma_returns (
    id integer NOT NULL,
    rma_code character varying(100) NOT NULL,
    order_code character varying(100),
    customer_id integer,
    customer_name character varying(255) NOT NULL,
    items jsonb DEFAULT '[]'::jsonb,
    total_amount numeric DEFAULT 0,
    reason_category character varying(100),
    status character varying(50) DEFAULT 'PENDING_APPROVAL'::character varying,
    restock_action character varying(50) DEFAULT 'RESTOCK'::character varying,
    refund_type character varying(50) DEFAULT 'CREDIT_OFFSET'::character varying,
    approved_by character varying(100),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: rma_returns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rma_returns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rma_returns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rma_returns_id_seq OWNED BY public.rma_returns.id;


--
-- Name: sales_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_contracts (
    id integer NOT NULL,
    contract_code character varying(100) NOT NULL,
    customer_id integer,
    customer_name character varying(255) NOT NULL,
    sales_rep_name character varying(100),
    title character varying(255),
    sign_date date DEFAULT CURRENT_DATE,
    valid_until date,
    total_value numeric DEFAULT 0,
    status character varying(50) DEFAULT 'ACTIVE'::character varying,
    notes text,
    contract_files jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    items jsonb DEFAULT '[]'::jsonb
);


--
-- Name: sales_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_contracts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_contracts_id_seq OWNED BY public.sales_contracts.id;


--
-- Name: sales_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_customers (
    id integer NOT NULL,
    customer_code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    contact_person character varying(150),
    contact_position character varying(100),
    phone character varying(50),
    email character varying(150),
    address text,
    tax_code character varying(50),
    sales_rep_id character varying(50),
    sales_rep_name character varying(150),
    classification character varying(50) DEFAULT 'Khách hàng trực tiếp'::character varying,
    payment_terms character varying(100) DEFAULT 'Thanh toán 30 ngày'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    credit_limit numeric DEFAULT 100000000,
    credit_term_days integer DEFAULT 30,
    customer_type character varying(50) DEFAULT 'END_USER'::character varying,
    special_price_list jsonb DEFAULT '[]'::jsonb,
    contract_files jsonb DEFAULT '[]'::jsonb,
    contacts jsonb DEFAULT '[]'::jsonb,
    region character varying(50),
    province character varying(100),
    industry character varying(255)
);


--
-- Name: sales_customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_customers_id_seq OWNED BY public.sales_customers.id;


--
-- Name: sales_daily_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_daily_logs (
    id integer NOT NULL,
    log_date date NOT NULL,
    employee_code character varying(50),
    employee_name character varying(150),
    work_content text,
    result text,
    issues text,
    next_day_plan text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sales_daily_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_daily_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_daily_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_daily_logs_id_seq OWNED BY public.sales_daily_logs.id;


--
-- Name: sales_delivery_slips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_delivery_slips (
    id integer NOT NULL,
    slip_code character varying(100) NOT NULL,
    order_id character varying(100),
    order_code character varying(100),
    customer_name character varying(255),
    customer_address text,
    customer_phone character varying(50),
    customer_contact character varying(150),
    delivery_date character varying(50),
    timeliness character varying(100),
    dispatch_location character varying(255),
    dispatcher_name character varying(150),
    dispatcher_phone character varying(50),
    creator_name character varying(150),
    notes text,
    items jsonb DEFAULT '[]'::jsonb,
    invoice_number character varying(100),
    invoice_date character varying(50),
    status character varying(50) DEFAULT 'COMPLETED'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    extra_data jsonb DEFAULT '{}'::jsonb
);


--
-- Name: sales_delivery_slips_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_delivery_slips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_delivery_slips_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_delivery_slips_id_seq OWNED BY public.sales_delivery_slips.id;


--
-- Name: sales_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_orders (
    id integer NOT NULL,
    order_code character varying(50) NOT NULL,
    customer_id integer,
    customer_name character varying(255) NOT NULL,
    sales_rep_name character varying(150),
    order_date date NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_amount numeric(15,2) DEFAULT 0,
    delivery_status character varying(50) DEFAULT 'PENDING'::character varying,
    payment_status character varying(50) DEFAULT 'UNPAID'::character varying,
    invoice_status character varying(50) DEFAULT 'PENDING_INVOICE'::character varying,
    invoice_no character varying(100),
    invoice_date date,
    invoice_files jsonb DEFAULT '[]'::jsonb,
    delivery_notes jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_credit_blocked boolean DEFAULT false,
    credit_block_reason text,
    credit_override_by character varying(100),
    credit_override_at timestamp without time zone,
    credit_override_reason text,
    price_approval_status character varying(50) DEFAULT 'APPROVED'::character varying,
    has_zero_price_items boolean DEFAULT false,
    price_approval_notes text,
    applied_price_policy character varying(50) DEFAULT 'STANDARD'::character varying,
    vat_requested boolean DEFAULT false,
    vat_company_name character varying(255),
    vat_tax_code character varying(100),
    vat_address text,
    vat_email character varying(255),
    shipping_method character varying(100),
    tracking_code character varying(100),
    invoiced_delivery_slips jsonb DEFAULT '[]'::jsonb,
    approval_status character varying(20),
    approved_by character varying(150),
    approved_at timestamp without time zone,
    approval_note text,
    pr_code character varying(100),
    procure_status character varying(50),
    procure_order_code character varying(100),
    fulfillment_source character varying(50),
    sales_rep_id character varying(50),
    delivered_at date
);


--
-- Name: sales_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_orders_id_seq OWNED BY public.sales_orders.id;


--
-- Name: sales_orders_duplicates_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_orders_duplicates_archive (
    id integer DEFAULT nextval('public.sales_orders_id_seq'::regclass) CONSTRAINT sales_orders_id_not_null NOT NULL,
    order_code character varying(50) CONSTRAINT sales_orders_order_code_not_null NOT NULL,
    customer_id integer,
    customer_name character varying(255) CONSTRAINT sales_orders_customer_name_not_null NOT NULL,
    sales_rep_name character varying(150),
    order_date date CONSTRAINT sales_orders_order_date_not_null NOT NULL,
    items jsonb DEFAULT '[]'::jsonb CONSTRAINT sales_orders_items_not_null NOT NULL,
    total_amount numeric(15,2) DEFAULT 0,
    delivery_status character varying(50) DEFAULT 'PENDING'::character varying,
    payment_status character varying(50) DEFAULT 'UNPAID'::character varying,
    invoice_status character varying(50) DEFAULT 'PENDING_INVOICE'::character varying,
    invoice_no character varying(100),
    invoice_date date,
    invoice_files jsonb DEFAULT '[]'::jsonb,
    delivery_notes jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_credit_blocked boolean DEFAULT false,
    credit_block_reason text,
    credit_override_by character varying(100),
    credit_override_at timestamp without time zone,
    credit_override_reason text,
    price_approval_status character varying(50) DEFAULT 'APPROVED'::character varying,
    has_zero_price_items boolean DEFAULT false,
    price_approval_notes text,
    applied_price_policy character varying(50) DEFAULT 'STANDARD'::character varying,
    vat_requested boolean DEFAULT false,
    vat_company_name character varying(255),
    vat_tax_code character varying(100),
    vat_address text,
    vat_email character varying(255),
    shipping_method character varying(100),
    tracking_code character varying(100),
    invoiced_delivery_slips jsonb DEFAULT '[]'::jsonb,
    merged_into_id integer,
    archived_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sales_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_plans (
    id integer NOT NULL,
    week_number integer NOT NULL,
    year integer NOT NULL,
    employee_code character varying(50),
    employee_name character varying(150),
    plan_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(50) DEFAULT 'DRAFT'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sales_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_plans_id_seq OWNED BY public.sales_plans.id;


--
-- Name: sales_quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_quotations (
    id integer NOT NULL,
    quote_code character varying(50) NOT NULL,
    customer_id integer,
    customer_name character varying(255) NOT NULL,
    sales_rep_name character varying(150),
    date date NOT NULL,
    valid_until date,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric(15,2) DEFAULT 0,
    discount_rate numeric(5,2) DEFAULT 0,
    discount_amount numeric(15,2) DEFAULT 0,
    tax_rate numeric(5,2) DEFAULT 8,
    tax_amount numeric(15,2) DEFAULT 0,
    total_amount numeric(15,2) DEFAULT 0,
    status character varying(50) DEFAULT 'DRAFT'::character varying,
    terms text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    extra_data jsonb DEFAULT '{}'::jsonb
);


--
-- Name: sales_quotations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_quotations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_quotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_quotations_id_seq OWNED BY public.sales_quotations.id;


--
-- Name: sales_quotations_duplicates_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_quotations_duplicates_archive (
    id integer DEFAULT nextval('public.sales_quotations_id_seq'::regclass) CONSTRAINT sales_quotations_id_not_null NOT NULL,
    quote_code character varying(50) CONSTRAINT sales_quotations_quote_code_not_null NOT NULL,
    customer_id integer,
    customer_name character varying(255) CONSTRAINT sales_quotations_customer_name_not_null NOT NULL,
    sales_rep_name character varying(150),
    date date CONSTRAINT sales_quotations_date_not_null NOT NULL,
    valid_until date,
    items jsonb DEFAULT '[]'::jsonb CONSTRAINT sales_quotations_items_not_null NOT NULL,
    subtotal numeric(15,2) DEFAULT 0,
    discount_rate numeric(5,2) DEFAULT 0,
    discount_amount numeric(15,2) DEFAULT 0,
    tax_rate numeric(5,2) DEFAULT 8,
    tax_amount numeric(15,2) DEFAULT 0,
    total_amount numeric(15,2) DEFAULT 0,
    status character varying(50) DEFAULT 'DRAFT'::character varying,
    terms text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    extra_data jsonb DEFAULT '{}'::jsonb,
    merged_into_id integer
);


--
-- Name: sales_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_targets (
    id integer NOT NULL,
    period_type character varying(20) DEFAULT 'MONTH'::character varying,
    period_value character varying(20) NOT NULL,
    employee_code character varying(50),
    employee_name character varying(150),
    target_revenue numeric(15,2) DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sales_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_targets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_targets_id_seq OWNED BY public.sales_targets.id;


--
-- Name: sales_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_tasks (
    id integer NOT NULL,
    task_code character varying(50),
    title character varying(255) NOT NULL,
    assignee_code character varying(50),
    assignee_name character varying(150),
    customer_name character varying(255),
    priority character varying(50) DEFAULT 'MEDIUM'::character varying,
    status character varying(50) DEFAULT 'TODO'::character varying,
    deadline date,
    description text,
    logs jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sales_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_tasks_id_seq OWNED BY public.sales_tasks.id;


--
-- Name: stock_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_reservations (
    id integer NOT NULL,
    reservation_code character varying(50),
    customer_name character varying(150),
    sales_rep_name character varying(100),
    items jsonb,
    expires_at timestamp with time zone,
    status character varying(30) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: stock_reservations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_reservations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_reservations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_reservations_id_seq OWNED BY public.stock_reservations.id;


--
-- Name: supplier_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_products (
    id integer NOT NULL,
    supplier_id integer NOT NULL,
    product_code character varying(100) NOT NULL,
    product_name character varying(255) NOT NULL,
    specification character varying(255),
    unit character varying(50) DEFAULT 'Cái'::character varying,
    currency character varying(10) DEFAULT 'VND'::character varying,
    purchase_price numeric DEFAULT 0,
    tax_rate numeric DEFAULT 0,
    lead_time_days integer DEFAULT 7,
    min_order_qty integer DEFAULT 1,
    notes text,
    price_history jsonb DEFAULT '[]'::jsonb,
    last_updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: supplier_products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supplier_products_id_seq OWNED BY public.supplier_products.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(150) NOT NULL,
    role character varying(50) NOT NULL,
    department character varying(100) NOT NULL,
    email character varying(150),
    avatar character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    permissions jsonb DEFAULT '{}'::jsonb,
    last_seen_at timestamp with time zone,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    session_version integer DEFAULT 0 NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: workflow_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_requests (
    id integer NOT NULL,
    workflow_code character varying(50) NOT NULL,
    workflow_type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    priority character varying(20) DEFAULT 'MEDIUM'::character varying,
    status character varying(30) DEFAULT 'PENDING'::character varying,
    requester_name character varying(100),
    requester_dept character varying(100),
    assignee_name character varying(100),
    target_dept character varying(100),
    customer_name character varying(255),
    product_info character varying(255),
    due_date date,
    description text,
    results_summary text,
    attachments jsonb DEFAULT '[]'::jsonb,
    comments jsonb DEFAULT '[]'::jsonb,
    logs jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    steps jsonb DEFAULT '[]'::jsonb,
    current_step_index integer DEFAULT 0
);


--
-- Name: workflow_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_requests_id_seq OWNED BY public.workflow_requests.id;


--
-- Name: workflow_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_templates (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    source_dept character varying(100) NOT NULL,
    target_dept character varying(100) NOT NULL,
    icon character varying(50) DEFAULT 'ArrowRight'::character varying,
    description text,
    sla_days integer DEFAULT 3,
    steps jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    created_by character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: workflow_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_templates_id_seq OWNED BY public.workflow_templates.id;


--
-- Name: zalo_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zalo_config (
    id integer NOT NULL,
    oa_id character varying(100) DEFAULT '398247192834719'::character varying,
    oa_name character varying(150) DEFAULT 'Công Ty TNHH Thiết Bị & Hóa Chất TBR (Zalo OA Doanh Nghiệp)'::character varying,
    app_id character varying(100) DEFAULT '482910481920481'::character varying,
    secret_key character varying(150) DEFAULT 'tbr_zalo_sec_89f0293a4bc'::character varying,
    access_token text DEFAULT 'zalo_access_token_demo_valid'::text,
    refresh_token text DEFAULT 'zalo_refresh_token_demo_valid'::text,
    webhook_verify_token character varying(100) DEFAULT 'tbr_webhook_token_2026'::character varying,
    director_discount_threshold numeric(5,2) DEFAULT 10.00,
    director_phone character varying(20) DEFAULT '0903998877'::character varying,
    director_zalo_id character varying(100) DEFAULT 'zalo_dir_bld_01'::character varying,
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: zalo_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zalo_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zalo_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zalo_config_id_seq OWNED BY public.zalo_config.id;


--
-- Name: zalo_message_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zalo_message_logs (
    id integer NOT NULL,
    zalo_user_id character varying(100) NOT NULL,
    sender_name character varying(150),
    direction character varying(15) NOT NULL,
    message_type character varying(30) NOT NULL,
    content text,
    intent_detected character varying(50),
    payload jsonb,
    status character varying(20) DEFAULT 'SUCCESS'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: zalo_message_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zalo_message_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zalo_message_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zalo_message_logs_id_seq OWNED BY public.zalo_message_logs.id;


--
-- Name: zalo_user_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zalo_user_bindings (
    id integer NOT NULL,
    zalo_user_id character varying(100),
    phone_number character varying(20),
    display_name character varying(150) NOT NULL,
    user_type character varying(30) DEFAULT 'EMPLOYEE'::character varying NOT NULL,
    employee_id character varying(50),
    department character varying(100),
    role character varying(50) DEFAULT 'STAFF'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    personnel_id integer,
    "position" character varying(150),
    connection_status character varying(40) DEFAULT 'NO_PHONE'::character varying,
    notes text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    link_code_hash character varying(100),
    link_code_expires timestamp with time zone
);


--
-- Name: zalo_user_bindings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zalo_user_bindings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zalo_user_bindings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zalo_user_bindings_id_seq OWNED BY public.zalo_user_bindings.id;


--
-- Name: application_daily_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_daily_logs ALTER COLUMN id SET DEFAULT nextval('public.application_daily_logs_id_seq'::regclass);


--
-- Name: application_issues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_issues ALTER COLUMN id SET DEFAULT nextval('public.application_issues_id_seq'::regclass);


--
-- Name: application_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_plans ALTER COLUMN id SET DEFAULT nextval('public.application_plans_id_seq'::regclass);


--
-- Name: application_resources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_resources ALTER COLUMN id SET DEFAULT nextval('public.application_resources_id_seq'::regclass);


--
-- Name: application_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_tasks ALTER COLUMN id SET DEFAULT nextval('public.application_tasks_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: chat_channels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels ALTER COLUMN id SET DEFAULT nextval('public.chat_channels_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: company_daily_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_daily_logs ALTER COLUMN id SET DEFAULT nextval('public.company_daily_logs_id_seq'::regclass);


--
-- Name: company_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_tasks ALTER COLUMN id SET DEFAULT nextval('public.company_tasks_id_seq'::regclass);


--
-- Name: customer_contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contacts ALTER COLUMN id SET DEFAULT nextval('public.customer_contacts_id_seq'::regclass);


--
-- Name: customer_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feedback ALTER COLUMN id SET DEFAULT nextval('public.customer_feedback_id_seq'::regclass);


--
-- Name: customer_incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_incidents ALTER COLUMN id SET DEFAULT nextval('public.customer_incidents_id_seq'::regclass);


--
-- Name: inventory_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items ALTER COLUMN id SET DEFAULT nextval('public.inventory_items_id_seq'::regclass);


--
-- Name: inventory_lots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_lots ALTER COLUMN id SET DEFAULT nextval('public.inventory_lots_id_seq'::regclass);


--
-- Name: inventory_reservations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations ALTER COLUMN id SET DEFAULT nextval('public.inventory_reservations_id_seq'::regclass);


--
-- Name: inventory_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions ALTER COLUMN id SET DEFAULT nextval('public.inventory_transactions_id_seq'::regclass);


--
-- Name: lot_recalls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot_recalls ALTER COLUMN id SET DEFAULT nextval('public.lot_recalls_id_seq'::regclass);


--
-- Name: personnel id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personnel ALTER COLUMN id SET DEFAULT nextval('public.personnel_id_seq'::regclass);


--
-- Name: procurement_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders ALTER COLUMN id SET DEFAULT nextval('public.procurement_orders_id_seq'::regclass);


--
-- Name: procurement_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_payments ALTER COLUMN id SET DEFAULT nextval('public.procurement_payments_id_seq'::regclass);


--
-- Name: procurement_suppliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_suppliers ALTER COLUMN id SET DEFAULT nextval('public.procurement_suppliers_id_seq'::regclass);


--
-- Name: product_components id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_components ALTER COLUMN id SET DEFAULT nextval('public.product_components_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: rma_returns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_returns ALTER COLUMN id SET DEFAULT nextval('public.rma_returns_id_seq'::regclass);


--
-- Name: sales_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_contracts ALTER COLUMN id SET DEFAULT nextval('public.sales_contracts_id_seq'::regclass);


--
-- Name: sales_customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_customers ALTER COLUMN id SET DEFAULT nextval('public.sales_customers_id_seq'::regclass);


--
-- Name: sales_daily_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_daily_logs ALTER COLUMN id SET DEFAULT nextval('public.sales_daily_logs_id_seq'::regclass);


--
-- Name: sales_delivery_slips id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_delivery_slips ALTER COLUMN id SET DEFAULT nextval('public.sales_delivery_slips_id_seq'::regclass);


--
-- Name: sales_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders ALTER COLUMN id SET DEFAULT nextval('public.sales_orders_id_seq'::regclass);


--
-- Name: sales_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_plans ALTER COLUMN id SET DEFAULT nextval('public.sales_plans_id_seq'::regclass);


--
-- Name: sales_quotations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations ALTER COLUMN id SET DEFAULT nextval('public.sales_quotations_id_seq'::regclass);


--
-- Name: sales_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_targets ALTER COLUMN id SET DEFAULT nextval('public.sales_targets_id_seq'::regclass);


--
-- Name: sales_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_tasks ALTER COLUMN id SET DEFAULT nextval('public.sales_tasks_id_seq'::regclass);


--
-- Name: stock_reservations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_reservations ALTER COLUMN id SET DEFAULT nextval('public.stock_reservations_id_seq'::regclass);


--
-- Name: supplier_products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products ALTER COLUMN id SET DEFAULT nextval('public.supplier_products_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: workflow_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_requests ALTER COLUMN id SET DEFAULT nextval('public.workflow_requests_id_seq'::regclass);


--
-- Name: workflow_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_templates ALTER COLUMN id SET DEFAULT nextval('public.workflow_templates_id_seq'::regclass);


--
-- Name: zalo_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zalo_config ALTER COLUMN id SET DEFAULT nextval('public.zalo_config_id_seq'::regclass);


--
-- Name: zalo_message_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zalo_message_logs ALTER COLUMN id SET DEFAULT nextval('public.zalo_message_logs_id_seq'::regclass);


--
-- Name: zalo_user_bindings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zalo_user_bindings ALTER COLUMN id SET DEFAULT nextval('public.zalo_user_bindings_id_seq'::regclass);


--
-- Name: app_storage app_storage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_storage
    ADD CONSTRAINT app_storage_pkey PRIMARY KEY (key);


--
-- Name: application_daily_logs application_daily_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_daily_logs
    ADD CONSTRAINT application_daily_logs_pkey PRIMARY KEY (id);


--
-- Name: application_issues application_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_issues
    ADD CONSTRAINT application_issues_pkey PRIMARY KEY (id);


--
-- Name: application_issues application_issues_ticket_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_issues
    ADD CONSTRAINT application_issues_ticket_code_key UNIQUE (ticket_code);


--
-- Name: application_plans application_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_plans
    ADD CONSTRAINT application_plans_pkey PRIMARY KEY (id);


--
-- Name: application_resources application_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_resources
    ADD CONSTRAINT application_resources_pkey PRIMARY KEY (id);


--
-- Name: application_resources application_resources_resource_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_resources
    ADD CONSTRAINT application_resources_resource_code_key UNIQUE (resource_code);


--
-- Name: application_tasks application_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_tasks
    ADD CONSTRAINT application_tasks_pkey PRIMARY KEY (id);


--
-- Name: application_tasks application_tasks_task_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_tasks
    ADD CONSTRAINT application_tasks_task_code_key UNIQUE (task_code);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: chat_channel_reads chat_channel_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_reads
    ADD CONSTRAINT chat_channel_reads_pkey PRIMARY KEY (channel_id, user_name);


--
-- Name: chat_channels chat_channels_channel_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_channel_code_key UNIQUE (channel_code);


--
-- Name: chat_channels chat_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: company_daily_logs company_daily_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_daily_logs
    ADD CONSTRAINT company_daily_logs_pkey PRIMARY KEY (id);


--
-- Name: company_tasks company_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_tasks
    ADD CONSTRAINT company_tasks_pkey PRIMARY KEY (id);


--
-- Name: company_tasks company_tasks_task_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_tasks
    ADD CONSTRAINT company_tasks_task_code_key UNIQUE (task_code);


--
-- Name: customer_contacts customer_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contacts
    ADD CONSTRAINT customer_contacts_pkey PRIMARY KEY (id);


--
-- Name: customer_feedback customer_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feedback
    ADD CONSTRAINT customer_feedback_pkey PRIMARY KEY (id);


--
-- Name: customer_incidents customer_incidents_incident_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_incidents
    ADD CONSTRAINT customer_incidents_incident_code_key UNIQUE (incident_code);


--
-- Name: customer_incidents customer_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_incidents
    ADD CONSTRAINT customer_incidents_pkey PRIMARY KEY (id);


--
-- Name: document_sequences document_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_pkey PRIMARY KEY (doc_type, prefix);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_product_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_product_code_key UNIQUE (product_code);


--
-- Name: inventory_lots inventory_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_lots
    ADD CONSTRAINT inventory_lots_pkey PRIMARY KEY (id);


--
-- Name: inventory_lots inventory_lots_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_lots
    ADD CONSTRAINT inventory_lots_unique UNIQUE (product_code, lot_number, warehouse_location);


--
-- Name: inventory_reservations inventory_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);


--
-- Name: inventory_transactions inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id);


--
-- Name: inventory_transactions inventory_transactions_transaction_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_transaction_code_key UNIQUE (transaction_code);


--
-- Name: lot_recalls lot_recalls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot_recalls
    ADD CONSTRAINT lot_recalls_pkey PRIMARY KEY (id);


--
-- Name: lot_recalls lot_recalls_recall_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot_recalls
    ADD CONSTRAINT lot_recalls_recall_code_key UNIQUE (recall_code);


--
-- Name: personnel personnel_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personnel
    ADD CONSTRAINT personnel_employee_code_key UNIQUE (employee_code);


--
-- Name: personnel personnel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personnel
    ADD CONSTRAINT personnel_pkey PRIMARY KEY (id);


--
-- Name: procurement_orders procurement_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders
    ADD CONSTRAINT procurement_orders_pkey PRIMARY KEY (id);


--
-- Name: procurement_orders procurement_orders_po_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders
    ADD CONSTRAINT procurement_orders_po_code_key UNIQUE (po_code);


--
-- Name: procurement_payments procurement_payments_idem; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_payments
    ADD CONSTRAINT procurement_payments_idem UNIQUE (po_id, request_id);


--
-- Name: procurement_payments procurement_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_payments
    ADD CONSTRAINT procurement_payments_pkey PRIMARY KEY (id);


--
-- Name: procurement_suppliers procurement_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_suppliers
    ADD CONSTRAINT procurement_suppliers_pkey PRIMARY KEY (id);


--
-- Name: procurement_suppliers procurement_suppliers_supplier_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_suppliers
    ADD CONSTRAINT procurement_suppliers_supplier_code_key UNIQUE (supplier_code);


--
-- Name: product_components product_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_components
    ADD CONSTRAINT product_components_pkey PRIMARY KEY (id);


--
-- Name: products products_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_code_key UNIQUE (code);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: rma_returns rma_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_returns
    ADD CONSTRAINT rma_returns_pkey PRIMARY KEY (id);


--
-- Name: rma_returns rma_returns_rma_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_returns
    ADD CONSTRAINT rma_returns_rma_code_key UNIQUE (rma_code);


--
-- Name: sales_contracts sales_contracts_contract_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_contracts
    ADD CONSTRAINT sales_contracts_contract_code_key UNIQUE (contract_code);


--
-- Name: sales_contracts sales_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_contracts
    ADD CONSTRAINT sales_contracts_pkey PRIMARY KEY (id);


--
-- Name: sales_customers sales_customers_customer_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_customers
    ADD CONSTRAINT sales_customers_customer_code_key UNIQUE (customer_code);


--
-- Name: sales_customers sales_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_customers
    ADD CONSTRAINT sales_customers_pkey PRIMARY KEY (id);


--
-- Name: sales_daily_logs sales_daily_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_daily_logs
    ADD CONSTRAINT sales_daily_logs_pkey PRIMARY KEY (id);


--
-- Name: sales_delivery_slips sales_delivery_slips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_delivery_slips
    ADD CONSTRAINT sales_delivery_slips_pkey PRIMARY KEY (id);


--
-- Name: sales_delivery_slips sales_delivery_slips_slip_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_delivery_slips
    ADD CONSTRAINT sales_delivery_slips_slip_code_key UNIQUE (slip_code);


--
-- Name: sales_orders sales_orders_order_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_order_code_key UNIQUE (order_code);


--
-- Name: sales_orders sales_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_pkey PRIMARY KEY (id);


--
-- Name: sales_plans sales_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_plans
    ADD CONSTRAINT sales_plans_pkey PRIMARY KEY (id);


--
-- Name: sales_quotations sales_quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_pkey PRIMARY KEY (id);


--
-- Name: sales_quotations sales_quotations_quote_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_quote_code_key UNIQUE (quote_code);


--
-- Name: sales_targets sales_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_targets
    ADD CONSTRAINT sales_targets_pkey PRIMARY KEY (id);


--
-- Name: sales_tasks sales_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_tasks
    ADD CONSTRAINT sales_tasks_pkey PRIMARY KEY (id);


--
-- Name: sales_tasks sales_tasks_task_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_tasks
    ADD CONSTRAINT sales_tasks_task_code_key UNIQUE (task_code);


--
-- Name: stock_reservations stock_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_reservations
    ADD CONSTRAINT stock_reservations_pkey PRIMARY KEY (id);


--
-- Name: stock_reservations stock_reservations_reservation_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_reservations
    ADD CONSTRAINT stock_reservations_reservation_code_key UNIQUE (reservation_code);


--
-- Name: supplier_products supplier_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_pkey PRIMARY KEY (id);


--
-- Name: supplier_products supplier_products_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_unique UNIQUE (supplier_id, product_code);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: workflow_requests workflow_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_requests
    ADD CONSTRAINT workflow_requests_pkey PRIMARY KEY (id);


--
-- Name: workflow_requests workflow_requests_workflow_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_requests
    ADD CONSTRAINT workflow_requests_workflow_code_key UNIQUE (workflow_code);


--
-- Name: workflow_templates workflow_templates_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_templates
    ADD CONSTRAINT workflow_templates_code_key UNIQUE (code);


--
-- Name: workflow_templates workflow_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_templates
    ADD CONSTRAINT workflow_templates_pkey PRIMARY KEY (id);


--
-- Name: zalo_config zalo_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zalo_config
    ADD CONSTRAINT zalo_config_pkey PRIMARY KEY (id);


--
-- Name: zalo_message_logs zalo_message_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zalo_message_logs
    ADD CONSTRAINT zalo_message_logs_pkey PRIMARY KEY (id);


--
-- Name: zalo_user_bindings zalo_user_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zalo_user_bindings
    ADD CONSTRAINT zalo_user_bindings_pkey PRIMARY KEY (id);


--
-- Name: zalo_user_bindings zalo_user_bindings_zalo_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zalo_user_bindings
    ADD CONSTRAINT zalo_user_bindings_zalo_user_id_key UNIQUE (zalo_user_id);


--
-- Name: idx_chat_channel_reads_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_channel_reads_lookup ON public.chat_channel_reads USING btree (channel_id, user_name);


--
-- Name: idx_document_sequences_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_document_sequences_composite ON public.document_sequences USING btree (doc_type, prefix);


--
-- Name: idx_inventory_lots_fefo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_lots_fefo ON public.inventory_lots USING btree (product_code, expiry_date);


--
-- Name: idx_inventory_transactions_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_transactions_reference ON public.inventory_transactions USING btree (reference_code);


--
-- Name: idx_parent_prod_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parent_prod_code ON public.product_components USING btree (parent_product_code);


--
-- Name: idx_procurement_payments_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_payments_po ON public.procurement_payments USING btree (po_id);


--
-- Name: idx_sales_quotations_quote_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sales_quotations_quote_code ON public.sales_quotations USING btree (quote_code);


--
-- Name: idx_supplier_products_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_products_code ON public.supplier_products USING btree (product_code);


--
-- Name: idx_supplier_products_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_products_supplier ON public.supplier_products USING btree (supplier_id);


--
-- Name: idx_zalo_user_bindings_emp_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_zalo_user_bindings_emp_id ON public.zalo_user_bindings USING btree (employee_id);


--
-- Name: inventory_items_product_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_items_product_code_uidx ON public.inventory_items USING btree (product_code);


--
-- Name: inventory_transactions_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_transactions_code_uidx ON public.inventory_transactions USING btree (transaction_code);


--
-- Name: procurement_orders_po_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX procurement_orders_po_code_uidx ON public.procurement_orders USING btree (po_code);


--
-- Name: procurement_suppliers_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX procurement_suppliers_code_uidx ON public.procurement_suppliers USING btree (supplier_code);


--
-- Name: products_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_code_uidx ON public.products USING btree (code);


--
-- Name: rma_returns_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rma_returns_code_uidx ON public.rma_returns USING btree (rma_code);


--
-- Name: sales_customers_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_customers_code_uidx ON public.sales_customers USING btree (customer_code);


--
-- Name: sales_delivery_slips_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_delivery_slips_code_uidx ON public.sales_delivery_slips USING btree (slip_code);


--
-- Name: sales_orders_order_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_orders_order_code_uidx ON public.sales_orders USING btree (order_code);


--
-- Name: chat_channel_reads chat_channel_reads_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_reads
    ADD CONSTRAINT chat_channel_reads_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;


--
-- Name: inventory_items inventory_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: procurement_orders procurement_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders
    ADD CONSTRAINT procurement_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.procurement_suppliers(id) ON DELETE SET NULL;


--
-- Name: procurement_payments procurement_payments_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_payments
    ADD CONSTRAINT procurement_payments_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.procurement_orders(id) ON DELETE RESTRICT;


--
-- Name: rma_returns rma_returns_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_returns
    ADD CONSTRAINT rma_returns_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.sales_customers(id) ON DELETE SET NULL;


--
-- Name: sales_contracts sales_contracts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_contracts
    ADD CONSTRAINT sales_contracts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.sales_customers(id) ON DELETE SET NULL;


--
-- Name: sales_orders sales_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.sales_customers(id) ON DELETE SET NULL;


--
-- Name: sales_quotations sales_quotations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.sales_customers(id) ON DELETE SET NULL;


--
-- Name: supplier_products supplier_products_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.procurement_suppliers(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


