\set ON_ERROR_STOP on

-- Run only during an explicitly approved R2 installation, as a database owner or
-- superuser connected to the production `kakapo` database. No password is stored
-- here. Set it later through a protected interactive/root-only workflow.

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('kakapo-inspector-role-r16'));

-- A colliding role is reused only when it is already structurally harmless.
-- Memberships and object ownership are not silently normalized: installation
-- stops so an operator can investigate why they exist.
DO $guard$
DECLARE
  role_row pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO role_row
    FROM pg_catalog.pg_roles
   WHERE rolname = 'kakapo_inspector';

  IF FOUND THEN
    IF role_row.rolsuper OR role_row.rolcreatedb OR role_row.rolcreaterole
       OR role_row.rolinherit OR role_row.rolreplication OR role_row.rolbypassrls THEN
      RAISE EXCEPTION 'unsafe pre-existing kakapo_inspector role attributes';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members
       WHERE member = role_row.oid OR roleid = role_row.oid
    ) THEN
      RAISE EXCEPTION 'unexpected kakapo_inspector role membership';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_stat_activity
       WHERE usename = 'kakapo_inspector'
         AND pid <> pg_catalog.pg_backend_pid()
    ) THEN
      RAISE EXCEPTION 'active pre-existing kakapo_inspector session detected';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relowner = role_row.oid)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = role_row.oid)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proowner = role_row.oid)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datdba = role_row.oid)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_type WHERE typowner = role_row.oid)
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_shdepend
          WHERE refclassid = 'pg_authid'::pg_catalog.regclass
            AND refobjid = role_row.oid
            AND deptype = 'o'
       ) THEN
      RAISE EXCEPTION 'kakapo_inspector unexpectedly owns database objects';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_default_acl d
        CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) acl
       WHERE acl.grantee = role_row.oid
    ) THEN
      RAISE EXCEPTION 'kakapo_inspector has unexpected default privileges';
    END IF;
  ELSE
    CREATE ROLE kakapo_inspector
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS
      CONNECTION LIMIT 2;
  END IF;
END
$guard$;

ALTER ROLE kakapo_inspector
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD NULL
  CONNECTION LIMIT 2;
ALTER ROLE kakapo_inspector SET default_transaction_read_only = on;
ALTER ROLE kakapo_inspector SET statement_timeout = '5s';
ALTER ROLE kakapo_inspector SET lock_timeout = '1s';
ALTER ROLE kakapo_inspector SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE kakapo_inspector SET search_path = pg_catalog,kakapo_inspect;

-- Remove direct privileges in every non-system schema before granting the exact
-- inspection surface. This changes only kakapo_inspector privileges.
DO $revoke$
DECLARE
  schema_row record;
  database_row record;
BEGIN
  FOR database_row IN
    SELECT datname FROM pg_catalog.pg_database WHERE NOT datistemplate
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON DATABASE %I FROM kakapo_inspector',
      database_row.datname
    );
  END LOOP;

  FOR schema_row IN
    SELECT nspname
      FROM pg_catalog.pg_namespace
     WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM kakapo_inspector',
      schema_row.nspname
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM kakapo_inspector',
      schema_row.nspname
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM kakapo_inspector',
      schema_row.nspname
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA %I FROM kakapo_inspector',
      schema_row.nspname
    );
  END LOOP;
END
$revoke$;

GRANT CONNECT ON DATABASE kakapo TO kakapo_inspector;

-- TEMP is inherited from PUBLIC in a default PostgreSQL database. Preserve the
-- current effective TEMP right for every other existing LOGIN role, then remove
-- PUBLIC inheritance and explicitly deny the inspector by absence of a grant.
DO $temp$
DECLARE
  login_role record;
BEGIN
  FOR login_role IN
    SELECT rolname
      FROM pg_catalog.pg_roles
     WHERE rolcanlogin
       AND rolname <> 'kakapo_inspector'
       AND pg_catalog.has_database_privilege(oid, 'kakapo', 'TEMP')
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT TEMPORARY ON DATABASE kakapo TO %I',
      login_role.rolname
    );
  END LOOP;
END
$temp$;
REVOKE TEMPORARY ON DATABASE kakapo FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE kakapo FROM kakapo_inspector;

CREATE SCHEMA IF NOT EXISTS kakapo_inspect AUTHORIZATION kakapo;
ALTER SCHEMA kakapo_inspect OWNER TO kakapo;
REVOKE ALL PRIVILEGES ON SCHEMA kakapo_inspect FROM PUBLIC;
GRANT USAGE ON SCHEMA kakapo_inspect TO kakapo_inspector;

CREATE OR REPLACE VIEW kakapo_inspect.clients WITH (security_barrier = true) AS
  SELECT id, data, sort_idx, updated_at FROM public.docs WHERE collection = 'clients';
CREATE OR REPLACE VIEW kakapo_inspect.cards WITH (security_barrier = true) AS
  SELECT id, data, sort_idx, updated_at FROM public.docs WHERE collection = 'cards';
CREATE OR REPLACE VIEW kakapo_inspect.pos_sales WITH (security_barrier = true) AS
  SELECT id, data, sort_idx, updated_at FROM public.docs WHERE collection = 'posSales';
CREATE OR REPLACE VIEW kakapo_inspect.orders WITH (security_barrier = true) AS
  SELECT id, data, sort_idx, updated_at FROM public.docs WHERE collection = 'orders';
CREATE OR REPLACE VIEW kakapo_inspect.pos_shifts WITH (security_barrier = true) AS
  SELECT id, data, sort_idx, updated_at FROM public.docs WHERE collection = 'posShifts';
CREATE OR REPLACE VIEW kakapo_inspect.finance_moves WITH (security_barrier = true) AS
  SELECT id, data, sort_idx, updated_at FROM public.docs WHERE collection = 'financeMoves';
CREATE OR REPLACE VIEW kakapo_inspect.money_ledger WITH (security_barrier = true) AS
  SELECT id, data, sort_idx, updated_at FROM public.docs WHERE collection = 'moneyLedger';
CREATE OR REPLACE VIEW kakapo_inspect.products WITH (security_barrier = true) AS
  SELECT id, data, sort_idx, updated_at FROM public.docs WHERE collection = 'products';
CREATE OR REPLACE VIEW kakapo_inspect.sync_changes WITH (security_barrier = true) AS
  SELECT change_seq, entity_type, entity_id, action, revision, updated_at, created_at
    FROM public.sync_changes;

ALTER VIEW kakapo_inspect.clients OWNER TO kakapo;
ALTER VIEW kakapo_inspect.cards OWNER TO kakapo;
ALTER VIEW kakapo_inspect.pos_sales OWNER TO kakapo;
ALTER VIEW kakapo_inspect.orders OWNER TO kakapo;
ALTER VIEW kakapo_inspect.pos_shifts OWNER TO kakapo;
ALTER VIEW kakapo_inspect.finance_moves OWNER TO kakapo;
ALTER VIEW kakapo_inspect.money_ledger OWNER TO kakapo;
ALTER VIEW kakapo_inspect.products OWNER TO kakapo;
ALTER VIEW kakapo_inspect.sync_changes OWNER TO kakapo;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA kakapo_inspect FROM PUBLIC;
REVOKE ALL PRIVILEGES ON public.docs, public.sync_changes,
  public.kv_meta, public.api_sessions FROM kakapo_inspector;

GRANT SELECT ON kakapo_inspect.clients,
  kakapo_inspect.cards,
  kakapo_inspect.pos_sales,
  kakapo_inspect.orders,
  kakapo_inspect.pos_shifts,
  kakapo_inspect.finance_moves,
  kakapo_inspect.money_ledger,
  kakapo_inspect.products,
  kakapo_inspect.sync_changes
TO kakapo_inspector;

-- Do not change PUBLIC function privileges. Fail closed when any non-system
-- function is executable by the inspector. The runtime repeats this inventory on
-- every connection, so a later function addition disables inspection safely.
DO $verify$
DECLARE
  inspector_oid oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'kakapo_inspector');
  role_row pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO STRICT role_row FROM pg_catalog.pg_roles WHERE oid = inspector_oid;

  IF role_row.rolsuper OR role_row.rolcreatedb OR role_row.rolcreaterole
     OR role_row.rolinherit OR role_row.rolreplication OR role_row.rolbypassrls
     OR NOT role_row.rolcanlogin THEN
    RAISE EXCEPTION 'kakapo_inspector final attribute verification failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
     WHERE member = inspector_oid OR roleid = inspector_oid
  ) THEN
    RAISE EXCEPTION 'kakapo_inspector final membership verification failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_shdepend
     WHERE refclassid = 'pg_authid'::pg_catalog.regclass
       AND refobjid = inspector_oid
       AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'kakapo_inspector final ownership verification failed';
  END IF;

  IF pg_catalog.has_database_privilege('kakapo_inspector', 'kakapo', 'CREATE')
     OR pg_catalog.has_database_privilege('kakapo_inspector', 'kakapo', 'TEMP')
     OR pg_catalog.has_table_privilege('kakapo_inspector', 'public.docs', 'SELECT')
     OR pg_catalog.has_table_privilege('kakapo_inspector', 'public.api_sessions', 'SELECT')
     OR pg_catalog.has_table_privilege('kakapo_inspector', 'public.kv_meta', 'SELECT') THEN
    RAISE EXCEPTION 'kakapo_inspector forbidden effective privilege detected';
  END IF;

  IF EXISTS (
    SELECT 1
     FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND (pg_catalog.has_table_privilege('kakapo_inspector', c.oid, 'INSERT')
         OR pg_catalog.has_table_privilege('kakapo_inspector', c.oid, 'UPDATE')
         OR pg_catalog.has_table_privilege('kakapo_inspector', c.oid, 'DELETE')
         OR pg_catalog.has_table_privilege('kakapo_inspector', c.oid, 'TRUNCATE')
         OR pg_catalog.has_table_privilege('kakapo_inspector', c.oid, 'REFERENCES')
         OR pg_catalog.has_table_privilege('kakapo_inspector', c.oid, 'TRIGGER'))
  ) THEN
    RAISE EXCEPTION 'kakapo_inspector write-capable relation privilege detected';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND c.relkind = 'S'
       AND (pg_catalog.has_sequence_privilege('kakapo_inspector', c.oid, 'USAGE')
         OR pg_catalog.has_sequence_privilege('kakapo_inspector', c.oid, 'UPDATE'))
  ) THEN
    RAISE EXCEPTION 'kakapo_inspector write-capable sequence privilege detected';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace n
     WHERE n.nspname NOT LIKE 'pg_%'
       AND n.nspname <> 'information_schema'
       AND pg_catalog.has_schema_privilege('kakapo_inspector', n.oid, 'CREATE')
  ) THEN
    RAISE EXCEPTION 'kakapo_inspector writable schema detected';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND pg_catalog.has_function_privilege('kakapo_inspector', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'executable non-system function visible to kakapo_inspector';
  END IF;
END
$verify$;

COMMIT;
