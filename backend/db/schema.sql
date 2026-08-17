-- ARCNAVE — database + table structure
--
-- Full schema (67 tables, RLS policies, indexes, FKs, role grants),
-- generated via `pg_dump --schema-only` from this project's own live,
-- fully-migrated Postgres 16 instance — reflects every migration in
-- backend/migrations/ up through 1759600000000
-- (department-default-sections), regenerated 2026-07-26 (previously
-- frozen at 1752800000000 for months while ~50 migrations landed —
-- this file had drifted far behind the real schema). Not
-- hand-reconstructed. The
-- `pgmigrations` bookkeeping table is deliberately excluded: it
-- records THIS instance's own migration history, not structure worth
-- importing elsewhere. Sample/test data lives separately in
-- backend/db/seed-test-data.sql — run this file first, that one after.
--
-- HOW TO IMPORT ON ANOTHER SYSTEM
--   1. Create the target database (skip if it already exists):
--        createdb -U <superuser> arcnave
--      or, from psql:
--        CREATE DATABASE arcnave;
--
--   2. Import this file into it:
--        psql -U <superuser> -d arcnave -f backend/db/schema.sql
--
--   This file creates its own prerequisite roles (arcnave_app,
--   arcnave_platform) if they don't already exist — see the DO block
--   below — so it does not depend on this repo's
--   docker/postgres/init/*.sh scripts having run first. If you ARE
--   importing into a fresh instance of this project's own
--   docker-compose.yml, those init scripts already create these roles
--   with the real passwords from .env; this file's own CREATE ROLE
--   calls will just no-op (IF NOT EXISTS-guarded) and leave them alone.
--
--   CHANGE THE PLACEHOLDER PASSWORDS BELOW before using this anywhere
--   other than local, throwaway testing — 'changeme_app_password' /
--   'changeme_platform_password' are not secrets, they're marked
--   placeholders.
--
-- REQUIRES PostgreSQL 13+ (uses the built-in gen_random_uuid(); no
-- pgcrypto/uuid-ossp extension needed on 13+, which is what this
-- project's own docker-compose.yml already runs — postgres:16).
--
-- Includes pg_dump 16's \restrict/\unrestrict guard directives —
-- these are psql-only meta-commands (a dump-replay safety feature),
-- harmless no-ops if this file is fed to `psql`, which is the expected
-- way to run it (see step 2 above). If you're piping this into a
-- non-psql tool, strip the two \restrict/\unrestrict lines first.

-- --- Prerequisite roles (idempotent — safe if they already exist) ---
-- Same least-privilege split this project's own
-- docker/postgres/init/01-app-role.sh / 02-platform-role.sh set up
-- (ADR-015): arcnave_app is the tenant runtime role every RLS policy
-- below is written against; arcnave_platform is the separate,
-- narrower role the Super Admin Portal uses. Neither is a superuser,
-- and neither owns any table (this script's own tables are owned by
-- whichever role runs this file) — RLS's FORCE ROW LEVEL SECURITY
-- only means something for a non-owning, non-superuser role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'arcnave_app') THEN
    CREATE ROLE arcnave_app LOGIN PASSWORD 'changeme_app_password';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'arcnave_platform') THEN
    CREATE ROLE arcnave_platform LOGIN PASSWORD 'changeme_platform_password';
  END IF;
END
$$;

-- --- Schema (generated, see header above) ---
--
-- PostgreSQL database dump
--

\restrict IkmPjOh5VDzhBRRGljEhCsZKyJpRy6SFGFimbnNpFdidcDmS0rNTNoqSJeISGuF

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg12+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: sync_active_hod_department_for_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_active_hod_department_for_user(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE users
      SET active_hod_department_id = CASE
        WHEN users.role = 'hod' AND users.is_active = true THEN staff.department_id
        ELSE NULL
      END
      FROM staff
      WHERE users.id = target_user_id
        AND staff.user_id = users.id;

      UPDATE users
      SET active_hod_department_id = NULL
      WHERE users.id = target_user_id
        AND NOT EXISTS (SELECT 1 FROM staff WHERE staff.user_id = target_user_id);
    END;
    $$;


--
-- Name: sync_active_hod_department_from_staff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_active_hod_department_from_staff() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM sync_active_hod_department_for_user(OLD.user_id);
        RETURN OLD;
      END IF;

      PERFORM sync_active_hod_department_for_user(NEW.user_id);
      IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
        PERFORM sync_active_hod_department_for_user(OLD.user_id);
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: sync_active_hod_department_from_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_active_hod_department_from_users() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM sync_active_hod_department_for_user(NEW.id);
      RETURN NEW;
    END;
    $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    title text NOT NULL,
    event_type text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    description text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.academic_calendar_events FORCE ROW LEVEL SECURITY;


--
-- Name: academic_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_years (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    year_label text NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    start_date date,
    end_date date,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT academic_years_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Active'::text, 'Completed'::text])))
);

ALTER TABLE ONLY public.academic_years FORCE ROW LEVEL SECURITY;


--
-- Name: ai_document_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_document_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    document_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    chunk_text text NOT NULL,
    classification text NOT NULL,
    embedding public.vector(1024) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_document_chunks FORCE ROW LEVEL SECURITY;


--
-- Name: approval_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    workflow_request_id uuid NOT NULL,
    step integer NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.approval_history FORCE ROW LEVEL SECURITY;


--
-- Name: archived_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.archived_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    reason text,
    archived_by_user_id uuid NOT NULL,
    workflow_request_id uuid,
    restore_reason text,
    restored_at timestamp with time zone,
    restored_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.archived_records FORCE ROW LEVEL SECURITY;


--
-- Name: assessment_mark_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_mark_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    assessment_mark_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    proposed_marks_obtained numeric NOT NULL,
    reason text,
    workflow_request_id uuid,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.assessment_mark_corrections FORCE ROW LEVEL SECURITY;


--
-- Name: assessment_marks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_marks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    academic_year text NOT NULL,
    class_id uuid NOT NULL,
    subject text NOT NULL,
    assessment_type_id uuid NOT NULL,
    student_id uuid NOT NULL,
    marks_obtained numeric NOT NULL,
    entered_by_user_id uuid NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.assessment_marks FORCE ROW LEVEL SECURITY;


--
-- Name: assessment_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    name text NOT NULL,
    max_marks numeric,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.assessment_types FORCE ROW LEVEL SECURITY;


--
-- Name: attendance_absence_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_absence_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid NOT NULL,
    class_id uuid NOT NULL,
    consecutive_absent_days integer NOT NULL,
    raised_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_by_user_id uuid,
    closure_remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.attendance_absence_flags FORCE ROW LEVEL SECURITY;


--
-- Name: attendance_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    attendance_session_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    proposed_absent_student_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    proposed_total_students integer NOT NULL,
    reason text,
    workflow_request_id uuid,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.attendance_corrections FORCE ROW LEVEL SECURITY;


--
-- Name: attendance_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_id uuid NOT NULL,
    session_date date NOT NULL,
    hour_index integer NOT NULL,
    marked_by_user_id uuid NOT NULL,
    absent_student_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_students integer NOT NULL,
    locked_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.attendance_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    college_id text NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    position_account_id uuid,
    position_id uuid
);

ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: background_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.background_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    error text,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    job_type text,
    progress integer DEFAULT 0 NOT NULL,
    payload jsonb,
    result jsonb
);

ALTER TABLE ONLY public.background_jobs FORCE ROW LEVEL SECURITY;


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_name text NOT NULL,
    department text,
    semester text,
    timetable_status text DEFAULT 'No Tutor'::text NOT NULL,
    timetable_data jsonb,
    timetable_remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    department_id uuid
);

ALTER TABLE ONLY public.classes FORCE ROW LEVEL SECURITY;


--
-- Name: college_ai_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.college_ai_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    provider text NOT NULL,
    api_key text,
    model text,
    embedding_model text,
    base_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.college_ai_config FORCE ROW LEVEL SECURITY;


--
-- Name: college_notification_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.college_notification_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    channel text NOT NULL,
    provider text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.college_notification_channels FORCE ROW LEVEL SECURITY;


--
-- Name: colleges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.colleges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    name text NOT NULL,
    subdomain text NOT NULL,
    subscription_status text DEFAULT 'trial'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    affiliating_university text,
    year_established integer,
    address text,
    level1_position_title text,
    level3_position_title text,
    storage_tier text,
    provisioning_status text DEFAULT 'provisioning'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    level4_position_title text,
    CONSTRAINT colleges_provisioning_status_check CHECK ((provisioning_status = ANY (ARRAY['provisioning'::text, 'ready'::text, 'active'::text, 'suspended'::text, 'archived'::text, 'cancelled'::text])))
);


--
-- Name: configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configurations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    category text NOT NULL,
    configuration jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.configurations FORCE ROW LEVEL SECURITY;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    name text NOT NULL,
    approved_intake integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    course_duration integer,
    created_at_onboarding boolean DEFAULT false NOT NULL,
    merged_into_department_id uuid,
    default_sections integer
);

ALTER TABLE ONLY public.departments FORCE ROW LEVEL SECURITY;


--
-- Name: document_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.document_categories FORCE ROW LEVEL SECURITY;


--
-- Name: document_type_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_type_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    module text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    ocr_enabled boolean DEFAULT false NOT NULL,
    extraction_field_targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid,
    doc_type text NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    file_size_bytes bigint NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    uploaded_by_user_id uuid NOT NULL,
    verified_by_user_id uuid,
    verified_at timestamp with time zone,
    remarks text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    class_id uuid,
    title text,
    academic_year_id uuid,
    department_id uuid,
    category_id uuid,
    publication_status text DEFAULT 'Draft'::text NOT NULL,
    document_group_id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    lineage_parent_id uuid,
    content_hash text,
    superseded_at timestamp with time zone,
    archived_at timestamp with time zone
);

ALTER TABLE ONLY public.documents FORCE ROW LEVEL SECURITY;


--
-- Name: exam_timetable_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_timetable_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_id uuid NOT NULL,
    document_id uuid NOT NULL,
    version_number integer NOT NULL,
    is_current_official boolean DEFAULT false NOT NULL,
    published_by_user_id uuid NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.exam_timetable_versions FORCE ROW LEVEL SECURITY;


--
-- Name: faculty_allocation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faculty_allocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_id uuid NOT NULL,
    period_id uuid NOT NULL,
    subject text NOT NULL,
    staff_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.faculty_allocation FORCE ROW LEVEL SECURITY;


--
-- Name: fee_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    fee_payment_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    proposed_status text NOT NULL,
    reason text,
    workflow_request_id uuid,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fee_corrections FORCE ROW LEVEL SECURITY;


--
-- Name: fee_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid NOT NULL,
    status text DEFAULT 'not_paid'::text NOT NULL,
    marked_by_user_id uuid NOT NULL,
    receipt_document_id uuid,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fee_payments FORCE ROW LEVEL SECURITY;


--
-- Name: generated_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    requested_by_user_id uuid NOT NULL,
    report_type text NOT NULL,
    format text NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    document_id uuid,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.generated_reports FORCE ROW LEVEL SECURITY;


--
-- Name: hod_in_charge_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hod_in_charge_appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    department_id uuid NOT NULL,
    faculty_user_id uuid NOT NULL,
    appointed_by_user_id uuid NOT NULL,
    reason text,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hod_in_charge_appointments FORCE ROW LEVEL SECURITY;


--
-- Name: notification_delivery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_delivery (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    notification_id uuid NOT NULL,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    status text NOT NULL,
    error text
);

ALTER TABLE ONLY public.notification_delivery FORCE ROW LEVEL SECURITY;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    channel text NOT NULL,
    to_address text NOT NULL,
    subject text,
    body text NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    origin text NOT NULL,
    drafted_by_user_id uuid NOT NULL,
    workflow_request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;


--
-- Name: ocr_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    document_id uuid NOT NULL,
    extracted_text text NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ocr_results FORCE ROW LEVEL SECURITY;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);

ALTER TABLE ONLY public.password_reset_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone
);


--
-- Name: platform_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_audit_log (
    id bigint NOT NULL,
    actor_admin_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    ip_address text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.platform_audit_log ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.platform_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: platform_college_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_college_stats (
    college_id text NOT NULL,
    active_users_count integer DEFAULT 0 NOT NULL,
    students_count integer DEFAULT 0 NOT NULL,
    staff_count integer DEFAULT 0 NOT NULL,
    background_jobs_ok boolean DEFAULT true NOT NULL,
    jobs_checked_at timestamp with time zone,
    last_sync_status text DEFAULT 'pending'::text NOT NULL,
    last_sync_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    id boolean DEFAULT true NOT NULL,
    platform_name text DEFAULT 'ARCNAVE'::text NOT NULL,
    support_email text,
    default_timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    date_format text DEFAULT 'DD MMM YYYY'::text NOT NULL,
    items_per_page integer DEFAULT 20 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_settings_id_check CHECK (id)
);


--
-- Name: position_account_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_account_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    position_id uuid NOT NULL,
    level integer NOT NULL,
    position_type text,
    email text NOT NULL,
    token_hash text NOT NULL,
    created_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT position_account_invitations_level_check CHECK (((level >= 1) AND (level <= 4)))
);


--
-- Name: position_account_mfa_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_account_mfa_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    position_account_id uuid NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.position_account_mfa_otps FORCE ROW LEVEL SECURITY;


--
-- Name: position_account_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_account_refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    position_account_id uuid NOT NULL,
    token_hash text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);

ALTER TABLE ONLY public.position_account_refresh_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: position_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    position_id uuid NOT NULL,
    official_email text NOT NULL,
    password_hash text NOT NULL,
    mfa_enabled boolean DEFAULT false NOT NULL,
    mfa_secret text,
    recovery_email text,
    recovery_phone text,
    token_version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.position_accounts FORCE ROW LEVEL SECURITY;


--
-- Name: position_class_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_class_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    position_id uuid NOT NULL,
    class_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.position_class_assignments FORCE ROW LEVEL SECURITY;


--
-- Name: position_department_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_department_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    position_id uuid NOT NULL,
    department_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.position_department_assignments FORCE ROW LEVEL SECURITY;


--
-- Name: position_module_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_module_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    position_id uuid NOT NULL,
    module_key text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.position_module_assignments FORCE ROW LEVEL SECURITY;


--
-- Name: position_occupants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_occupants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    position_account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.position_occupants FORCE ROW LEVEL SECURITY;


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    level integer NOT NULL,
    title text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    position_type text,
    CONSTRAINT positions_level_check CHECK (((level >= 1) AND (level <= 4)))
);

ALTER TABLE ONLY public.positions FORCE ROW LEVEL SECURITY;


--
-- Name: principal_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.principal_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL,
    created_by uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);

ALTER TABLE ONLY public.refresh_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: regulations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regulations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    name text NOT NULL,
    description text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.regulations FORCE ROW LEVEL SECURITY;


--
-- Name: scholarship_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scholarship_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid NOT NULL,
    scheme_name text NOT NULL,
    eligible boolean NOT NULL,
    reason text,
    supporting_document_id uuid,
    decided_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.scholarship_decisions FORCE ROW LEVEL SECURITY;


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    user_id uuid NOT NULL,
    staff_code text,
    full_name text NOT NULL,
    gender text,
    dob date,
    phone text,
    department text,
    designation text,
    qualification text,
    has_phd boolean DEFAULT false NOT NULL,
    aicte_id text,
    joined_year integer,
    address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    department_id uuid
);

ALTER TABLE ONLY public.staff FORCE ROW LEVEL SECURITY;


--
-- Name: staff_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    department_id uuid NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: structural_authorization_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.structural_authorization_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    action_type text NOT NULL,
    action_payload jsonb NOT NULL,
    token_hash text NOT NULL,
    status text DEFAULT 'generated'::text NOT NULL,
    generated_by uuid NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    cancelled_at timestamp with time zone,
    redeemed_by uuid,
    redeemed_at timestamp with time zone,
    CONSTRAINT structural_authorization_keys_action_type_check CHECK ((action_type = ANY (ARRAY['l2_configuration'::text, 'affiliation_change'::text, 'add_campus'::text, 'department_merge_rename'::text, 'accreditation_change'::text]))),
    CONSTRAINT structural_authorization_keys_status_check CHECK ((status = ANY (ARRAY['generated'::text, 'cancelled'::text, 'expired'::text, 'redeemed'::text])))
);


--
-- Name: student_admission_draft_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_admission_draft_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    draft_id uuid NOT NULL,
    doc_type text NOT NULL,
    storage_path text,
    file_name text,
    mime_type text,
    uploaded_at timestamp with time zone,
    extraction_status text DEFAULT 'missing'::text NOT NULL,
    detected_doc_type text,
    detection_confidence integer,
    extraction_job_id uuid,
    ocr_engine text,
    ocr_engine_version text,
    ai_model text,
    ai_model_version text,
    prompt_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.student_admission_draft_documents FORCE ROW LEVEL SECURITY;


--
-- Name: student_admission_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_admission_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    created_by_user_id uuid NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    roll_no text,
    full_name text,
    gender text,
    entry_type text,
    emis_number text,
    umis_number text,
    email text,
    phone text,
    parent_name text,
    parent_phone text,
    address text,
    pincode text,
    mark_10th text,
    mark_12th text,
    mark_iti text,
    accommodation text,
    club text,
    internship text,
    career_plan text,
    notes text,
    license_number text,
    bike_number text,
    annual_income numeric,
    class_id uuid,
    regulation_id uuid,
    current_semester integer,
    dob date,
    blood_group text,
    nationality text,
    section text,
    batch text,
    admission_year integer,
    register_number text,
    academic_year_id uuid,
    school_name text,
    school_type text,
    education_board text,
    previous_qualification text,
    passing_year text,
    community text,
    community_cert_number text,
    bank_account_holder_name text,
    bank_name text,
    bank_branch text,
    bank_account_number text,
    bank_ifsc_code text,
    bank_account_type text,
    extra jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.student_admission_drafts FORCE ROW LEVEL SECURITY;


--
-- Name: student_lifecycle_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_lifecycle_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid NOT NULL,
    previous_status text NOT NULL,
    new_status text NOT NULL,
    effective_date date NOT NULL,
    reason text NOT NULL,
    updated_by_user_id uuid NOT NULL,
    workflow_request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.student_lifecycle_events FORCE ROW LEVEL SECURITY;


--
-- Name: student_phone_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_phone_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid NOT NULL,
    target text NOT NULL,
    phone text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.student_phone_otps FORCE ROW LEVEL SECURITY;


--
-- Name: student_transfer_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_transfer_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid NOT NULL,
    permanent_student_id uuid NOT NULL,
    transfer_type text NOT NULL,
    destination_class_id uuid,
    destination_college_id text,
    reason text,
    requested_by_user_id uuid NOT NULL,
    workflow_request_id uuid,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.student_transfer_requests FORCE ROW LEVEL SECURITY;


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    roll_no text NOT NULL,
    full_name text NOT NULL,
    gender text,
    entry_type text,
    emis_number text,
    umis_number text,
    email text,
    phone text,
    phone_verified boolean DEFAULT false NOT NULL,
    parent_name text,
    parent_phone text,
    parent_phone_verified boolean DEFAULT false NOT NULL,
    address text,
    pincode text,
    mark_10th text,
    mark_12th text,
    mark_iti text,
    accommodation text,
    club text,
    internship text,
    career_plan text,
    notes text,
    license_number text,
    bike_number text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    annual_income numeric,
    class_id uuid,
    deleted_at timestamp with time zone,
    regulation_id uuid,
    pending_regulation_id uuid,
    permanent_student_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lifecycle_status text DEFAULT 'Active'::text NOT NULL,
    pending_lifecycle_status text,
    pending_lifecycle_reason text,
    current_semester integer,
    dob date,
    blood_group text,
    nationality text,
    section text,
    batch text,
    admission_year integer,
    register_number text,
    academic_year_id uuid,
    school_name text,
    school_type text,
    education_board text,
    previous_qualification text,
    passing_year text,
    community text,
    community_cert_number text,
    bank_account_holder_name text,
    bank_name text,
    bank_branch text,
    bank_account_number text,
    bank_ifsc_code text,
    bank_account_type text
);

ALTER TABLE ONLY public.students FORCE ROW LEVEL SECURITY;


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    regulation_id uuid NOT NULL,
    subject_code text NOT NULL,
    subject_name text NOT NULL,
    semester integer NOT NULL,
    credits numeric,
    lecture_hours integer,
    tutorial_hours integer,
    practical_hours integer,
    subject_type text,
    prerequisites text,
    source_document_id uuid,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.subjects FORCE ROW LEVEL SECURITY;


--
-- Name: substitute_assignment_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.substitute_assignment_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_id uuid NOT NULL,
    timetable_period_id uuid NOT NULL,
    assignment_date date NOT NULL,
    original_staff_user_id uuid,
    substitute_staff_user_id uuid NOT NULL,
    reason text,
    requested_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.substitute_assignment_requests FORCE ROW LEVEL SECURITY;


--
-- Name: substitute_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.substitute_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_id uuid NOT NULL,
    timetable_period_id uuid NOT NULL,
    assignment_date date NOT NULL,
    original_staff_user_id uuid,
    substitute_staff_user_id uuid NOT NULL,
    assigning_authority_user_id uuid NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.substitute_assignments FORCE ROW LEVEL SECURITY;


--
-- Name: timetable_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    day_of_week text NOT NULL,
    hour_index integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.timetable_periods FORCE ROW LEVEL SECURITY;


--
-- Name: timetable_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_id uuid NOT NULL,
    revision_number integer NOT NULL,
    effective_from date NOT NULL,
    workflow_request_id uuid,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.timetable_revisions FORCE ROW LEVEL SECURITY;


--
-- Name: user_mfa_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_mfa_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    user_id uuid NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_mfa_otps FORCE ROW LEVEL SECURITY;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    activated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    active_hod_department_id uuid,
    mfa_enabled boolean DEFAULT false NOT NULL,
    token_version integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: workflow_delegations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_delegations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    role text NOT NULL,
    department_id uuid,
    delegate_user_id uuid NOT NULL,
    start_date date NOT NULL,
    end_date date,
    reason text,
    delegated_by_user_id uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workflow_delegations FORCE ROW LEVEL SECURITY;


--
-- Name: workflow_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    origin text NOT NULL,
    approver_chain jsonb NOT NULL,
    current_step integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    action_manifest jsonb
);

ALTER TABLE ONLY public.workflow_requests FORCE ROW LEVEL SECURITY;


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: academic_calendar_events academic_calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_calendar_events
    ADD CONSTRAINT academic_calendar_events_pkey PRIMARY KEY (id);


--
-- Name: academic_years academic_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_pkey PRIMARY KEY (id);


--
-- Name: ai_document_chunks ai_document_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_document_chunks
    ADD CONSTRAINT ai_document_chunks_pkey PRIMARY KEY (id);


--
-- Name: approval_history approval_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_history
    ADD CONSTRAINT approval_history_pkey PRIMARY KEY (id);


--
-- Name: archived_records archived_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_records
    ADD CONSTRAINT archived_records_pkey PRIMARY KEY (id);


--
-- Name: assessment_mark_corrections assessment_mark_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_mark_corrections
    ADD CONSTRAINT assessment_mark_corrections_pkey PRIMARY KEY (id);


--
-- Name: assessment_marks assessment_marks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_marks
    ADD CONSTRAINT assessment_marks_pkey PRIMARY KEY (id);


--
-- Name: assessment_types assessment_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_types
    ADD CONSTRAINT assessment_types_pkey PRIMARY KEY (id);


--
-- Name: attendance_absence_flags attendance_absence_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_absence_flags
    ADD CONSTRAINT attendance_absence_flags_pkey PRIMARY KEY (id);


--
-- Name: attendance_corrections attendance_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_pkey PRIMARY KEY (id);


--
-- Name: attendance_sessions attendance_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: background_jobs background_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_jobs
    ADD CONSTRAINT background_jobs_pkey PRIMARY KEY (id);


--
-- Name: classes classes_college_id_class_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_college_id_class_name_key UNIQUE (college_id, class_name);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: college_ai_config college_ai_config_college_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.college_ai_config
    ADD CONSTRAINT college_ai_config_college_id_key UNIQUE (college_id);


--
-- Name: college_ai_config college_ai_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.college_ai_config
    ADD CONSTRAINT college_ai_config_pkey PRIMARY KEY (id);


--
-- Name: college_notification_channels college_notification_channels_college_id_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.college_notification_channels
    ADD CONSTRAINT college_notification_channels_college_id_channel_key UNIQUE (college_id, channel);


--
-- Name: college_notification_channels college_notification_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.college_notification_channels
    ADD CONSTRAINT college_notification_channels_pkey PRIMARY KEY (id);


--
-- Name: colleges colleges_college_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_college_id_key UNIQUE (college_id);


--
-- Name: colleges colleges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_pkey PRIMARY KEY (id);


--
-- Name: colleges colleges_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_subdomain_key UNIQUE (subdomain);


--
-- Name: configurations configurations_college_id_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_college_id_category_key UNIQUE (college_id, category);


--
-- Name: configurations configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_pkey PRIMARY KEY (id);


--
-- Name: departments departments_college_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_college_id_name_key UNIQUE (college_id, name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: document_categories document_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_categories
    ADD CONSTRAINT document_categories_pkey PRIMARY KEY (id);


--
-- Name: document_type_registry document_type_registry_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_type_registry
    ADD CONSTRAINT document_type_registry_key_key UNIQUE (key);


--
-- Name: document_type_registry document_type_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_type_registry
    ADD CONSTRAINT document_type_registry_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: exam_timetable_versions exam_timetable_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_timetable_versions
    ADD CONSTRAINT exam_timetable_versions_pkey PRIMARY KEY (id);


--
-- Name: faculty_allocation faculty_allocation_class_id_period_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_class_id_period_id_key UNIQUE (class_id, period_id);


--
-- Name: faculty_allocation faculty_allocation_period_id_staff_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_period_id_staff_user_id_key UNIQUE (period_id, staff_user_id);


--
-- Name: faculty_allocation faculty_allocation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_pkey PRIMARY KEY (id);


--
-- Name: fee_corrections fee_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_corrections
    ADD CONSTRAINT fee_corrections_pkey PRIMARY KEY (id);


--
-- Name: fee_payments fee_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_pkey PRIMARY KEY (id);


--
-- Name: generated_reports generated_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_pkey PRIMARY KEY (id);


--
-- Name: hod_in_charge_appointments hod_in_charge_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hod_in_charge_appointments
    ADD CONSTRAINT hod_in_charge_appointments_pkey PRIMARY KEY (id);


--
-- Name: notification_delivery notification_delivery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery
    ADD CONSTRAINT notification_delivery_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: ocr_results ocr_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results
    ADD CONSTRAINT ocr_results_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_email_key UNIQUE (email);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_username_key UNIQUE (username);


--
-- Name: platform_audit_log platform_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit_log
    ADD CONSTRAINT platform_audit_log_pkey PRIMARY KEY (id);


--
-- Name: platform_college_stats platform_college_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_college_stats
    ADD CONSTRAINT platform_college_stats_pkey PRIMARY KEY (college_id);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: position_account_invitations position_account_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_invitations
    ADD CONSTRAINT position_account_invitations_pkey PRIMARY KEY (id);


--
-- Name: position_account_invitations position_account_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_invitations
    ADD CONSTRAINT position_account_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: position_account_mfa_otps position_account_mfa_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_mfa_otps
    ADD CONSTRAINT position_account_mfa_otps_pkey PRIMARY KEY (id);


--
-- Name: position_account_refresh_tokens position_account_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_refresh_tokens
    ADD CONSTRAINT position_account_refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: position_accounts position_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_accounts
    ADD CONSTRAINT position_accounts_pkey PRIMARY KEY (id);


--
-- Name: position_accounts position_accounts_position_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_accounts
    ADD CONSTRAINT position_accounts_position_id_key UNIQUE (position_id);


--
-- Name: position_class_assignments position_class_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_class_assignments
    ADD CONSTRAINT position_class_assignments_pkey PRIMARY KEY (id);


--
-- Name: position_department_assignments position_department_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_department_assignments
    ADD CONSTRAINT position_department_assignments_pkey PRIMARY KEY (id);


--
-- Name: position_module_assignments position_module_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_module_assignments
    ADD CONSTRAINT position_module_assignments_pkey PRIMARY KEY (id);


--
-- Name: position_occupants position_occupants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_occupants
    ADD CONSTRAINT position_occupants_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: principal_invitations principal_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_invitations
    ADD CONSTRAINT principal_invitations_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: regulations regulations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulations
    ADD CONSTRAINT regulations_pkey PRIMARY KEY (id);


--
-- Name: scholarship_decisions scholarship_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scholarship_decisions
    ADD CONSTRAINT scholarship_decisions_pkey PRIMARY KEY (id);


--
-- Name: staff staff_college_id_staff_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_college_id_staff_code_key UNIQUE (college_id, staff_code);


--
-- Name: staff_invitations staff_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_pkey PRIMARY KEY (id);


--
-- Name: staff_invitations staff_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: staff staff_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_user_id_key UNIQUE (user_id);


--
-- Name: structural_authorization_keys structural_authorization_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.structural_authorization_keys
    ADD CONSTRAINT structural_authorization_keys_pkey PRIMARY KEY (id);


--
-- Name: student_admission_draft_documents student_admission_draft_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_draft_documents
    ADD CONSTRAINT student_admission_draft_documents_pkey PRIMARY KEY (id);


--
-- Name: student_admission_drafts student_admission_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_drafts
    ADD CONSTRAINT student_admission_drafts_pkey PRIMARY KEY (id);


--
-- Name: student_lifecycle_events student_lifecycle_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lifecycle_events
    ADD CONSTRAINT student_lifecycle_events_pkey PRIMARY KEY (id);


--
-- Name: student_phone_otps student_phone_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_phone_otps
    ADD CONSTRAINT student_phone_otps_pkey PRIMARY KEY (id);


--
-- Name: student_transfer_requests student_transfer_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_transfer_requests
    ADD CONSTRAINT student_transfer_requests_pkey PRIMARY KEY (id);


--
-- Name: students students_college_id_roll_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_college_id_roll_no_key UNIQUE (college_id, roll_no);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: substitute_assignment_requests substitute_assignment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignment_requests
    ADD CONSTRAINT substitute_assignment_requests_pkey PRIMARY KEY (id);


--
-- Name: substitute_assignments substitute_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_pkey PRIMARY KEY (id);


--
-- Name: timetable_periods timetable_periods_college_id_day_of_week_hour_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_college_id_day_of_week_hour_index_key UNIQUE (college_id, day_of_week, hour_index);


--
-- Name: timetable_periods timetable_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_pkey PRIMARY KEY (id);


--
-- Name: timetable_revisions timetable_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_revisions
    ADD CONSTRAINT timetable_revisions_pkey PRIMARY KEY (id);


--
-- Name: user_mfa_otps user_mfa_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_otps
    ADD CONSTRAINT user_mfa_otps_pkey PRIMARY KEY (id);


--
-- Name: users users_college_id_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_college_id_username_key UNIQUE (college_id, username);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workflow_delegations workflow_delegations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_delegations
    ADD CONSTRAINT workflow_delegations_pkey PRIMARY KEY (id);


--
-- Name: workflow_requests workflow_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_requests
    ADD CONSTRAINT workflow_requests_pkey PRIMARY KEY (id);


--
-- Name: academic_calendar_events_college_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX academic_calendar_events_college_start_idx ON public.academic_calendar_events USING btree (college_id, start_date);


--
-- Name: academic_years_college_year_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX academic_years_college_year_label_key ON public.academic_years USING btree (college_id, year_label);


--
-- Name: academic_years_one_active_per_college; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX academic_years_one_active_per_college ON public.academic_years USING btree (college_id) WHERE (status = 'Active'::text);


--
-- Name: ai_document_chunks_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_document_chunks_document_id_idx ON public.ai_document_chunks USING btree (document_id);


--
-- Name: ai_document_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_document_chunks_embedding_idx ON public.ai_document_chunks USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: archived_records_one_active_per_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX archived_records_one_active_per_entity ON public.archived_records USING btree (college_id, entity_type, entity_id) WHERE (restored_at IS NULL);


--
-- Name: assessment_marks_student_assessment_class_subject_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assessment_marks_student_assessment_class_subject_key ON public.assessment_marks USING btree (student_id, assessment_type_id, class_id, subject) WHERE (deleted_at IS NULL);


--
-- Name: assessment_types_college_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assessment_types_college_name_key ON public.assessment_types USING btree (college_id, name);


--
-- Name: attendance_absence_flags_student_outstanding_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attendance_absence_flags_student_outstanding_key ON public.attendance_absence_flags USING btree (student_id) WHERE (closed_at IS NULL);


--
-- Name: attendance_sessions_class_date_hour_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attendance_sessions_class_date_hour_key ON public.attendance_sessions USING btree (class_id, session_date, hour_index) WHERE (deleted_at IS NULL);


--
-- Name: attendance_sessions_class_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_sessions_class_date_idx ON public.attendance_sessions USING btree (class_id, session_date);


--
-- Name: classes_department_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classes_department_id_idx ON public.classes USING btree (department_id);


--
-- Name: document_categories_college_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_categories_college_slug_key ON public.document_categories USING btree (college_id, slug);


--
-- Name: documents_content_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_content_hash_idx ON public.documents USING btree (college_id, content_hash) WHERE ((student_id IS NULL) AND (deleted_at IS NULL) AND (content_hash IS NOT NULL));


--
-- Name: documents_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_group_idx ON public.documents USING btree (document_group_id) WHERE (deleted_at IS NULL);


--
-- Name: documents_institutional_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_institutional_idx ON public.documents USING btree (college_id, academic_year_id, department_id, category_id) WHERE ((student_id IS NULL) AND (deleted_at IS NULL));


--
-- Name: documents_lineage_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_lineage_parent_idx ON public.documents USING btree (lineage_parent_id) WHERE (lineage_parent_id IS NOT NULL);


--
-- Name: documents_student_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_student_type_idx ON public.documents USING btree (student_id, doc_type) WHERE (deleted_at IS NULL);


--
-- Name: exam_timetable_versions_class_version_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_timetable_versions_class_version_key ON public.exam_timetable_versions USING btree (class_id, version_number);


--
-- Name: exam_timetable_versions_one_current_per_class; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_timetable_versions_one_current_per_class ON public.exam_timetable_versions USING btree (class_id) WHERE (is_current_official = true);


--
-- Name: faculty_allocation_class_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faculty_allocation_class_id_idx ON public.faculty_allocation USING btree (class_id);


--
-- Name: faculty_allocation_staff_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faculty_allocation_staff_user_id_idx ON public.faculty_allocation USING btree (staff_user_id);


--
-- Name: fee_payments_student_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fee_payments_student_id_key ON public.fee_payments USING btree (student_id) WHERE (deleted_at IS NULL);


--
-- Name: hod_in_charge_one_active_per_department; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hod_in_charge_one_active_per_department ON public.hod_in_charge_appointments USING btree (college_id, department_id) WHERE (revoked_at IS NULL);


--
-- Name: notification_delivery_notification_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_delivery_notification_id_idx ON public.notification_delivery USING btree (notification_id);


--
-- Name: notifications_workflow_request_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notifications_workflow_request_id_key ON public.notifications USING btree (workflow_request_id) WHERE (workflow_request_id IS NOT NULL);


--
-- Name: position_class_assignments_one_active_per_class; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX position_class_assignments_one_active_per_class ON public.position_class_assignments USING btree (class_id) WHERE (revoked_at IS NULL);


--
-- Name: position_department_assignments_one_active_per_department; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX position_department_assignments_one_active_per_department ON public.position_department_assignments USING btree (department_id) WHERE (revoked_at IS NULL);


--
-- Name: position_module_assignments_one_active_per_college_module; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX position_module_assignments_one_active_per_college_module ON public.position_module_assignments USING btree (college_id, module_key) WHERE (revoked_at IS NULL);


--
-- Name: position_occupants_one_active_per_account; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX position_occupants_one_active_per_account ON public.position_occupants USING btree (position_account_id) WHERE (revoked_at IS NULL);


--
-- Name: regulations_college_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX regulations_college_name_key ON public.regulations USING btree (college_id, name);


--
-- Name: staff_department_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_department_id_idx ON public.staff USING btree (department_id);


--
-- Name: student_admission_draft_documents_draft_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX student_admission_draft_documents_draft_id_idx ON public.student_admission_draft_documents USING btree (draft_id);


--
-- Name: students_class_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX students_class_id_idx ON public.students USING btree (class_id) WHERE (deleted_at IS NULL);


--
-- Name: subjects_regulation_subject_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX subjects_regulation_subject_code_key ON public.subjects USING btree (regulation_id, subject_code) WHERE (deleted_at IS NULL);


--
-- Name: substitute_assignments_class_period_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX substitute_assignments_class_period_date_key ON public.substitute_assignments USING btree (class_id, timetable_period_id, assignment_date);


--
-- Name: timetable_revisions_class_revision_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX timetable_revisions_class_revision_number_key ON public.timetable_revisions USING btree (class_id, revision_number);


--
-- Name: users_one_active_hod_per_department; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_one_active_hod_per_department ON public.users USING btree (college_id, active_hod_department_id) WHERE ((role = 'hod'::text) AND (is_active = true) AND (active_hod_department_id IS NOT NULL));


--
-- Name: users_one_active_principal_per_college; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_one_active_principal_per_college ON public.users USING btree (college_id) WHERE ((role = 'principal'::text) AND (is_active = true));


--
-- Name: workflow_requests_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_requests_entity_idx ON public.workflow_requests USING btree (entity_type, entity_id);


--
-- Name: workflow_requests_entity_pending_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workflow_requests_entity_pending_key ON public.workflow_requests USING btree (college_id, entity_type, entity_id) WHERE (status = 'Pending'::text);


--
-- Name: staff staff_sync_active_hod_department; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER staff_sync_active_hod_department AFTER INSERT OR DELETE OR UPDATE OF user_id, department_id ON public.staff FOR EACH ROW EXECUTE FUNCTION public.sync_active_hod_department_from_staff();


--
-- Name: users users_sync_active_hod_department; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_sync_active_hod_department AFTER INSERT OR UPDATE OF role, is_active ON public.users FOR EACH ROW EXECUTE FUNCTION public.sync_active_hod_department_from_users();


--
-- Name: academic_calendar_events academic_calendar_events_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_calendar_events
    ADD CONSTRAINT academic_calendar_events_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: academic_calendar_events academic_calendar_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_calendar_events
    ADD CONSTRAINT academic_calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: academic_years academic_years_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: academic_years academic_years_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: ai_document_chunks ai_document_chunks_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_document_chunks
    ADD CONSTRAINT ai_document_chunks_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: ai_document_chunks ai_document_chunks_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_document_chunks
    ADD CONSTRAINT ai_document_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: approval_history approval_history_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_history
    ADD CONSTRAINT approval_history_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: approval_history approval_history_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_history
    ADD CONSTRAINT approval_history_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: approval_history approval_history_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_history
    ADD CONSTRAINT approval_history_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: archived_records archived_records_archived_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_records
    ADD CONSTRAINT archived_records_archived_by_user_id_fkey FOREIGN KEY (archived_by_user_id) REFERENCES public.users(id);


--
-- Name: archived_records archived_records_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_records
    ADD CONSTRAINT archived_records_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: archived_records archived_records_restored_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_records
    ADD CONSTRAINT archived_records_restored_by_user_id_fkey FOREIGN KEY (restored_by_user_id) REFERENCES public.users(id);


--
-- Name: archived_records archived_records_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_records
    ADD CONSTRAINT archived_records_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: assessment_mark_corrections assessment_mark_corrections_assessment_mark_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_mark_corrections
    ADD CONSTRAINT assessment_mark_corrections_assessment_mark_id_fkey FOREIGN KEY (assessment_mark_id) REFERENCES public.assessment_marks(id);


--
-- Name: assessment_mark_corrections assessment_mark_corrections_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_mark_corrections
    ADD CONSTRAINT assessment_mark_corrections_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: assessment_mark_corrections assessment_mark_corrections_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_mark_corrections
    ADD CONSTRAINT assessment_mark_corrections_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: assessment_mark_corrections assessment_mark_corrections_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_mark_corrections
    ADD CONSTRAINT assessment_mark_corrections_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: assessment_marks assessment_marks_assessment_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_marks
    ADD CONSTRAINT assessment_marks_assessment_type_id_fkey FOREIGN KEY (assessment_type_id) REFERENCES public.assessment_types(id);


--
-- Name: assessment_marks assessment_marks_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_marks
    ADD CONSTRAINT assessment_marks_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: assessment_marks assessment_marks_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_marks
    ADD CONSTRAINT assessment_marks_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: assessment_marks assessment_marks_entered_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_marks
    ADD CONSTRAINT assessment_marks_entered_by_user_id_fkey FOREIGN KEY (entered_by_user_id) REFERENCES public.users(id);


--
-- Name: assessment_marks assessment_marks_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_marks
    ADD CONSTRAINT assessment_marks_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: assessment_types assessment_types_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_types
    ADD CONSTRAINT assessment_types_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: assessment_types assessment_types_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_types
    ADD CONSTRAINT assessment_types_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: attendance_absence_flags attendance_absence_flags_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_absence_flags
    ADD CONSTRAINT attendance_absence_flags_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: attendance_absence_flags attendance_absence_flags_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_absence_flags
    ADD CONSTRAINT attendance_absence_flags_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id);


--
-- Name: attendance_absence_flags attendance_absence_flags_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_absence_flags
    ADD CONSTRAINT attendance_absence_flags_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: attendance_absence_flags attendance_absence_flags_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_absence_flags
    ADD CONSTRAINT attendance_absence_flags_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: attendance_corrections attendance_corrections_attendance_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_attendance_session_id_fkey FOREIGN KEY (attendance_session_id) REFERENCES public.attendance_sessions(id);


--
-- Name: attendance_corrections attendance_corrections_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: attendance_corrections attendance_corrections_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: attendance_corrections attendance_corrections_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: attendance_sessions attendance_sessions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: attendance_sessions attendance_sessions_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: attendance_sessions attendance_sessions_marked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_marked_by_user_id_fkey FOREIGN KEY (marked_by_user_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: audit_log audit_log_position_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_position_account_id_fkey FOREIGN KEY (position_account_id) REFERENCES public.position_accounts(id);


--
-- Name: audit_log audit_log_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: background_jobs background_jobs_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_jobs
    ADD CONSTRAINT background_jobs_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: background_jobs background_jobs_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_jobs
    ADD CONSTRAINT background_jobs_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: classes classes_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: classes classes_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: college_ai_config college_ai_config_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.college_ai_config
    ADD CONSTRAINT college_ai_config_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: college_notification_channels college_notification_channels_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.college_notification_channels
    ADD CONSTRAINT college_notification_channels_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: colleges colleges_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.platform_admins(id);


--
-- Name: configurations configurations_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: departments departments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: departments departments_merged_into_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_merged_into_department_id_fkey FOREIGN KEY (merged_into_department_id) REFERENCES public.departments(id);


--
-- Name: document_categories document_categories_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_categories
    ADD CONSTRAINT document_categories_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: documents documents_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: documents documents_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.document_categories(id);


--
-- Name: documents documents_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: documents documents_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: documents documents_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: documents documents_lineage_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_lineage_parent_id_fkey FOREIGN KEY (lineage_parent_id) REFERENCES public.documents(id);


--
-- Name: documents documents_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: documents documents_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id);


--
-- Name: documents documents_verified_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES public.users(id);


--
-- Name: exam_timetable_versions exam_timetable_versions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_timetable_versions
    ADD CONSTRAINT exam_timetable_versions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: exam_timetable_versions exam_timetable_versions_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_timetable_versions
    ADD CONSTRAINT exam_timetable_versions_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: exam_timetable_versions exam_timetable_versions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_timetable_versions
    ADD CONSTRAINT exam_timetable_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: exam_timetable_versions exam_timetable_versions_published_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_timetable_versions
    ADD CONSTRAINT exam_timetable_versions_published_by_user_id_fkey FOREIGN KEY (published_by_user_id) REFERENCES public.users(id);


--
-- Name: faculty_allocation faculty_allocation_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: faculty_allocation faculty_allocation_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: faculty_allocation faculty_allocation_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.timetable_periods(id);


--
-- Name: faculty_allocation faculty_allocation_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES public.users(id);


--
-- Name: fee_corrections fee_corrections_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_corrections
    ADD CONSTRAINT fee_corrections_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: fee_corrections fee_corrections_fee_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_corrections
    ADD CONSTRAINT fee_corrections_fee_payment_id_fkey FOREIGN KEY (fee_payment_id) REFERENCES public.fee_payments(id);


--
-- Name: fee_corrections fee_corrections_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_corrections
    ADD CONSTRAINT fee_corrections_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: fee_corrections fee_corrections_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_corrections
    ADD CONSTRAINT fee_corrections_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: fee_payments fee_payments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: fee_payments fee_payments_marked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_marked_by_user_id_fkey FOREIGN KEY (marked_by_user_id) REFERENCES public.users(id);


--
-- Name: fee_payments fee_payments_receipt_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_receipt_document_id_fkey FOREIGN KEY (receipt_document_id) REFERENCES public.documents(id);


--
-- Name: fee_payments fee_payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: generated_reports generated_reports_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: generated_reports generated_reports_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: generated_reports generated_reports_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: hod_in_charge_appointments hod_in_charge_appointments_appointed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hod_in_charge_appointments
    ADD CONSTRAINT hod_in_charge_appointments_appointed_by_user_id_fkey FOREIGN KEY (appointed_by_user_id) REFERENCES public.users(id);


--
-- Name: hod_in_charge_appointments hod_in_charge_appointments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hod_in_charge_appointments
    ADD CONSTRAINT hod_in_charge_appointments_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: hod_in_charge_appointments hod_in_charge_appointments_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hod_in_charge_appointments
    ADD CONSTRAINT hod_in_charge_appointments_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: hod_in_charge_appointments hod_in_charge_appointments_faculty_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hod_in_charge_appointments
    ADD CONSTRAINT hod_in_charge_appointments_faculty_user_id_fkey FOREIGN KEY (faculty_user_id) REFERENCES public.users(id);


--
-- Name: hod_in_charge_appointments hod_in_charge_appointments_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hod_in_charge_appointments
    ADD CONSTRAINT hod_in_charge_appointments_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id);


--
-- Name: notification_delivery notification_delivery_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery
    ADD CONSTRAINT notification_delivery_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: notification_delivery notification_delivery_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery
    ADD CONSTRAINT notification_delivery_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id);


--
-- Name: notifications notifications_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: notifications notifications_drafted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_drafted_by_user_id_fkey FOREIGN KEY (drafted_by_user_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: ocr_results ocr_results_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results
    ADD CONSTRAINT ocr_results_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: ocr_results ocr_results_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results
    ADD CONSTRAINT ocr_results_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: ocr_results ocr_results_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results
    ADD CONSTRAINT ocr_results_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: password_reset_tokens password_reset_tokens_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: platform_audit_log platform_audit_log_actor_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit_log
    ADD CONSTRAINT platform_audit_log_actor_admin_id_fkey FOREIGN KEY (actor_admin_id) REFERENCES public.platform_admins(id);


--
-- Name: platform_college_stats platform_college_stats_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_college_stats
    ADD CONSTRAINT platform_college_stats_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_account_invitations position_account_invitations_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_invitations
    ADD CONSTRAINT position_account_invitations_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_account_invitations position_account_invitations_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_invitations
    ADD CONSTRAINT position_account_invitations_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: position_account_mfa_otps position_account_mfa_otps_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_mfa_otps
    ADD CONSTRAINT position_account_mfa_otps_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_account_mfa_otps position_account_mfa_otps_position_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_mfa_otps
    ADD CONSTRAINT position_account_mfa_otps_position_account_id_fkey FOREIGN KEY (position_account_id) REFERENCES public.position_accounts(id);


--
-- Name: position_account_refresh_tokens position_account_refresh_tokens_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_refresh_tokens
    ADD CONSTRAINT position_account_refresh_tokens_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_account_refresh_tokens position_account_refresh_tokens_position_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_account_refresh_tokens
    ADD CONSTRAINT position_account_refresh_tokens_position_account_id_fkey FOREIGN KEY (position_account_id) REFERENCES public.position_accounts(id);


--
-- Name: position_accounts position_accounts_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_accounts
    ADD CONSTRAINT position_accounts_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_accounts position_accounts_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_accounts
    ADD CONSTRAINT position_accounts_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: position_class_assignments position_class_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_class_assignments
    ADD CONSTRAINT position_class_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: position_class_assignments position_class_assignments_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_class_assignments
    ADD CONSTRAINT position_class_assignments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: position_class_assignments position_class_assignments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_class_assignments
    ADD CONSTRAINT position_class_assignments_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_class_assignments position_class_assignments_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_class_assignments
    ADD CONSTRAINT position_class_assignments_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: position_class_assignments position_class_assignments_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_class_assignments
    ADD CONSTRAINT position_class_assignments_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: position_department_assignments position_department_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_department_assignments
    ADD CONSTRAINT position_department_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: position_department_assignments position_department_assignments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_department_assignments
    ADD CONSTRAINT position_department_assignments_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_department_assignments position_department_assignments_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_department_assignments
    ADD CONSTRAINT position_department_assignments_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: position_department_assignments position_department_assignments_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_department_assignments
    ADD CONSTRAINT position_department_assignments_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: position_department_assignments position_department_assignments_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_department_assignments
    ADD CONSTRAINT position_department_assignments_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: position_module_assignments position_module_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_module_assignments
    ADD CONSTRAINT position_module_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: position_module_assignments position_module_assignments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_module_assignments
    ADD CONSTRAINT position_module_assignments_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_module_assignments position_module_assignments_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_module_assignments
    ADD CONSTRAINT position_module_assignments_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: position_module_assignments position_module_assignments_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_module_assignments
    ADD CONSTRAINT position_module_assignments_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: position_occupants position_occupants_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_occupants
    ADD CONSTRAINT position_occupants_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: position_occupants position_occupants_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_occupants
    ADD CONSTRAINT position_occupants_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: position_occupants position_occupants_position_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_occupants
    ADD CONSTRAINT position_occupants_position_account_id_fkey FOREIGN KEY (position_account_id) REFERENCES public.position_accounts(id);


--
-- Name: position_occupants position_occupants_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_occupants
    ADD CONSTRAINT position_occupants_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: position_occupants position_occupants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_occupants
    ADD CONSTRAINT position_occupants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: positions positions_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: positions positions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: principal_invitations principal_invitations_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_invitations
    ADD CONSTRAINT principal_invitations_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: principal_invitations principal_invitations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_invitations
    ADD CONSTRAINT principal_invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.platform_admins(id);


--
-- Name: refresh_tokens refresh_tokens_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: regulations regulations_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulations
    ADD CONSTRAINT regulations_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: regulations regulations_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulations
    ADD CONSTRAINT regulations_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: scholarship_decisions scholarship_decisions_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scholarship_decisions
    ADD CONSTRAINT scholarship_decisions_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: scholarship_decisions scholarship_decisions_decided_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scholarship_decisions
    ADD CONSTRAINT scholarship_decisions_decided_by_user_id_fkey FOREIGN KEY (decided_by_user_id) REFERENCES public.users(id);


--
-- Name: scholarship_decisions scholarship_decisions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scholarship_decisions
    ADD CONSTRAINT scholarship_decisions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: scholarship_decisions scholarship_decisions_supporting_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scholarship_decisions
    ADD CONSTRAINT scholarship_decisions_supporting_document_id_fkey FOREIGN KEY (supporting_document_id) REFERENCES public.documents(id);


--
-- Name: staff staff_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: staff staff_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: staff_invitations staff_invitations_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: staff_invitations staff_invitations_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: staff_invitations staff_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: staff staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: structural_authorization_keys structural_authorization_keys_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.structural_authorization_keys
    ADD CONSTRAINT structural_authorization_keys_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: structural_authorization_keys structural_authorization_keys_redeemed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.structural_authorization_keys
    ADD CONSTRAINT structural_authorization_keys_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES public.platform_admins(id);


--
-- Name: student_admission_draft_documents student_admission_draft_documents_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_draft_documents
    ADD CONSTRAINT student_admission_draft_documents_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: student_admission_draft_documents student_admission_draft_documents_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_draft_documents
    ADD CONSTRAINT student_admission_draft_documents_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.student_admission_drafts(id) ON DELETE CASCADE;


--
-- Name: student_admission_draft_documents student_admission_draft_documents_extraction_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_draft_documents
    ADD CONSTRAINT student_admission_draft_documents_extraction_job_id_fkey FOREIGN KEY (extraction_job_id) REFERENCES public.background_jobs(id) ON DELETE SET NULL;


--
-- Name: student_admission_drafts student_admission_drafts_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_drafts
    ADD CONSTRAINT student_admission_drafts_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE SET NULL;


--
-- Name: student_admission_drafts student_admission_drafts_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_drafts
    ADD CONSTRAINT student_admission_drafts_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: student_admission_drafts student_admission_drafts_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_drafts
    ADD CONSTRAINT student_admission_drafts_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: student_admission_drafts student_admission_drafts_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_drafts
    ADD CONSTRAINT student_admission_drafts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: student_admission_drafts student_admission_drafts_regulation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_admission_drafts
    ADD CONSTRAINT student_admission_drafts_regulation_id_fkey FOREIGN KEY (regulation_id) REFERENCES public.regulations(id);


--
-- Name: student_lifecycle_events student_lifecycle_events_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lifecycle_events
    ADD CONSTRAINT student_lifecycle_events_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: student_lifecycle_events student_lifecycle_events_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lifecycle_events
    ADD CONSTRAINT student_lifecycle_events_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: student_lifecycle_events student_lifecycle_events_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lifecycle_events
    ADD CONSTRAINT student_lifecycle_events_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id);


--
-- Name: student_lifecycle_events student_lifecycle_events_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lifecycle_events
    ADD CONSTRAINT student_lifecycle_events_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: student_phone_otps student_phone_otps_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_phone_otps
    ADD CONSTRAINT student_phone_otps_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: student_phone_otps student_phone_otps_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_phone_otps
    ADD CONSTRAINT student_phone_otps_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: student_transfer_requests student_transfer_requests_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_transfer_requests
    ADD CONSTRAINT student_transfer_requests_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: student_transfer_requests student_transfer_requests_destination_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_transfer_requests
    ADD CONSTRAINT student_transfer_requests_destination_class_id_fkey FOREIGN KEY (destination_class_id) REFERENCES public.classes(id);


--
-- Name: student_transfer_requests student_transfer_requests_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_transfer_requests
    ADD CONSTRAINT student_transfer_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: student_transfer_requests student_transfer_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_transfer_requests
    ADD CONSTRAINT student_transfer_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: student_transfer_requests student_transfer_requests_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_transfer_requests
    ADD CONSTRAINT student_transfer_requests_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: students students_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE SET NULL;


--
-- Name: students students_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: students students_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: students students_pending_regulation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pending_regulation_id_fkey FOREIGN KEY (pending_regulation_id) REFERENCES public.regulations(id);


--
-- Name: students students_regulation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_regulation_id_fkey FOREIGN KEY (regulation_id) REFERENCES public.regulations(id);


--
-- Name: subjects subjects_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: subjects subjects_regulation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_regulation_id_fkey FOREIGN KEY (regulation_id) REFERENCES public.regulations(id);


--
-- Name: substitute_assignment_requests substitute_assignment_requests_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignment_requests
    ADD CONSTRAINT substitute_assignment_requests_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: substitute_assignment_requests substitute_assignment_requests_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignment_requests
    ADD CONSTRAINT substitute_assignment_requests_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: substitute_assignment_requests substitute_assignment_requests_original_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignment_requests
    ADD CONSTRAINT substitute_assignment_requests_original_staff_user_id_fkey FOREIGN KEY (original_staff_user_id) REFERENCES public.users(id);


--
-- Name: substitute_assignment_requests substitute_assignment_requests_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignment_requests
    ADD CONSTRAINT substitute_assignment_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: substitute_assignment_requests substitute_assignment_requests_substitute_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignment_requests
    ADD CONSTRAINT substitute_assignment_requests_substitute_staff_user_id_fkey FOREIGN KEY (substitute_staff_user_id) REFERENCES public.users(id);


--
-- Name: substitute_assignment_requests substitute_assignment_requests_timetable_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignment_requests
    ADD CONSTRAINT substitute_assignment_requests_timetable_period_id_fkey FOREIGN KEY (timetable_period_id) REFERENCES public.timetable_periods(id);


--
-- Name: substitute_assignments substitute_assignments_assigning_authority_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_assigning_authority_user_id_fkey FOREIGN KEY (assigning_authority_user_id) REFERENCES public.users(id);


--
-- Name: substitute_assignments substitute_assignments_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: substitute_assignments substitute_assignments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: substitute_assignments substitute_assignments_original_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_original_staff_user_id_fkey FOREIGN KEY (original_staff_user_id) REFERENCES public.users(id);


--
-- Name: substitute_assignments substitute_assignments_substitute_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_substitute_staff_user_id_fkey FOREIGN KEY (substitute_staff_user_id) REFERENCES public.users(id);


--
-- Name: substitute_assignments substitute_assignments_timetable_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitute_assignments
    ADD CONSTRAINT substitute_assignments_timetable_period_id_fkey FOREIGN KEY (timetable_period_id) REFERENCES public.timetable_periods(id);


--
-- Name: timetable_periods timetable_periods_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: timetable_revisions timetable_revisions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_revisions
    ADD CONSTRAINT timetable_revisions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: timetable_revisions timetable_revisions_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_revisions
    ADD CONSTRAINT timetable_revisions_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: timetable_revisions timetable_revisions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_revisions
    ADD CONSTRAINT timetable_revisions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: timetable_revisions timetable_revisions_workflow_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_revisions
    ADD CONSTRAINT timetable_revisions_workflow_request_id_fkey FOREIGN KEY (workflow_request_id) REFERENCES public.workflow_requests(id);


--
-- Name: user_mfa_otps user_mfa_otps_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_otps
    ADD CONSTRAINT user_mfa_otps_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: user_mfa_otps user_mfa_otps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_otps
    ADD CONSTRAINT user_mfa_otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_activated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES public.users(id);


--
-- Name: users users_active_hod_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_active_hod_department_id_fkey FOREIGN KEY (active_hod_department_id) REFERENCES public.departments(id);


--
-- Name: users users_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: workflow_delegations workflow_delegations_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_delegations
    ADD CONSTRAINT workflow_delegations_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: workflow_delegations workflow_delegations_delegate_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_delegations
    ADD CONSTRAINT workflow_delegations_delegate_user_id_fkey FOREIGN KEY (delegate_user_id) REFERENCES public.users(id);


--
-- Name: workflow_delegations workflow_delegations_delegated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_delegations
    ADD CONSTRAINT workflow_delegations_delegated_by_user_id_fkey FOREIGN KEY (delegated_by_user_id) REFERENCES public.users(id);


--
-- Name: workflow_delegations workflow_delegations_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_delegations
    ADD CONSTRAINT workflow_delegations_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: workflow_delegations workflow_delegations_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_delegations
    ADD CONSTRAINT workflow_delegations_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id);


--
-- Name: workflow_requests workflow_requests_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_requests
    ADD CONSTRAINT workflow_requests_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: workflow_requests workflow_requests_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_requests
    ADD CONSTRAINT workflow_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: academic_calendar_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.academic_calendar_events ENABLE ROW LEVEL SECURITY;

--
-- Name: academic_years; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_document_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_document_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;

--
-- Name: archived_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.archived_records ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_mark_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_mark_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_marks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_marks ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_types ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_absence_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_absence_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: background_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

--
-- Name: college_ai_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.college_ai_config ENABLE ROW LEVEL SECURITY;

--
-- Name: college_notification_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.college_notification_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: configurations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configurations ENABLE ROW LEVEL SECURITY;

--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: document_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_timetable_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_timetable_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: faculty_allocation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faculty_allocation ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: hod_in_charge_appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hod_in_charge_appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_delivery; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_delivery ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: ocr_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ocr_results ENABLE ROW LEVEL SECURITY;

--
-- Name: password_reset_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: position_account_mfa_otps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_account_mfa_otps ENABLE ROW LEVEL SECURITY;

--
-- Name: position_account_refresh_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_account_refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: position_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: position_class_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_class_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: position_department_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_department_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: position_module_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_module_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: position_occupants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_occupants ENABLE ROW LEVEL SECURITY;

--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: regulations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.regulations ENABLE ROW LEVEL SECURITY;

--
-- Name: scholarship_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scholarship_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: staff; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

--
-- Name: student_admission_draft_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_admission_draft_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: student_admission_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_admission_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: student_lifecycle_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_lifecycle_events ENABLE ROW LEVEL SECURITY;

--
-- Name: student_phone_otps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_phone_otps ENABLE ROW LEVEL SECURITY;

--
-- Name: student_transfer_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_transfer_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: substitute_assignment_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.substitute_assignment_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: substitute_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.substitute_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: academic_calendar_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.academic_calendar_events USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: academic_years tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.academic_years USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: ai_document_chunks tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ai_document_chunks USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: approval_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.approval_history USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: archived_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.archived_records USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: assessment_mark_corrections tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.assessment_mark_corrections USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: assessment_marks tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.assessment_marks USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: assessment_types tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.assessment_types USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: attendance_absence_flags tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.attendance_absence_flags USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: attendance_corrections tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.attendance_corrections USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: attendance_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.attendance_sessions USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: audit_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.audit_log USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: background_jobs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.background_jobs USING ((college_id = current_setting('app.current_tenant'::text, true))) WITH CHECK ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: classes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.classes USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: college_ai_config tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.college_ai_config USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: college_notification_channels tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.college_notification_channels USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: configurations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.configurations USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: departments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.departments USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: document_categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.document_categories USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: documents tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.documents USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: exam_timetable_versions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.exam_timetable_versions USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: faculty_allocation tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.faculty_allocation USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: fee_corrections tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.fee_corrections USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: fee_payments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.fee_payments USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: generated_reports tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.generated_reports USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: hod_in_charge_appointments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hod_in_charge_appointments USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: notification_delivery tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notification_delivery USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: notifications tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notifications USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: ocr_results tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ocr_results USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: password_reset_tokens tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.password_reset_tokens USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: position_account_mfa_otps tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.position_account_mfa_otps USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: position_account_refresh_tokens tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.position_account_refresh_tokens USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: position_accounts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.position_accounts USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: position_class_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.position_class_assignments USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: position_department_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.position_department_assignments USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: position_module_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.position_module_assignments USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: position_occupants tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.position_occupants USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: positions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.positions USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: refresh_tokens tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.refresh_tokens USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: regulations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.regulations USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: scholarship_decisions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.scholarship_decisions USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: staff tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.staff USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: student_admission_draft_documents tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.student_admission_draft_documents USING ((college_id = current_setting('app.current_tenant'::text, true))) WITH CHECK ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: student_admission_drafts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.student_admission_drafts USING ((college_id = current_setting('app.current_tenant'::text, true))) WITH CHECK ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: student_lifecycle_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.student_lifecycle_events USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: student_phone_otps tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.student_phone_otps USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: student_transfer_requests tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.student_transfer_requests USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: students tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.students USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: subjects tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.subjects USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: substitute_assignment_requests tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.substitute_assignment_requests USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: substitute_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.substitute_assignments USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: timetable_periods tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.timetable_periods USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: timetable_revisions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.timetable_revisions USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: user_mfa_otps tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.user_mfa_otps USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: users tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.users USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: workflow_delegations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workflow_delegations USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: workflow_requests tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workflow_requests USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: timetable_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timetable_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: timetable_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timetable_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_mfa_otps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_mfa_otps ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_delegations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_delegations ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE academic_calendar_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.academic_calendar_events TO arcnave_app;


--
-- Name: TABLE academic_years; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.academic_years TO arcnave_app;


--
-- Name: TABLE ai_document_chunks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.ai_document_chunks TO arcnave_app;


--
-- Name: TABLE approval_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.approval_history TO arcnave_app;


--
-- Name: TABLE archived_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.archived_records TO arcnave_app;


--
-- Name: TABLE assessment_mark_corrections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.assessment_mark_corrections TO arcnave_app;


--
-- Name: TABLE assessment_marks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.assessment_marks TO arcnave_app;


--
-- Name: TABLE assessment_types; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.assessment_types TO arcnave_app;


--
-- Name: TABLE attendance_absence_flags; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.attendance_absence_flags TO arcnave_app;


--
-- Name: TABLE attendance_corrections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.attendance_corrections TO arcnave_app;


--
-- Name: TABLE attendance_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.attendance_sessions TO arcnave_app;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.audit_log TO arcnave_app;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.audit_log_id_seq TO arcnave_app;


--
-- Name: TABLE background_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.background_jobs TO arcnave_app;


--
-- Name: TABLE classes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classes TO arcnave_app;


--
-- Name: TABLE college_ai_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.college_ai_config TO arcnave_app;


--
-- Name: TABLE college_notification_channels; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.college_notification_channels TO arcnave_app;


--
-- Name: TABLE colleges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.colleges TO arcnave_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.colleges TO arcnave_platform;


--
-- Name: COLUMN colleges.name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(name) ON TABLE public.colleges TO arcnave_app;


--
-- Name: COLUMN colleges.affiliating_university; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(affiliating_university) ON TABLE public.colleges TO arcnave_app;


--
-- Name: COLUMN colleges.year_established; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(year_established) ON TABLE public.colleges TO arcnave_app;


--
-- Name: COLUMN colleges.address; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(address) ON TABLE public.colleges TO arcnave_app;


--
-- Name: COLUMN colleges.level1_position_title; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(level1_position_title) ON TABLE public.colleges TO arcnave_app;


--
-- Name: COLUMN colleges.level3_position_title; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(level3_position_title) ON TABLE public.colleges TO arcnave_app;


--
-- Name: COLUMN colleges.level4_position_title; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(level4_position_title) ON TABLE public.colleges TO arcnave_app;


--
-- Name: TABLE configurations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.configurations TO arcnave_app;


--
-- Name: TABLE departments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.departments TO arcnave_app;


--
-- Name: TABLE document_categories; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.document_categories TO arcnave_app;


--
-- Name: TABLE document_type_registry; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.document_type_registry TO arcnave_app;


--
-- Name: TABLE documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documents TO arcnave_app;


--
-- Name: TABLE exam_timetable_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.exam_timetable_versions TO arcnave_app;


--
-- Name: TABLE faculty_allocation; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.faculty_allocation TO arcnave_app;


--
-- Name: TABLE fee_corrections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.fee_corrections TO arcnave_app;


--
-- Name: TABLE fee_payments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.fee_payments TO arcnave_app;


--
-- Name: TABLE generated_reports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.generated_reports TO arcnave_app;


--
-- Name: TABLE hod_in_charge_appointments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.hod_in_charge_appointments TO arcnave_app;


--
-- Name: TABLE notification_delivery; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.notification_delivery TO arcnave_app;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.notifications TO arcnave_app;


--
-- Name: TABLE ocr_results; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.ocr_results TO arcnave_app;


--
-- Name: TABLE password_reset_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.password_reset_tokens TO arcnave_app;


--
-- Name: TABLE platform_admins; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.platform_admins TO arcnave_platform;


--
-- Name: TABLE platform_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.platform_audit_log TO arcnave_platform;


--
-- Name: SEQUENCE platform_audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.platform_audit_log_id_seq TO arcnave_platform;


--
-- Name: TABLE platform_college_stats; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.platform_college_stats TO arcnave_platform;
GRANT SELECT,INSERT,UPDATE ON TABLE public.platform_college_stats TO arcnave_app;


--
-- Name: TABLE platform_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,UPDATE ON TABLE public.platform_settings TO arcnave_platform;


--
-- Name: TABLE position_account_invitations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_account_invitations TO arcnave_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.position_account_invitations TO arcnave_platform;


--
-- Name: TABLE position_account_mfa_otps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_account_mfa_otps TO arcnave_app;


--
-- Name: TABLE position_account_refresh_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.position_account_refresh_tokens TO arcnave_app;


--
-- Name: TABLE position_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_accounts TO arcnave_app;


--
-- Name: TABLE position_class_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_class_assignments TO arcnave_app;


--
-- Name: TABLE position_department_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_department_assignments TO arcnave_app;


--
-- Name: TABLE position_module_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_module_assignments TO arcnave_app;


--
-- Name: TABLE position_occupants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_occupants TO arcnave_app;


--
-- Name: TABLE positions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.positions TO arcnave_app;


--
-- Name: TABLE principal_invitations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.principal_invitations TO arcnave_platform;
GRANT SELECT,UPDATE ON TABLE public.principal_invitations TO arcnave_app;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.refresh_tokens TO arcnave_app;


--
-- Name: TABLE regulations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.regulations TO arcnave_app;


--
-- Name: TABLE scholarship_decisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.scholarship_decisions TO arcnave_app;


--
-- Name: TABLE staff; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.staff TO arcnave_app;


--
-- Name: TABLE staff_invitations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.staff_invitations TO arcnave_app;


--
-- Name: TABLE structural_authorization_keys; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.structural_authorization_keys TO arcnave_app;
GRANT SELECT,UPDATE ON TABLE public.structural_authorization_keys TO arcnave_platform;


--
-- Name: TABLE student_admission_draft_documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_admission_draft_documents TO arcnave_app;


--
-- Name: TABLE student_admission_drafts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_admission_drafts TO arcnave_app;


--
-- Name: TABLE student_lifecycle_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.student_lifecycle_events TO arcnave_app;


--
-- Name: TABLE student_phone_otps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.student_phone_otps TO arcnave_app;


--
-- Name: TABLE student_transfer_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.student_transfer_requests TO arcnave_app;


--
-- Name: TABLE students; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.students TO arcnave_app;


--
-- Name: TABLE subjects; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.subjects TO arcnave_app;


--
-- Name: TABLE substitute_assignment_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.substitute_assignment_requests TO arcnave_app;


--
-- Name: TABLE substitute_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.substitute_assignments TO arcnave_app;


--
-- Name: TABLE timetable_periods; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.timetable_periods TO arcnave_app;


--
-- Name: TABLE timetable_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.timetable_revisions TO arcnave_app;


--
-- Name: TABLE user_mfa_otps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.user_mfa_otps TO arcnave_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO arcnave_app;


--
-- Name: TABLE workflow_delegations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.workflow_delegations TO arcnave_app;


--
-- Name: TABLE workflow_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.workflow_requests TO arcnave_app;


--
-- PostgreSQL database dump complete
--

\unrestrict IkmPjOh5VDzhBRRGljEhCsZKyJpRy6SFGFimbnNpFdidcDmS0rNTNoqSJeISGuF

