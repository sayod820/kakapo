/**
 * FIX D safety — same sale clientRef across TWO independent process caches.
 * Simulates future UNIQUE on posSales/moneyLedger/opRefs (no orders UNIQUE).
 *
 * Run: node scripts/fixd-cross-process-sale-sideeffects-test.mjs
 * Does NOT apply production migration.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')

const {
  findInMemoryUniqueConflict,
  makePgUniqueViolationError,
  classifyUniqueViolation,
  applyIdempotencyConflictsToSnapshot,
} = await import(pathToFileURL(path.join(apiRoot, 'pg', 'uniqueIdempotency.js')).href)
const { rowIdForItem } = await import(pathToFileURL(path.join(apiRoot, 'pg', 'store.js')).href)
const { createPosSale, createClientOrderFromPosSale } = await import(
  pathToFileURL(path.join(apiRoot, 'posLogic.js')).href
)
const { completePosSaleOnlineLoyalty } = await import(
  pathToFileURL(path.join(apiRoot, 'loyaltyBonus.js')).href
)

function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

function clone(x) {
  return structuredClone(x)
}

function baseDb() {
  return {
    products: [
      {
        id: 1,
        name: 'Test Tea',
        price: 100,
        stock: 10,
        unit: 'шт',
        sellType: 'piece',
        art: 'T1',
        e: '🍵',
      },
    ],
    stockReceipts: [{
      id: 'RCP1',
      items: [{ productId: 1, qty: 10, remainingQty: 10, unitCost: 50 }],
    }],
    cashiers: [{ id: 'C1', name: 'Cashier', salesCount: 0, salesTotal: 0 }],
    posShifts: [{
      id: 'SH1',
      status: 'open',
      posId: 'POS1',
      cashierId: 'C1',
      cashierName: 'Cashier',
      salesCount: 0,
      salesCash: 0,
      salesCard: 0,
      salesCredit: 0,
      salesWallet: 0,
    }],
    posPoints: [{ id: 'POS1', name: 'Main' }],
    posSales: [],
    moneyLedger: [],
    financeMoves: [],
    opRefs: [],
    orders: [],
    clients: [{
      id: 'CL1',
      name: 'Client',
      phone: '+992900000001',
      card: 'CARD1',
      bonus: 100,
      debt: 0,
      wallet: 0,
      level: 'bronze',
    }],
    cards: [{
      num: 'CARD1',
      phone: '+992900000001',
      clientId: 'CL1',
      client: 'Client',
      bonus: 100,
      debt: 0,
      wallet: 0,
      debtPayVersion: 0,
      bonusPayVersion: 0,
    }],
    cashVault: { cashTotal: 0, cardTotal: 0, vaultVersion: 0, transfers: [], converts: [] },
    settings: {
      loyalty: {
        welcomeBonus: 0,
        bronze: { bonusPercent: 5 },
        basic: { bonusPercent: 0 },
        silver: { bonusPercent: 2 },
        gold: { bonusPercent: 3 },
        platinum: { bonusPercent: 5 },
        vip: { bonusPercent: 5 },
      },
    },
    _seq: { order: 1000, product: 1, category: 1, posSale: 0 },
    stockLayers: [],
  }
}

function hooksFor(db) {
  return {
    findCardByNum: (num) => (db.cards || []).find(c => String(c.num) === String(num)) || null,
    ensureCardRowForClient: (client) => {
      const num = String(client.card || '').trim()
      if (!num) return null
      let card = (db.cards || []).find(c => String(c.num) === num)
      if (!card) {
        card = { num, phone: client.phone, clientId: client.id, bonus: client.bonus || 0, debt: 0, wallet: 0 }
        db.cards.push(card)
      }
      return card
    },
    syncClientFromCardRow: (card) => {
      const client = (db.clients || []).find(c =>
        c.card === card.num || (card.phone && c.phone === card.phone),
      )
      if (client) client.bonus = card.bonus
    },
  }
}

/** Shared PG-like docs with FIX D UNIQUE (sales/ledger/opRefs/financeMoves only). */
function createSharedPg() {
  const docs = new Map()
  const pk = (c, id) => `${c}\0${id}`

  function all() {
    return [...docs.values()]
  }

  function persist(snapshot) {
    const conflicts = []
    const docRows = []
    for (const [col, value] of Object.entries(snapshot || {})) {
      if (!Array.isArray(value)) continue
      const used = new Set()
      for (let i = 0; i < value.length; i++) {
        let id = rowIdForItem(value[i], i)
        if (value[i]?.id != null && String(value[i].id) !== '') id = String(value[i].id)
        // prefer real id when present (sales/orders/ledger)
        if (value[i]?.id != null && String(value[i].id) !== '') id = String(value[i].id)
        if (used.has(id)) id = `${id}#${i}`
        used.add(id)
        docRows.push({ key: col, id, data: value[i], sortIdx: i })
      }
    }
    for (const r of docRows) {
      const conflict = findInMemoryUniqueConflict(all(), r.key, r.id, r.data)
      if (conflict) {
        const err = makePgUniqueViolationError(conflict.constraint)
        const classified = classifyUniqueViolation(err)
        expect(classified?.known, `known 23505 for ${r.key}`)
        const existing = docs.get(pk(conflict.collection, conflict.existingId))
        conflicts.push({
          constraint: conflict.constraint,
          collection: conflict.collection,
          attemptedId: r.id,
          attemptedData: r.data,
          existingId: existing.id,
          existingData: existing.data,
        })
        continue
      }
      const k = pk(r.key, r.id)
      const prev = docs.get(k)
      if (prev) docs.set(k, { ...prev, data: clone(r.data) })
      else docs.set(k, { collection: r.key, id: r.id, data: clone(r.data), sortIdx: r.sortIdx })
    }
    applyIdempotencyConflictsToSnapshot(snapshot, conflicts)
    return { conflicts }
  }

  function count(col) {
    return all().filter(r => r.collection === col).length
  }

  function list(col) {
    return all().filter(r => r.collection === col).map(r => r.data)
  }

  return { persist, count, list }
}

function rememberOpRef(db, kind, clientRef, result) {
  const ref = String(clientRef || '').trim()
  if (!ref) return
  if (!Array.isArray(db.opRefs)) db.opRefs = []
  const idx = db.opRefs.findIndex(r => r.clientRef === ref && r.kind === kind)
  const row = { clientRef: ref, kind, result, createdAtIso: new Date().toISOString() }
  if (idx >= 0) db.opRefs[idx] = row
  else db.opRefs.push(row)
}

/**
 * Mirror POST /pos/sales critical path on one process cache, then flush to shared PG.
 */
function runSaleOnProcess(db, body, sharedPg) {
  const clientRef = String(body.clientRef || '').trim()
  const dup = (db.posSales || []).find(s => s.clientRef === clientRef)
  if (dup) return { sale: dup, replay: true, conflicts: [] }

  const sale = createPosSale(db, body)
  const saleReplay = !!sale._idempotentReplay
  if (saleReplay) delete sale._idempotentReplay

  let order = null
  if (sale.clientPhone) {
    const lr = completePosSaleOnlineLoyalty(db, sale, body, hooksFor(db), {
      createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
    })
    expect(lr.ok, lr.error || 'loyalty ok')
    order = lr.order
  }
  if (clientRef && !saleReplay) {
    rememberOpRef(db, 'pos_sale', clientRef, { id: sale.id, orderId: sale.orderId })
  }

  // await flushDbAsync equivalent — UNIQUE reconcile for sale/ledger/opRef only
  const { conflicts } = sharedPg.persist({
    posSales: db.posSales,
    moneyLedger: db.moneyLedger,
    financeMoves: db.financeMoves || [],
    opRefs: db.opRefs,
    orders: db.orders,
    products: db.products,
    cards: db.cards,
    clients: db.clients,
  })

  const canonical = clientRef
    ? (db.posSales || []).find(s => String(s.clientRef || '').trim() === clientRef) || sale
    : sale

  return { sale: canonical, localSaleId: sale.id, order, conflicts, replay: saleReplay }
}

const REF = 'CROSS-PROC-SALE-1'
const body = {
  clientRef: REF,
  cashierId: 'C1',
  shiftId: 'SH1',
  posId: 'POS1',
  clientPhone: '+992900000001',
  clientName: 'Client',
  cardNum: 'CARD1',
  paymentMethod: 'cash',
  paidCash: 90,
  bonusSpent: 10,
  orderGoodsTotal: 100,
  items: [{ productId: 1, qty: 1, price: 100 }],
}

const seed = baseDb()
const processA = clone(seed)
const processB = clone(seed)
// Independent processes do not share _seq — force divergent order ids
processB._seq.order = 5000
const shared = createSharedPg()

// Concurrent: A then B (both loaded same seed — classic dual-process race)
const outA = runSaleOnProcess(processA, body, shared)
const outB = runSaleOnProcess(processB, body, shared)

const sales = shared.list('posSales')
const ledgers = shared.list('moneyLedger')
const orders = shared.list('orders')
const opRefs = shared.list('opRefs')
const cards = shared.list('cards')
const ledgerByType = {}
for (const L of ledgers) {
  const t = String(L.type || '')
  ledgerByType[t] = (ledgerByType[t] || 0) + 1
}

const ordersForSale = orders.filter(o =>
  String(o.posSaleClientRef || '') === REF
  || sales.some(s => String(s.id) === String(o.posSaleId || '')),
)

const cardFinal = cards.find(c => c.num === 'CARD1') || processB.cards[0]
const bonusEnd = Number(cardFinal?.bonus)
const bonusDelta = 100 - bonusEnd

// Loyalty applied independently in each process memory before flush
const loyaltySpendEvents = [processA, processB].map((db, i) => ({
  process: i === 0 ? 'A' : 'B',
  ordersWithSpend: (db.orders || []).filter(o => o.bonusSpendApplied).length,
  ordersWithEarn: (db.orders || []).filter(o => o.bonusCredited).length,
  cardBonusInMemory: Number((db.cards || []).find(c => c.num === 'CARD1')?.bonus),
}))

const report = {
  title: 'FIX D cross-process same clientRef side-effect audit',
  generatedAtIso: new Date().toISOString(),
  productionMigrationApplied: false,
  sequence: [
    'POST /pos/sales',
    'in-memory find by clientRef (miss on both processes)',
    'createPosSale → new SALE-id + moneyLedger + stock/shift (+ debt/wallet if any)',
    'completePosSaleOnlineLoyalty → createClientOrderFromPosSale + applyBonusSpendOnOrder + applyClientLoyaltyAfterDelivery',
    'rememberOpRef(pos_sale)',
    'await flushDbAsync → UNIQUE reconcile sale/ledger/opRef only (orders NOT covered)',
    'res.json(canonical sale from memory after reconcile)',
  ],
  measured: {
    posSales: sales.length,
    durableSaleIds: sales.map(s => s.id),
    moneyLedgerTotal: ledgers.length,
    moneyLedgerByType: ledgerByType,
    ordersTotal: orders.length,
    ordersForSameSaleRef: ordersForSale.length,
    orderIds: ordersForSale.map(o => o.id),
    posSaleIdsOnOrders: ordersForSale.map(o => o.posSaleId),
    orphanOrderRefsToMissingSale: ordersForSale.filter(o =>
      !sales.some(s => String(s.id) === String(o.posSaleId || '')),
    ).map(o => ({ orderId: o.id, posSaleId: o.posSaleId })),
    opRefsPosSale: opRefs.filter(r => r.kind === 'pos_sale' && r.clientRef === REF).length,
    processASaleId: outA.localSaleId,
    processBSaleId: outB.localSaleId,
    memorySalesAfterFlushA: (processA.posSales || []).map(s => s.id),
    memorySalesAfterFlushB: (processB.posSales || []).map(s => s.id),
    conflictsB: outB.conflicts.map(c => c.constraint),
    bonusStart: 100,
    bonusEndDurableOrMemory: bonusEnd,
    bonusDeltaFromStart: bonusDelta,
    loyaltySpendEvents,
    bothOrdersMarkedSpend: ordersForSale.length > 0 && ordersForSale.every(o => o.bonusSpendApplied === true),
    bothOrdersMarkedEarn: ordersForSale.length > 0 && ordersForSale.every(o => o.bonusCredited === true),
  },
  verdict: {},
}

report.verdict.saleProtectedByUnique = sales.length === 1
report.verdict.ledgerProtectedByUnique = Object.values(ledgerByType).every(n => n === 1)
report.verdict.opRefProtectedByUnique =
  opRefs.filter(r => r.kind === 'pos_sale' && r.clientRef === REF).length <= 1
report.verdict.orderDuplicateGap = ordersForSale.length > 1
report.verdict.loyaltyMarkerCrossProcessInsufficient = ordersForSale.length > 1
  && ordersForSale.every(o => o.bonusSpendApplied)
report.verdict.idealOneSaleOneLedgerOneOrderOneLoyalty =
  sales.length === 1
  && ordersForSale.length === 1
  && Object.values(ledgerByType).every(n => n === 1)
  && !report.verdict.loyaltyMarkerCrossProcessInsufficient

report.highGaps = []
if (report.verdict.orderDuplicateGap) {
  report.highGaps.push({
    severity: 'HIGH',
    name: 'MULTI-PROCESS DUPLICATE ORDER GAP',
    detail:
      'orders has no DB UNIQUE on posSaleClientRef/posSaleId; FIX C no-prune keeps both; '
      + 'createClientOrderFromPosSale dedupe is in-memory only per process.',
    fields: ['orders.id', 'orders.posSaleId', 'orders.posSaleClientRef'],
    writePath: 'completePosSaleOnlineLoyalty → createClientOrderFromPosSale → db.orders.push',
  })
}
if (report.verdict.loyaltyMarkerCrossProcessInsufficient) {
  report.highGaps.push({
    severity: 'HIGH',
    name: 'LOYALTY MARKERS NOT CROSS-PROCESS',
    detail:
      'bonusSpendApplied / bonusCredited live on order docs; each process creates its own order '
      + 'and applies spend/earn before flush. Markers are single-process only. '
      + 'Balance+marker are not atomic with posSales UNIQUE in one DB transaction.',
  })
}

const outPath = path.join(root, 'scripts', 'fixd-cross-process-sale-sideeffects-report.json')
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

console.log('FIX D cross-process sale side-effects audit')
console.log(JSON.stringify(report.measured, null, 2))
console.log('verdict:', JSON.stringify(report.verdict, null, 2))
console.log('highGaps:', report.highGaps.map(g => g.name).join(', ') || 'none')
console.log(`Report: ${outPath}`)

if (!report.verdict.idealOneSaleOneLedgerOneOrderOneLoyalty) {
  console.log('STOP: order and/or loyalty duplicates under dual-process same clientRef')
  process.exitCode = 2
}
