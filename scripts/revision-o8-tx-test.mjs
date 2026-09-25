/**
 * Step 2 — stock revisions on runBusinessMutationTx (memory atomic mode).
 * Run: node scripts/revision-o8-tx-test.mjs
 */
delete process.env.DATABASE_URL
delete process.env.KAKAPO_PG_URL

const pos = await import('../server/kakapo-api/posLogic.js')
const rc = await import('../server/kakapo-api/revisionCoordinator.js')
const h = await import('../server/kakapo-api/onlineO8Handlers.js')

pos.setRevisionCoordinator(rc)

let pass = 0
let fail = 0
async function t(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (e) {
    fail++
    console.log(`  FAIL ${name}: ${e.message}`)
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

function makeDb() {
  const db = {
    products: [{ id: 1, name: 'Молоко', stock: 0, price: 10, costPrice: 5 }],
    stockReceipts: [],
  }
  pos.ensurePosCollections(db)
  pos.setProductStockExact(db, 1, 10, { reason: 'seed' })
  return db
}

function makeCtx(db) {
  return {
    db,
    createStockRevision: (d, b) => pos.createStockRevision(d, b),
    updateStockRevision: (d, id, b) => pos.updateStockRevision(d, id, b),
    deleteStockRevision: (d, id) => pos.deleteStockRevision(d, id),
    cancelStockRevision: (d, id) => rc.cancelStockRevision(d, id),
    processRevisionQueue: (d) => rc.processRevisionQueue(d),
    auditFromReq() {},
    broadcastPosUpdate() {},
    broadcastProduct() {},
  }
}

function res() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}

async function call(handler, ctx, { body = {}, params = {} } = {}) {
  const r = res()
  await handler({ body, params, query: {}, headers: {} }, r, ctx)
  return r
}

const stock = (db) => pos.sumProductLayers(db, 1)

console.log('revision-o8-tx')

await t('create applies stock and returns durable row', async () => {
  const db = makeDb(); const ctx = makeCtx(db)
  const r = await call(h.handleO8RevisionCreate, ctx, {
    body: { clientRef: 'rev-1', note: 'утро', items: [{ productId: 1, countedStock: 7, systemStock: 10 }] },
  })
  eq(r.statusCode, 200, 'status'); eq(stock(db), 7, 'stock'); eq(db.stockRevisions.length, 1, 'rows')
  eq(r.body.replayed, false, 'replayed')
})

await t('replay same clientRef → no double apply', async () => {
  const db = makeDb(); const ctx = makeCtx(db)
  const body = { clientRef: 'rev-2', items: [{ productId: 1, countedStock: 7, systemStock: 10 }] }
  await call(h.handleO8RevisionCreate, ctx, { body })
  const r2 = await call(h.handleO8RevisionCreate, ctx, { body })
  eq(r2.statusCode, 200); eq(r2.body.replayed, true, 'replayed'); eq(stock(db), 7); eq(db.stockRevisions.length, 1)
})

await t('same clientRef, different counts → 409 IDEMPOTENCY_KEY_REUSED', async () => {
  const db = makeDb(); const ctx = makeCtx(db)
  await call(h.handleO8RevisionCreate, ctx, { body: { clientRef: 'rev-3', items: [{ productId: 1, countedStock: 7, systemStock: 10 }] } })
  const r2 = await call(h.handleO8RevisionCreate, ctx, { body: { clientRef: 'rev-3', items: [{ productId: 1, countedStock: 3, systemStock: 10 }] } })
  eq(r2.statusCode, 409); eq(r2.body.code, 'IDEMPOTENCY_KEY_REUSED'); eq(stock(db), 7)
})

await t('invalid row → 400, nothing applied (rollback)', async () => {
  const db = makeDb(); const ctx = makeCtx(db)
  const r = await call(h.handleO8RevisionCreate, ctx, {
    body: { clientRef: 'rev-4', items: [{ productId: 1, countedStock: '' }] },
  })
  eq(r.statusCode, 400); eq(stock(db), 10); eq(db.stockRevisions.length, 0)
})

await t('update re-applies; delete restores; delete replay is idempotent', async () => {
  const db = makeDb(); const ctx = makeCtx(db)
  const c = await call(h.handleO8RevisionCreate, ctx, { body: { clientRef: 'rev-5', items: [{ productId: 1, countedStock: 7, systemStock: 10 }] } })
  const id = c.body.id
  const u = await call(h.handleO8RevisionUpdate, ctx, {
    params: { id }, body: { clientRef: 'rev-5u', items: [{ productId: 1, countedStock: 8, systemStock: 10 }] },
  })
  eq(u.statusCode, 200, 'update'); eq(stock(db), 8, 'after update')
  const d = await call(h.handleO8RevisionDelete, ctx, { params: { id }, body: { clientRef: 'rev-5d' } })
  eq(d.statusCode, 200, 'delete'); eq(stock(db), 10, 'after delete'); eq(db.stockRevisions.length, 0)
  const d2 = await call(h.handleO8RevisionDelete, ctx, { params: { id }, body: { clientRef: 'rev-5d' } })
  eq(d2.statusCode, 200, 'delete replay'); eq(d2.body.replayed, true); eq(stock(db), 10)
})

await t('v2 coordinator applies pending revision in one tx + journals it', async () => {
  const db = makeDb(); const ctx = makeCtx(db)
  const c = await call(h.handleO8RevisionCreate, ctx, {
    body: { clientRef: 'rev-6', waitDevices: [], items: [{ productId: 1, countedStock: 6, systemStock: 10 }] },
  })
  eq(c.statusCode, 200); eq(c.body.status, 'pending_queues', 'pending'); eq(stock(db), 10, 'not yet applied')
  const changed = await h.runO8RevisionCoordinatorTx(ctx)
  eq(changed, true, 'changed')
  eq(db.stockRevisions[0].status, 'done', 'status'); eq(stock(db), 6, 'applied')
  const journal = JSON.stringify(db.syncChangeLog || []) + JSON.stringify(db._pendingSyncChanges || [])
  eq(journal.includes(c.body.id), true, 'revision in sync journal')
  eq(await h.runO8RevisionCoordinatorTx(ctx), false, 'idle second run')
})

await t('v2 waits for device queue', async () => {
  const db = makeDb(); const ctx = makeCtx(db)
  await call(h.handleO8RevisionCreate, ctx, {
    body: { clientRef: 'rev-7', waitDevices: [{ deviceId: 'D1', posId: 'P1' }], items: [{ productId: 1, countedStock: 6, systemStock: 10 }] },
  })
  await h.runO8RevisionCoordinatorTx(ctx)
  eq(db.stockRevisions[0].status, 'pending_queues'); eq(stock(db), 10)
  rc.recordDeviceHeartbeat(db, { deviceId: 'D1', posId: 'P1', queueLen: 0, queueFlushed: true })
  await h.runO8RevisionCoordinatorTx(ctx)
  eq(db.stockRevisions[0].status, 'done'); eq(stock(db), 6)
})

await t('cancel pending revision', async () => {
  const db = makeDb(); const ctx = makeCtx(db)
  const c = await call(h.handleO8RevisionCreate, ctx, {
    body: { clientRef: 'rev-8', waitDevices: [{ deviceId: 'D9', posId: 'P9' }], items: [{ productId: 1, countedStock: 6, systemStock: 10 }] },
  })
  const x = await call(h.handleO8RevisionCancel, ctx, { params: { id: c.body.id } })
  eq(x.statusCode, 200); eq(x.body.status, 'cancelled'); eq(stock(db), 10)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
