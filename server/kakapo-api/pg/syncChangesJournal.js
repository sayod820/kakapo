/**
 * L10 — Durable PG sync_changes journal (authoritative for v2 when DATABASE_URL set).
 */
import { withClient, withTransaction, isPostgresEnabled } from './client.js'

export function canUsePgJournal() {
  return isPostgresEnabled()
}

/**
 * Insert one change; BIGSERIAL allocates change_seq.
 * Idempotent when source_client_ref set (partial unique index).
 * @returns {{ changeSeq: number, createdAt: string, duplicate?: boolean }}
 */
export async function insertSyncChangePg(entry) {
  const entityType = String(entry.entityType || '').trim()
  const entityId = String(entry.entityId || '').trim()
  const action = String(entry.action || 'upsert').toLowerCase()
  if (!entityType || !entityId) {
    throw new Error('sync_changes: missing entityType/entityId')
  }
  const revision = entry.revision != null && Number.isFinite(Number(entry.revision))
    ? Number(entry.revision)
    : null
  const updatedAt = entry.updatedAt || new Date().toISOString()
  const data = entry.data === undefined ? null : entry.data
  const sourceClientRef = entry.sourceClientRef ? String(entry.sourceClientRef) : null

  return withClient(async (client) => {
    if (sourceClientRef) {
      const existing = await client.query(
        `SELECT change_seq, created_at, entity_type, entity_id, action, revision, updated_at, data, source_client_ref
         FROM sync_changes
         WHERE source_client_ref = $1 AND entity_type = $2 AND entity_id = $3 AND action = $4
         LIMIT 1`,
        [sourceClientRef, entityType, entityId, action],
      )
      if (existing.rows[0]) {
        const r = existing.rows[0]
        return {
          changeSeq: Number(r.change_seq),
          createdAt: r.created_at,
          entityType: r.entity_type,
          entityId: r.entity_id,
          action: r.action,
          revision: r.revision != null ? Number(r.revision) : null,
          updatedAt: r.updated_at,
          data: r.data,
          sourceClientRef: r.source_client_ref,
          duplicate: true,
        }
      }
    }

    const res = await client.query(
      `INSERT INTO sync_changes
        (entity_type, entity_id, action, revision, updated_at, data, source_client_ref)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7)
       RETURNING change_seq, created_at, entity_type, entity_id, action, revision, updated_at, data, source_client_ref`,
      [
        entityType,
        entityId,
        action,
        revision,
        updatedAt,
        data == null ? null : JSON.stringify(data),
        sourceClientRef,
      ],
    )
    const r = res.rows[0]
    return {
      changeSeq: Number(r.change_seq),
      createdAt: r.created_at,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      revision: r.revision != null ? Number(r.revision) : null,
      updatedAt: r.updated_at,
      data: r.data,
      sourceClientRef: r.source_client_ref,
      duplicate: false,
    }
  })
}

export async function insertSyncChangesPgBatch(entries) {
  if (!entries?.length) return []
  return withTransaction(async (client) => {
    const out = []
    for (const entry of entries) {
      const entityType = String(entry.entityType || '').trim()
      const entityId = String(entry.entityId || '').trim()
      const action = String(entry.action || 'upsert').toLowerCase()
      if (!entityType || !entityId) continue
      const revision = entry.revision != null && Number.isFinite(Number(entry.revision))
        ? Number(entry.revision)
        : null
      const updatedAt = entry.updatedAt || new Date().toISOString()
      const data = entry.data === undefined ? null : entry.data
      const sourceClientRef = entry.sourceClientRef ? String(entry.sourceClientRef) : null

      if (sourceClientRef) {
        const existing = await client.query(
          `SELECT change_seq, created_at, entity_type, entity_id, action, revision, updated_at, data, source_client_ref
           FROM sync_changes
           WHERE source_client_ref = $1 AND entity_type = $2 AND entity_id = $3 AND action = $4
           LIMIT 1`,
          [sourceClientRef, entityType, entityId, action],
        )
        if (existing.rows[0]) {
          const r = existing.rows[0]
          out.push({
            changeSeq: Number(r.change_seq),
            createdAt: r.created_at,
            entityType: r.entity_type,
            entityId: r.entity_id,
            action: r.action,
            revision: r.revision != null ? Number(r.revision) : null,
            updatedAt: r.updated_at,
            data: r.data,
            sourceClientRef: r.source_client_ref,
            duplicate: true,
          })
          continue
        }
      }

      const res = await client.query(
        `INSERT INTO sync_changes
          (entity_type, entity_id, action, revision, updated_at, data, source_client_ref)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7)
         RETURNING change_seq, created_at, entity_type, entity_id, action, revision, updated_at, data, source_client_ref`,
        [
          entityType,
          entityId,
          action,
          revision,
          updatedAt,
          data == null ? null : JSON.stringify(data),
          sourceClientRef,
        ],
      )
      const r = res.rows[0]
      out.push({
        changeSeq: Number(r.change_seq),
        createdAt: r.created_at,
        entityType: r.entity_type,
        entityId: r.entity_id,
        action: r.action,
        revision: r.revision != null ? Number(r.revision) : null,
        updatedAt: r.updated_at,
        data: r.data,
        sourceClientRef: r.source_client_ref,
        duplicate: false,
      })
    }
    return out
  })
}

export async function querySyncChangesPg(afterCursor, opts = {}) {
  const after = Math.max(0, Number(afterCursor) || 0)
  const limit = Math.max(1, Math.min(5000, Number(opts.limit) || 500))
  const scope = String(opts.scope || '').trim().toLowerCase()

  return withClient(async (client) => {
    const headRes = await client.query('SELECT COALESCE(MAX(change_seq), 0)::bigint AS head FROM sync_changes')
    const minRes = await client.query('SELECT COALESCE(MIN(change_seq), 0)::bigint AS min FROM sync_changes')
    const serverHead = Number(headRes.rows[0]?.head) || 0
    const minAvailable = Number(minRes.rows[0]?.min) || 0

    if (after > 0 && minAvailable > 0 && after + 1 < minAvailable) {
      return {
        ok: false,
        code: 'CURSOR_EXPIRED',
        error: 'CURSOR_EXPIRED',
        changes: [],
        nextCursor: after,
        hasMore: false,
        minAvailableCursor: minAvailable,
        serverHeadCursor: serverHead,
      }
    }

    // Global page first (for safe scoped cursor advance)
    const globalRes = await client.query(
      `SELECT change_seq, entity_type, entity_id, action, revision, updated_at, data, source_client_ref, created_at
       FROM sync_changes
       WHERE change_seq > $1
       ORDER BY change_seq ASC
       LIMIT $2`,
      [after, limit],
    )
    const globalRows = globalRes.rows.map(mapRow)
    const nextCursor = globalRows.length
      ? globalRows[globalRows.length - 1].changeSeq
      : after
    const countRes = await client.query(
      'SELECT COUNT(*)::int AS n FROM sync_changes WHERE change_seq > $1',
      [after],
    )
    const totalAfter = Number(countRes.rows[0]?.n) || 0
    const hasMore = totalAfter > globalRows.length

    let changes = globalRows
    if (scope === 'pos-lite' || scope === 'pos' || scope === 'sales') {
      const allow = new Set(['sale', 'shift', 'client', 'card'])
      changes = globalRows.filter((r) => allow.has(r.entityType))
    } else if (scope === 'warehouse' || scope === 'stock') {
      const allow = new Set(['product', 'receipt', 'writeoff', 'revision', 'supplier', 'stock_layer', 'category'])
      changes = globalRows.filter((r) => allow.has(r.entityType))
    } else if (scope === 'finance') {
      const allow = new Set(['finance_move', 'expense', 'shift'])
      changes = globalRows.filter((r) => allow.has(r.entityType))
    }

    return {
      ok: true,
      changes,
      nextCursor,
      hasMore,
      minAvailableCursor: minAvailable,
      serverHeadCursor: serverHead,
      protocol: 'changeSeq',
      version: 2,
      scope: scope || 'full',
    }
  })
}

export async function getSyncChangesHeadPg() {
  return withClient(async (client) => {
    const headRes = await client.query('SELECT COALESCE(MAX(change_seq), 0)::bigint AS head FROM sync_changes')
    const minRes = await client.query('SELECT COALESCE(MIN(change_seq), 0)::bigint AS min FROM sync_changes')
    return {
      serverHeadCursor: Number(headRes.rows[0]?.head) || 0,
      minAvailableCursor: Number(minRes.rows[0]?.min) || 0,
    }
  })
}

function mapRow(r) {
  return {
    changeSeq: Number(r.change_seq),
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    revision: r.revision != null ? Number(r.revision) : null,
    updatedAt: r.updated_at,
    data: r.data,
    sourceClientRef: r.source_client_ref,
    createdAt: r.created_at,
  }
}
