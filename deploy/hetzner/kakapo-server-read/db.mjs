import fs from 'node:fs/promises'
import {
  MAX_SEARCH_RESULTS,
  PolicyError,
  projectCard,
  projectClient,
  projectDebtEntry,
  projectFinance,
  projectOrder,
  projectProduct,
  projectSale,
  projectShift,
} from './policy.mjs'

export const DB_CONFIG_PATH = '/etc/kakapo-server-read.conf'
export const EXPECTED_DB_ROLE = 'kakapo_inspector'
export const EXPECTED_DATABASE = 'kakapo'

export const SQL = Object.freeze({
  sessionCheck: `SELECT current_user AS role,
                        current_database() AS database,
                        current_setting('transaction_read_only') AS read_only,
                        current_setting('default_transaction_read_only') AS default_read_only`,
  roleGuard: `SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit,
                     r.rolreplication, r.rolbypassrls, r.rolcanlogin,
                     EXISTS (
                       SELECT 1 FROM pg_catalog.pg_auth_members m
                        WHERE m.member = r.oid OR m.roleid = r.oid
                     ) AS has_membership,
                     EXISTS (
                       SELECT 1 FROM pg_catalog.pg_shdepend d
                        WHERE d.refclassid = 'pg_authid'::pg_catalog.regclass
                          AND d.refobjid = r.oid
                          AND d.deptype = 'o'
                     ) AS owns_objects
                FROM pg_catalog.pg_roles r
               WHERE r.rolname = current_user`,
  privilegeGuard: `SELECT
      pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      pg_catalog.has_database_privilege(current_user, current_database(), 'TEMP') AS database_temp,
      pg_catalog.has_table_privilege(current_user, 'public.docs', 'SELECT') AS direct_docs_select,
      pg_catalog.has_table_privilege(current_user, 'public.api_sessions', 'SELECT') AS api_sessions_select,
      pg_catalog.has_table_privilege(current_user, 'public.kv_meta', 'SELECT') AS kv_meta_select,
      (SELECT COUNT(*)::int
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT')
            OR pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE')
            OR pg_catalog.has_table_privilege(current_user, c.oid, 'DELETE')
            OR pg_catalog.has_table_privilege(current_user, c.oid, 'TRUNCATE')
            OR pg_catalog.has_table_privilege(current_user, c.oid, 'REFERENCES')
            OR pg_catalog.has_table_privilege(current_user, c.oid, 'TRIGGER'))) AS writable_relations,
      (SELECT COUNT(*)::int
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND c.relkind = 'S'
          AND (pg_catalog.has_sequence_privilege(current_user, c.oid, 'USAGE')
            OR pg_catalog.has_sequence_privilege(current_user, c.oid, 'UPDATE'))) AS writable_sequences,
      (SELECT COUNT(*)::int
         FROM pg_catalog.pg_namespace n
        WHERE n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
          AND pg_catalog.has_schema_privilege(current_user, n.oid, 'CREATE')) AS writable_schemas`,
  functionGuard: `SELECT COUNT(*)::int AS executable_count
                    FROM pg_catalog.pg_proc p
                    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                     AND pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE')`,
  clientById: `SELECT id, data, updated_at
                 FROM kakapo_inspect.clients
                WHERE id = $1 OR data->>'id' = $1
                ORDER BY updated_at DESC
                LIMIT 2`,
  clientsByPhone: `SELECT id, data, updated_at
                     FROM kakapo_inspect.clients
                    WHERE right(regexp_replace(COALESCE(data->>'phone', ''), '[^0-9]', '', 'g'), 9) = $1
                    ORDER BY updated_at DESC
                    LIMIT $2`,
  clientsByName: `SELECT id, data, updated_at
                    FROM kakapo_inspect.clients
                   WHERE position(lower($1) in lower(COALESCE(data->>'name', ''))) > 0
                   ORDER BY updated_at DESC
                   LIMIT $2`,
  cardsByNormalizedNumber: `SELECT id, data, updated_at
                              FROM kakapo_inspect.cards
                             WHERE ltrim(regexp_replace(COALESCE(data->>'num', ''), '[^0-9]', '', 'g'), '0') = ltrim($1, '0')
                             ORDER BY updated_at DESC
                             LIMIT $2`,
  cardsByClient: `SELECT id, data, updated_at
                    FROM kakapo_inspect.cards
                   WHERE data->>'clientId' = $1
                      OR ($2 <> '' AND ltrim(regexp_replace(COALESCE(data->>'num', ''), '[^0-9]', '', 'g'), '0') = ltrim($2, '0'))
                   ORDER BY updated_at DESC
                   LIMIT $3`,
  salesByClient: `SELECT id, data, updated_at
                    FROM kakapo_inspect.pos_sales
                   WHERE data->>'clientId' = $1
                   ORDER BY COALESCE(data->>'createdAtIso', updated_at::text) DESC
                   LIMIT $2`,
  ordersByClient: `SELECT id, data, updated_at
                     FROM kakapo_inspect.orders
                    WHERE data->>'clientAccountId' = $1
                    ORDER BY COALESCE(data->>'createdAtIso', data->>'createdAt', updated_at::text) DESC
                    LIMIT $2`,
  moneyByClient: `SELECT id, data, updated_at
                    FROM kakapo_inspect.money_ledger
                   WHERE data->'meta'->>'clientId' = $1
                   ORDER BY COALESCE(data->>'createdAtIso', updated_at::text) DESC
                   LIMIT $2`,
  saleById: `SELECT id, data, updated_at
               FROM kakapo_inspect.pos_sales
              WHERE id = $1 OR data->>'id' = $1
              ORDER BY updated_at DESC
              LIMIT 2`,
  salesByNumber: `SELECT id, data, updated_at
                    FROM kakapo_inspect.pos_sales
                   WHERE data->>'number' = $1
                   ORDER BY COALESCE(data->>'createdAtIso', updated_at::text) DESC
                   LIMIT $2`,
  orderById: `SELECT id, data, updated_at
                FROM kakapo_inspect.orders
               WHERE id = $1 OR data->>'id' = $1
               ORDER BY updated_at DESC
               LIMIT 2`,
  shiftById: `SELECT id, data, updated_at
                FROM kakapo_inspect.pos_shifts
               WHERE id = $1 OR data->>'id' = $1
               ORDER BY updated_at DESC
               LIMIT 2`,
  financeById: `SELECT 'financeMoves' AS collection, id, data, updated_at
                  FROM kakapo_inspect.finance_moves
                 WHERE id = $1 OR data->>'id' = $1
                 UNION ALL
                SELECT 'moneyLedger' AS collection, id, data, updated_at
                  FROM kakapo_inspect.money_ledger
                 WHERE id = $1 OR data->>'id' = $1
                 ORDER BY updated_at DESC
                 LIMIT 4`,
  productById: `SELECT id, data, updated_at
                  FROM kakapo_inspect.products
                 WHERE id = $1 OR data->>'id' = $1
                 ORDER BY updated_at DESC
                 LIMIT 2`,
  syncHead: `SELECT MIN(change_seq)::text AS min_change_seq,
                    MAX(change_seq)::text AS max_change_seq,
                    COUNT(*)::text AS row_count,
                    MIN(created_at) AS oldest_created_at,
                    MAX(created_at) AS newest_created_at
               FROM kakapo_inspect.sync_changes`,
  syncEntity: `SELECT change_seq::text AS change_seq, entity_type, entity_id, action,
                      revision::text AS revision, updated_at, created_at
                 FROM kakapo_inspect.sync_changes
                WHERE entity_type = $1 AND entity_id = $2
                ORDER BY change_seq DESC
                LIMIT $3`,
})

const FIXED_TRANSACTION_SQL = Object.freeze([
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL lock_timeout = '1s'",
  "SET LOCAL idle_in_transaction_session_timeout = '10s'",
])

export function assertRuntimeSqlIsReadOnly() {
  const forbidden = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|CALL|DO|VACUUM|REINDEX|CLUSTER|REFRESH)\b/i
  for (const [name, sql] of Object.entries(SQL)) {
    const executable = sql
      .replace(/'(?:''|[^'])*'/g, "''")
      .replace(/--[^\r\n]*/g, '')
    if (!/^\s*SELECT\b/i.test(executable) || forbidden.test(executable) || executable.includes(';')) {
      throw new PolicyError('UNSAFE_SQL_DEFINITION', name)
    }
    if (/\bapi_sessions\b/i.test(executable) || /\bkv_meta\b/i.test(executable)) {
      throw new PolicyError('FORBIDDEN_TABLE_REFERENCE', name)
    }
  }
  return true
}

export async function loadDbConfig(configPath = DB_CONFIG_PATH, io = fs) {
  const raw = await io.readFile(configPath, 'utf8')
  const values = new Map()
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) throw new PolicyError('INVALID_DB_CONFIG')
    const [, key, value] = match
    if (key !== 'KAKAPO_INSPECT_DATABASE_URL') throw new PolicyError('UNKNOWN_DB_CONFIG_KEY')
    values.set(key, value.trim())
  }
  const databaseUrl = values.get('KAKAPO_INSPECT_DATABASE_URL')
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new PolicyError('INSPECT_DATABASE_URL_MISSING')
  }
  return { databaseUrl }
}

export function resolveInspectorDatabaseUrl(databaseUrl, containerIp) {
  let url
  try { url = new URL(String(databaseUrl || '')) } catch { throw new PolicyError('INVALID_INSPECT_DATABASE_URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || url.username !== EXPECTED_DB_ROLE
      || !url.password
      || url.hostname !== 'kakapo-postgres'
      || url.pathname !== `/${EXPECTED_DATABASE}`) {
    throw new PolicyError('INVALID_INSPECT_DATABASE_URL')
  }
  if (!isPrivateIpv4(containerIp)) throw new PolicyError('INVALID_POSTGRES_CONTAINER_IP')
  url.hostname = containerIp
  return url.toString()
}

function isPrivateIpv4(value) {
  const parts = String(value || '').split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

function rowData(row) {
  return row && typeof row.data === 'object' && row.data !== null ? row.data : {}
}

function withStorageMeta(row, projected) {
  return {
    storageId: row?.id ?? null,
    storageUpdatedAt: row?.updated_at ?? null,
    ...projected,
  }
}

async function query(client, text, params = []) {
  return (await client.query(text, params)).rows || []
}

async function clientInspection(client, clientId) {
  const clients = await query(client, SQL.clientById, [clientId])
  const selected = clients[0]
  if (!selected) return { found: false, clientId }
  const data = rowData(selected)
  const cardDigits = String(data.card || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const cards = await query(client, SQL.cardsByClient, [String(data.id || clientId), cardDigits, MAX_SEARCH_RESULTS])
  return {
    found: true,
    ambiguousClientRows: clients.length > 1,
    client: withStorageMeta(selected, projectClient(data)),
    linkedCards: cards.map(row => withStorageMeta(row, projectCard(rowData(row)))),
  }
}

async function debtInspection(client, clientId) {
  const base = await clientInspection(client, clientId)
  if (!base.found) return base
  const clientDataRows = await query(client, SQL.clientById, [clientId])
  const clientData = rowData(clientDataRows[0])
  const ledger = Array.isArray(clientData.debtLedger) ? clientData.debtLedger : []
  const projectedLedger = ledger.map(projectDebtEntry)
  const entries = projectedLedger.slice(0, 120)
  const remaining = projectedLedger.reduce((sum, entry) => sum + Math.max(0, Number(entry.remaining) || 0), 0)
  const open = projectedLedger.filter(entry => Number(entry.remaining) > 0)
  const now = Date.now()
  const overdue = open.filter(entry => {
    const due = Date.parse(String(entry.dueAtIso || ''))
    return Number.isFinite(due) && due < now
  })
  const [sales, orders, money] = await Promise.all([
    query(client, SQL.salesByClient, [clientId, 20]),
    query(client, SQL.ordersByClient, [clientId, 20]),
    query(client, SQL.moneyByClient, [clientId, 30]),
  ])
  const clientDebt = Number(clientData.debt) || 0
  const cardDebts = base.linkedCards.map(card => Number(card.debt) || 0)
  return {
    ...base,
    canonical: 'client.debtLedger.remaining',
    ledger: {
      totalEntries: ledger.length,
      returnedEntries: entries.length,
      truncated: ledger.length > entries.length,
      remaining,
      openCount: open.length,
      overdueCount: overdue.length,
      entries,
    },
    mirrors: {
      clientDebt,
      cardDebts,
      clientMatchesLedger: Math.abs(clientDebt - remaining) < 0.005,
      cardsMatchLedger: cardDebts.map(value => Math.abs(value - remaining) < 0.005),
    },
    recentEvidence: {
      sales: sales.map(row => withStorageMeta(row, projectSale(rowData(row)))),
      orders: orders.map(row => withStorageMeta(row, projectOrder(rowData(row)))),
      moneyLedger: money.map(row => withStorageMeta(row, projectFinance(rowData(row), 'moneyLedger'))),
    },
  }
}

export async function executeInspection(client, spec) {
  const [value, second, third] = spec.args || []
  switch (spec.command) {
    case 'client':
      return clientInspection(client, value)
    case 'client-phone': {
      const rows = await query(client, SQL.clientsByPhone, [value, MAX_SEARCH_RESULTS])
      return { found: rows.length > 0, ambiguous: rows.length > 1, results: rows.map(row => withStorageMeta(row, projectClient(rowData(row)))) }
    }
    case 'client-search': {
      const rows = await query(client, SQL.clientsByName, [value, MAX_SEARCH_RESULTS])
      return { found: rows.length > 0, truncated: rows.length === MAX_SEARCH_RESULTS, results: rows.map(row => withStorageMeta(row, projectClient(rowData(row)))) }
    }
    case 'card': {
      const rows = await query(client, SQL.cardsByNormalizedNumber, [value, MAX_SEARCH_RESULTS])
      const results = []
      for (const row of rows) {
        const card = rowData(row)
        const clientRows = card.clientId ? await query(client, SQL.clientById, [String(card.clientId)]) : []
        results.push({
          card: withStorageMeta(row, projectCard(card)),
          linkedClient: clientRows[0] ? withStorageMeta(clientRows[0], projectClient(rowData(clientRows[0]))) : null,
        })
      }
      return { found: results.length > 0, ambiguous: results.length > 1, results }
    }
    case 'debt':
      return debtInspection(client, value)
    case 'sale': {
      const rows = await query(client, SQL.saleById, [value])
      return { found: rows.length > 0, ambiguous: rows.length > 1, results: rows.map(row => withStorageMeta(row, projectSale(rowData(row)))) }
    }
    case 'sale-number': {
      const rows = await query(client, SQL.salesByNumber, [String(value), MAX_SEARCH_RESULTS])
      return { found: rows.length > 0, ambiguous: rows.length > 1, truncated: rows.length === MAX_SEARCH_RESULTS, results: rows.map(row => withStorageMeta(row, projectSale(rowData(row)))) }
    }
    case 'order': {
      const rows = await query(client, SQL.orderById, [value])
      return { found: rows.length > 0, ambiguous: rows.length > 1, results: rows.map(row => withStorageMeta(row, projectOrder(rowData(row)))) }
    }
    case 'shift': {
      const rows = await query(client, SQL.shiftById, [value])
      return { found: rows.length > 0, ambiguous: rows.length > 1, results: rows.map(row => withStorageMeta(row, projectShift(rowData(row)))) }
    }
    case 'finance': {
      const rows = await query(client, SQL.financeById, [value])
      return { found: rows.length > 0, ambiguous: rows.length > 1, results: rows.map(row => withStorageMeta(row, projectFinance(rowData(row), row.collection))) }
    }
    case 'product': {
      const rows = await query(client, SQL.productById, [String(value)])
      return { found: rows.length > 0, ambiguous: rows.length > 1, results: rows.map(row => withStorageMeta(row, projectProduct(rowData(row)))) }
    }
    case 'sync-head': {
      const rows = await query(client, SQL.syncHead)
      return { found: true, ...(rows[0] || {}) }
    }
    case 'sync-entity': {
      const rows = await query(client, SQL.syncEntity, [value, second, third])
      return { found: rows.length > 0, events: rows }
    }
    default:
      throw new PolicyError('DB_COMMAND_NOT_ALLOWED')
  }
}

export async function runDatabaseCommand(spec, deps = {}) {
  assertRuntimeSqlIsReadOnly()
  const config = deps.config || await loadDbConfig(deps.configPath, deps.fs)
  const containerIp = deps.containerIp || await deps.resolveDatabaseHost?.()
  const connectionString = resolveInspectorDatabaseUrl(config.databaseUrl, containerIp)
  const poolFactory = deps.poolFactory || (async options => {
    const { Pool } = await import('pg')
    return new Pool(options)
  })
  const pool = await poolFactory({
    connectionString,
    max: 1,
    application_name: 'kakapo-server-read',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  })
  let client
  let transactionStarted = false
  try {
    client = await pool.connect()
    for (const statement of FIXED_TRANSACTION_SQL) {
      await client.query(statement)
      if (statement.startsWith('BEGIN')) transactionStarted = true
    }
    const check = (await client.query(SQL.sessionCheck)).rows?.[0] || {}
    if (check.role !== EXPECTED_DB_ROLE
        || check.database !== EXPECTED_DATABASE
        || check.read_only !== 'on'
        || check.default_read_only !== 'on') {
      throw new PolicyError('READ_ONLY_SESSION_NOT_PROVEN')
    }
    const role = (await client.query(SQL.roleGuard)).rows?.[0] || {}
    if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolinherit
        || role.rolreplication || role.rolbypassrls || !role.rolcanlogin
        || role.has_membership || role.owns_objects) {
      throw new PolicyError('INSPECTOR_ROLE_GUARD_FAILED')
    }
    const privileges = (await client.query(SQL.privilegeGuard)).rows?.[0] || {}
    if (privileges.database_create || privileges.database_temp || privileges.direct_docs_select
        || privileges.api_sessions_select || privileges.kv_meta_select
        || Number(privileges.writable_relations || 0) !== 0
        || Number(privileges.writable_sequences || 0) !== 0
        || Number(privileges.writable_schemas || 0) !== 0) {
      throw new PolicyError('INSPECTOR_PRIVILEGE_GUARD_FAILED')
    }
    const functions = (await client.query(SQL.functionGuard)).rows?.[0] || {}
    if (Number(functions.executable_count || 0) !== 0) {
      throw new PolicyError('INSPECTOR_FUNCTION_GUARD_FAILED')
    }
    const result = await executeInspection(client, spec)
    return { ok: true, command: spec.command, readOnly: true, result }
  } finally {
    if (client && transactionStarted) {
      try { await client.query('ROLLBACK') } catch { /* connection is being discarded */ }
    }
    client?.release?.(true)
    await pool?.end?.()
  }
}
