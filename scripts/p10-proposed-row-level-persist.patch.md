# PROPOSED (NOT APPLIED) — row-level persist for append collections

## Goal
Keep `docs(collection,id,data JSONB)`. Change semantics for append collections:
- UPSERT rows present in the write
- Do **not** `DELETE ... NOT (id = ANY(...))` for those collections

## Suggested API in `pg/store.js` (sketch)

```js
export const APPEND_COLLECTIONS = new Set([
  'posSales', 'moneyLedger', 'financeMoves', 'opRefs',
  'orders', 'expenses', 'stockReceipts', 'writeOffs',
])

async function upsertDocRows(client, docRows) {
  // same INSERT ... ON CONFLICT DO UPDATE batch as today
}

async function deleteMissingIds(client, collection, ids) {
  // ONLY call for mutable collections when prune explicitly requested
  await client.query(
    'DELETE FROM docs WHERE collection = $1 AND NOT (id = ANY($2::text[]))',
    [collection, ids],
  )
}

export async function saveSnapshotToPg(client, snapshot, opts = {}) {
  const pruneMissing = opts.pruneMissing !== false // default true for compat
  // build docRows as today
  await upsertDocRows(client, docRows)
  if (!pruneMissing) return
  for (const col of collections) {
    if (APPEND_COLLECTIONS.has(col)) continue // CRITICAL: never prune append
    await deleteMissingIds(client, col, idsFor(col))
  }
}
```

## Call site
`persistSnapshot(cache, { pruneMissing: true })` until cutover.
Then `db.js` flush for monetary ops uses pruneMissing false for append sets,
or better: `upsertDocsBatch('posSales', [sale])` without full snapshot.

## Explicit delete
```js
export async function deleteDoc(collection, id) {
  await withTransaction(async client => {
    await client.query('DELETE FROM docs WHERE collection=$1 AND id=$2', [collection, id])
  })
}
```

## NOT in this change
- UNIQUE indexes
- Multi-replica
- Wallet OCC
- Normalizing returns out of posSales
