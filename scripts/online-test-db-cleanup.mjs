/**
 * Shared PG cleanup for ONLINE regression (test isolation only).
 *
 * Product-id strategy (R1F):
 * - Production still uses numeric ++db._seq.product from the API.
 * - Tests keep using POST /products (numeric ids).
 * - Relationship-aware cleanup deletes ALL stockReceipts/writeOffs/sales/etc.
 *   whose items reference fixture productIds BEFORE deleting those products.
 * - Optional lab TRUNCATE (guarded) for clean-chain runs.
 * - Orphan receipt purge removes layers whose productId has no product doc
 *   (test DB only — prevents numeric id reuse attaching ghost qty).
 */
import { withClient, isPostgresEnabled, getDatabaseUrl } from '../server/kakapo-api/pg/client.js'

export const ONLINE_TEST_PREFIXES = [
  'O8A-', 'O1-', 'O1B-', 'O2-', 'O2B-', 'O3-', 'O3B-', 'O3C-', 'O4-', 'O4B-', 'O4C-', 'O4D-', 'O4E-', 'O5-', 'O5B-', 'O6-', 'O6B-', 'O7-',
  'O8AUTH-', 'O8BAUTH-', 'O9-', 'L13-',
]

const ALLOWED_TEST_DB = /^kakapo_l11_test(_[a-z0-9]+)?$/i

/** Lab main till seed — tests open shifts with openingCash up to ~1M without production semantics. */
const LAB_CASH_VAULT = {
  cashTotal: 10_000_000,
  cardTotal: 1_000_000,
  transfers: [],
  converts: [],
  vaultVersion: 0,
}

export async function bootstrapTestLabCashVault() {
  if (!isPostgresEnabled()) return
  await assertTestDatabaseAllowed()
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO kv_meta (key, value, updated_at) VALUES ('cashVault', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(LAB_CASH_VAULT)],
    )
  })
}

/** @returns {Promise<{ db: string, user: string, allowed: boolean }>} */
export async function getTestDatabaseIdentity() {
  return withClient(async (c) => {
    const db = (await c.query('SELECT current_database() AS db, current_user AS usr')).rows[0]
    const name = String(db?.db || '')
    return {
      db: name,
      user: String(db?.usr || ''),
      allowed: ALLOWED_TEST_DB.test(name),
    }
  })
}

export function assertTestDatabaseAllowedSync(dbName) {
  if (!ALLOWED_TEST_DB.test(String(dbName || ''))) {
    throw new Error(
      `Refusing test DB mutation: database "${dbName}" is not an allowed lab name (kakapo_l11_test or kakapo_l11_test_*)`,
    )
  }
}

export async function assertTestDatabaseAllowed() {
  if (!isPostgresEnabled()) return null
  const id = await getTestDatabaseIdentity()
  if (!id.allowed) {
    throw new Error(
      `Refusing test DB mutation on "${id.db}" (user ${id.user}). `
        + `Set DATABASE_URL to kakapo_l11_test or kakapo_l11_test_*`,
    )
  }
  return id
}

async function resolveProductIdsForPrefix(c, prefix) {
  const refLike = `${prefix}%`
  const blobLike = `%${prefix}%`
  const q = await c.query(
    `SELECT id FROM docs WHERE collection='products' AND (
       data->>'name' LIKE $1
       OR data->>'clientRef' LIKE $1
       OR data::text LIKE $2
     )`,
    [refLike, blobLike],
  )
  return [...new Set(q.rows.map(r => String(r.id)))]
}

/** Delete docs in collection where JSON items[].productId or productId field matches. */
async function deleteByProductIdGraph(c, collection, productIds, { itemsPath = true, scalarField = null } = {}) {
  if (!productIds.length) return 0
  const ids = productIds
  if (itemsPath) {
    const r = await c.query(
      `DELETE FROM docs d
       WHERE d.collection = $1
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(d.data->'items', '[]'::jsonb)) it
         WHERE (it->>'productId') = ANY($2::text[])
       )`,
      [collection, ids],
    )
    return r.rowCount || 0
  }
  if (scalarField) {
    const r = await c.query(
      `DELETE FROM docs WHERE collection=$1 AND (data->>$3) = ANY($2::text[])`,
      [collection, ids, scalarField],
    )
    return r.rowCount || 0
  }
  return 0
}

/**
 * Receipt/layer rows whose productId no longer exists (numeric reuse ghost source).
 * Test DB only — does not touch named legacy products that still have docs.
 */
export async function purgeOrphanStockReceiptLayers() {
  if (!isPostgresEnabled()) return { deleted: 0 }
  await assertTestDatabaseAllowed()
  return withClient(async (c) => {
    const r = await c.query(`
      DELETE FROM docs d
      WHERE d.collection = 'stockReceipts'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(d.data->'items', '[]'::jsonb)) it
        WHERE (it->>'productId') IS NOT NULL
        AND (it->>'productId') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM docs p
          WHERE p.collection = 'products'
          AND p.id = (it->>'productId')
        )
      )
    `)
    return { deleted: r.rowCount || 0 }
  })
}

export async function cleanupOnlineTestPrefixes(prefixes = ONLINE_TEST_PREFIXES) {
  if (!isPostgresEnabled()) return
  await assertTestDatabaseAllowed()

  for (const PREFIX of prefixes) {
    await withClient(async (c) => {
      const refLike = `${PREFIX}%`
      const blobLike = `%${PREFIX}%`

      const productIds = await resolveProductIdsForPrefix(c, PREFIX)

      // ——— Graph by fixture productId (fixes L11C clientRef + O3 productId reuse) ———
      for (const col of ['stockReceipts', 'writeOffs', 'posSales']) {
        await deleteByProductIdGraph(c, col, productIds)
      }
      if (productIds.length) {
        await c.query(
          `DELETE FROM docs WHERE collection='stockAdjustments' AND (data->>'productId') = ANY($1::text[])`,
          [productIds],
        )
      }
      // sales returns live inside posSales doc — covered by posSales delete when whole sale matches;
      // productId graph delete handles items on sales.

      // sync_changes: source_client_ref AND entity_id tied to prefix docs (stale row → idempotency_idx collision)
      await c.query('DELETE FROM sync_changes WHERE source_client_ref LIKE $1', [refLike])
      await c.query(
        `DELETE FROM sync_changes sc
         WHERE sc.entity_id IN (
           SELECT d.id FROM docs d
           WHERE d.data->>'clientRef' LIKE $1 OR d.data::text LIKE $2
              OR d.data->>'name' LIKE $1 OR d.data->>'num' LIKE $1
         )`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM sync_changes sc
         WHERE sc.entity_id IN (
           SELECT d.id FROM docs d WHERE d.collection IN (
             'clients','cards','posSales','posShifts','products','orders','stockReceipts'
           ) AND (d.data->>'clientRef' LIKE $1 OR d.data::text LIKE $2 OR d.data->>'name' LIKE $1)
         )`,
        [refLike, blobLike],
      )

      // Prefix-scoped rows (clientRef / blob)
      await c.query(
        `DELETE FROM docs WHERE collection='stockReceipts' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='writeOffs' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='posSales' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='orders' AND (
          data->>'posSaleClientRef' LIKE $1 OR data->>'clientRef' LIKE $1 OR data::text LIKE $2
        )`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='clients' AND (
          data->>'name' LIKE $1 OR data->>'phone' LIKE $1 OR data::text LIKE $2
        )`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='cards' AND (data->>'num' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='stockAdjustments' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='suppliers' AND (data->>'name' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='financeMoves' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='expenses' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='moneyLedger' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='supplierPayments' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(
        `DELETE FROM docs WHERE collection='posShifts' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
      await c.query(`DELETE FROM docs WHERE data->>'clientRef' LIKE $1`, [refLike])
      await c.query(`DELETE FROM docs WHERE id LIKE $1`, [`op:%${PREFIX}%`])

      // Products last (after graph detach)
      await c.query(`DELETE FROM docs WHERE collection='products' AND data->>'name' LIKE $1`, [refLike])
      await c.query(
        `DELETE FROM docs WHERE collection='products' AND (data->>'clientRef' LIKE $1 OR data::text LIKE $2)`,
        [refLike, blobLike],
      )
    })
  }

  await withClient(async (c) => {
    await c.query(`DELETE FROM docs WHERE collection='posShifts' AND data->>'status'='open'`)
  })

  await purgeOrphanStockReceiptLayers()
  // Open-shift deletes skip vault float return; re-seed lab till for next suite.
  await bootstrapTestLabCashVault()
}

/**
 * TRUNCATE lab tables — only allowed test DB names.
 * Use CLEAN_RUN=1 before full regression chain.
 */
export async function truncateTestLabDatabase() {
  if (!isPostgresEnabled()) return
  const id = await assertTestDatabaseAllowed()
  const url = getDatabaseUrl()
  if (/prod|production|live|main/i.test(url) && !id.allowed) {
    throw new Error('Refusing truncate: DATABASE_URL looks non-lab')
  }
  await withClient(async (c) => {
    await c.query('TRUNCATE TABLE sync_changes')
    await c.query('TRUNCATE TABLE docs')
    await c.query('TRUNCATE TABLE kv_meta')
  })
  await bootstrapTestLabCashVault()
}

/** Zombie layers: fixture prefix must start with zero products and zero prefix-tagged receipts. */
export async function assertStockFixtureBaselineClean(prefix) {
  if (!isPostgresEnabled()) return { ok: true, issues: [] }
  await assertTestDatabaseAllowed()
  const refLike = `${prefix}%`
  const blobLike = `%${prefix}%`
  const issues = []

  await withClient(async (c) => {
    const prods = await c.query(
      `SELECT id, data->>'name' AS name FROM docs WHERE collection='products' AND data->>'name' LIKE $1`,
      [refLike],
    )
    if (prods.rows.length) {
      issues.push({ kind: 'products_remain', rows: prods.rows })
    }

    const recs = await c.query(
      `SELECT d.id, d.data->>'clientRef' AS client_ref,
              it->>'productId' AS product_id,
              it->>'remainingQty' AS remaining,
              COALESCE(d.data->>'stockAdjustment','false') AS stock_adj
       FROM docs d, jsonb_array_elements(COALESCE(d.data->'items','[]'::jsonb)) it
       WHERE d.collection='stockReceipts'
       AND (
         d.data->>'clientRef' LIKE $1 OR d.data::text LIKE $2
         OR EXISTS (
           SELECT 1 FROM docs p WHERE p.collection='products' AND p.id = (it->>'productId')
           AND p.data->>'name' LIKE $1
         )
       )`,
      [refLike, blobLike],
    )
    for (const row of recs.rows) {
      issues.push({
        kind: 'receipt_layer',
        reason: 'prefix_linked_receipt_or_product',
        productId: row.product_id,
        receiptId: row.id,
        remainingQty: row.remaining,
        stockAdjustment: row.stock_adj,
        clientRef: row.client_ref,
      })
    }

    const orphans = await c.query(`
      SELECT d.id AS receipt_id, d.data->>'clientRef' AS client_ref,
             it->>'productId' AS product_id,
             it->>'remainingQty' AS remaining,
             COALESCE(d.data->>'stockAdjustment','false') AS stock_adj,
             d.data->>'createdAtIso' AS created_at_iso
      FROM docs d
      JOIN LATERAL jsonb_array_elements(COALESCE(d.data->'items','[]'::jsonb)) it ON true
      LEFT JOIN docs p ON p.collection='products' AND p.id = (it->>'productId')
      WHERE d.collection='stockReceipts'
      AND p.id IS NULL
      AND COALESCE((it->>'remainingQty')::float, 0) > 0.001
    `)
    for (const row of orphans.rows) {
      issues.push({
        kind: 'orphan_layer',
        reason: 'product_doc_missing_numeric_id_reuse_risk',
        productId: row.product_id,
        receiptId: row.receipt_id,
        remainingQty: row.remaining,
        stockAdjustment: row.stock_adj,
        clientRef: row.client_ref,
        createdAtIso: row.created_at_iso,
      })
    }
  })

  if (issues.length) {
    const err = new Error(`ZOMBIE_STOCK_FIXTURE: prefix ${prefix} baseline not clean`)
    err.code = 'ZOMBIE_STOCK_FIXTURE'
    err.issues = issues
    throw err
  }
  return { ok: true, issues: [] }
}

/** Post-chain sweep for test namespaces. */
export async function postChainOrphanSweep(prefixes = ONLINE_TEST_PREFIXES) {
  if (!isPostgresEnabled()) return { orphanTestLayers: [], prefixLeaks: [] }
  await assertTestDatabaseAllowed()
  const orphan = await withClient(async (c) => {
    const q = await c.query(`
      SELECT d.id AS receipt_id, d.data->>'clientRef' AS client_ref,
             it->>'productId' AS product_id,
             (it->>'remainingQty')::float AS remaining,
             COALESCE(d.data->>'stockAdjustment','false') AS stock_adj,
             p.id IS NULL AS product_missing,
             p.data->>'name' AS product_name
      FROM docs d
      JOIN LATERAL jsonb_array_elements(COALESCE(d.data->'items','[]'::jsonb)) it ON true
      LEFT JOIN docs p ON p.collection='products' AND p.id = (it->>'productId')
      WHERE d.collection='stockReceipts'
      AND (it->>'remainingQty')::float > 0.001
    `)
    return q.rows
  })

  const prefixLeaks = []
  for (const PREFIX of prefixes) {
    const refLike = `${PREFIX}%`
    const hits = orphan.filter(r =>
      (r.client_ref || '').startsWith(PREFIX)
      || (r.product_name || '').startsWith(PREFIX),
    )
    prefixLeaks.push({ prefix: PREFIX, count: hits.length, sample: hits.slice(0, 3) })
  }

  const orphanTestLayers = orphan.filter(r => r.product_missing)
  return { orphanTestLayers, prefixLeaks, allLayers: orphan.length }
}
