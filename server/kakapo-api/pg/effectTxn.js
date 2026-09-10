'use strict'

/**
 * FIX E.2 — transactional POS effect completion (order / bonus spend / earn).
 *
 * Guarantee: claim insert + business mutation + claim=done are ONE PostgreSQL
 * transaction (or one memory txn for tests/json). No durable `pending` committed
 * before mutation. Crash → ROLLBACK → missing claim OR done+applied once.
 *
 * Authoritative loyalty balance: cards.bonus (clients.bonus mirrored in same txn).
 */

import { withClient, isPostgresEnabled } from './client.js'
import {
  POS_EFFECT_KINDS,
  posEffectDocId,
  buildPosEffectPayload,
} from './idempotentClaim.js'
import { rowIdForItem } from './store.js'

export class EffectTxnFail extends Error {
  constructor(point) {
    super(`FIXE2_FAIL_${point}`)
    this.point = point
    this.code = 'FIXE2_INJECTED_FAIL'
  }
}

export function cardDocId(card) {
  if (!card) return ''
  if (card.id != null && String(card.id) !== '') return String(card.id)
  const num = String(card.num || '').trim()
  return num ? `num:${num}` : ''
}

export function clientDocId(client) {
  if (!client) return ''
  return String(client.id || rowIdForItem(client, 0) || '')
}

function orderDocId(order) {
  return String(order?.id || '')
}

/** Shared in-memory docs + serialized txns (simulates PG atomicity for tests). */
export function createMemoryEffectBackend() {
  /** @type {Map<string, { collection: string, id: string, data: any, sort_idx: number }>} */
  const docs = new Map()
  let chain = Promise.resolve()
  const pk = (c, id) => `${c}\0${id}`

  return {
    kind: 'memory',
    docs,
    async runTransaction(fn, { failAt } = {}) {
      const run = async () => {
        /** @type {Map<string, any>} */
        const undo = new Map()
        const touch = (k) => {
          if (!undo.has(k)) undo.set(k, docs.has(k) ? structuredClone(docs.get(k)) : null)
        }
        const fail = (point) => {
          if (failAt && failAt === point) throw new EffectTxnFail(point)
        }
        const client = {
          fail,
          async upsert(collection, id, data, sortIdx = 0) {
            const k = pk(collection, id)
            touch(k)
            docs.set(k, { collection, id, data: structuredClone(data), sort_idx: sortIdx })
          },
          async insertIgnore(collection, id, data, sortIdx = 0) {
            const k = pk(collection, id)
            if (docs.has(k)) return false
            touch(k)
            docs.set(k, { collection, id, data: structuredClone(data), sort_idx: sortIdx })
            return true
          },
          async selectForUpdate(collection, id) {
            const row = docs.get(pk(collection, id))
            return row ? { id: row.id, data: structuredClone(row.data), sort_idx: row.sort_idx } : null
          },
          async selectOrdersByPosSaleClientRef(ref) {
            const out = []
            for (const row of docs.values()) {
              if (row.collection !== 'orders') continue
              if (String(row.data?.posSaleClientRef || '').trim() === ref) {
                out.push({ id: row.id, data: structuredClone(row.data), sort_idx: row.sort_idx })
              }
            }
            return out
          },
        }
        try {
          const result = await fn(client)
          fail('before_commit')
          return result
        } catch (e) {
          for (const [k, prev] of undo) {
            if (prev == null) docs.delete(k)
            else docs.set(k, prev)
          }
          throw e
        }
      }
      const p = chain.then(run, run)
      chain = p.then(() => {}, () => {})
      return p
    },
    seed(collection, id, data, sortIdx = 0) {
      docs.set(pk(collection, id), { collection, id, data: structuredClone(data), sort_idx: sortIdx })
    },
    get(collection, id) {
      const row = docs.get(pk(collection, id))
      return row ? structuredClone(row.data) : null
    },
    list(collection) {
      return [...docs.values()].filter(r => r.collection === collection).map(r => structuredClone(r.data))
    },
  }
}

function createPgClientAdapter(pgClient) {
  return {
    async upsert(collection, id, data, sortIdx = 0) {
      await pgClient.query(
        `INSERT INTO docs (collection, id, data, sort_idx, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET
           data = EXCLUDED.data,
           sort_idx = EXCLUDED.sort_idx,
           updated_at = NOW()`,
        [collection, id, JSON.stringify(data ?? null), sortIdx],
      )
    },
    async insertIgnore(collection, id, data, sortIdx = 0) {
      const res = await pgClient.query(
        `INSERT INTO docs (collection, id, data, sort_idx, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (collection, id) DO NOTHING
         RETURNING id`,
        [collection, id, JSON.stringify(data ?? null), sortIdx],
      )
      return res.rowCount > 0
    },
    async selectForUpdate(collection, id) {
      const res = await pgClient.query(
        `SELECT id, data, sort_idx FROM docs
         WHERE collection = $1 AND id = $2
         FOR UPDATE`,
        [collection, id],
      )
      return res.rows[0] || null
    },
    async selectOrdersByPosSaleClientRef(ref) {
      const res = await pgClient.query(
        `SELECT id, data, sort_idx FROM docs
         WHERE collection = 'orders'
           AND NULLIF(BTRIM(data->>'posSaleClientRef'), '') = $1
         FOR UPDATE`,
        [ref],
      )
      return res.rows
    },
  }
}

/**
 * Lock-or-create claim inside an open transaction.
 * Transient status 'open' exists only until COMMIT as 'done', or ROLLBACK removes it.
 */
async function lockOrCreateClaim(client, kind, clientRef, fail) {
  const id = posEffectDocId(kind, clientRef)
  const openPayload = buildPosEffectPayload(kind, clientRef, {
    status: 'open',
    result: null,
  })
  await client.insertIgnore('opRefs', id, openPayload, 0)
  fail('after_claim')
  const row = await client.selectForUpdate('opRefs', id)
  if (!row) throw new Error('claim row missing after insert')
  const data = row.data || {}
  if (String(data.status || '') === 'done') {
    return { id, done: true, data }
  }
  return { id, done: false, data }
}

async function ensureLocked(clientApi, collection, id, fallbackData) {
  let row = await clientApi.selectForUpdate(collection, id)
  if (!row && fallbackData) {
    await clientApi.upsert(collection, id, fallbackData, 0)
    row = await clientApi.selectForUpdate(collection, id)
  }
  return row
}

async function runOnBackend(backend, failAt, work) {
  if (backend?.kind === 'memory') {
    return backend.runTransaction(work, { failAt })
  }
  return withClient(async (pgClient) => {
    await pgClient.query('BEGIN')
    const fail = (point) => {
      if (failAt && failAt === point) throw new EffectTxnFail(point)
    }
    try {
      const adapter = createPgClientAdapter(pgClient)
      adapter.fail = fail
      const result = await work(adapter)
      fail('before_commit')
      await pgClient.query('COMMIT')
      return result
    } catch (e) {
      try { await pgClient.query('ROLLBACK') } catch { /* ignore */ }
      throw e
    }
  })
}

function resolveBackend(opts) {
  if (opts.backend) return opts.backend
  if (!isPostgresEnabled()) return null
  return { kind: 'postgres' }
}

export async function completePosSaleOrderEffect(opts = {}) {
  const saleRef = String(opts.saleRef || '').trim()
  if (!saleRef) throw new Error('saleRef required')
  const draft = opts.orderDraft
  if (!draft?.id) throw new Error('orderDraft.id required')
  const backend = resolveBackend(opts)
  if (!backend) throw new Error('completePosSaleOrderEffect requires PG or memory backend')

  return runOnBackend(backend, opts.failAt, async (client) => {
    const fail = client.fail || (() => {})
    const claim = await lockOrCreateClaim(client, POS_EFFECT_KINDS.ORDER, saleRef, fail)
    if (claim.done) {
      return { replay: true, order: claim.data.result?.order || null, claim: claim.data }
    }

    fail('after_target_lock')
    const existing = await client.selectOrdersByPosSaleClientRef(saleRef)
    let order
    if (existing.length) {
      order = existing[0].data
    } else {
      order = structuredClone(draft)
      order.posSaleClientRef = saleRef
      fail('after_order_insert')
      await client.upsert('orders', orderDocId(order), order, 0)
    }

    const donePayload = buildPosEffectPayload(POS_EFFECT_KINDS.ORDER, saleRef, {
      status: 'done',
      result: { orderId: order.id, order: structuredClone(order) },
      createdAtIso: claim.data.createdAtIso,
    })
    fail('after_done_marker')
    await client.upsert('opRefs', claim.id, donePayload, 0)
    return { replay: false, order, claim: donePayload }
  })
}

export async function completeBonusSpendEffect(opts = {}) {
  const saleRef = String(opts.saleRef || '').trim()
  const amount = Math.max(0, Math.floor(Number(opts.amount) || 0))
  const card = opts.card
  const client = opts.client
  const order = opts.order
  if (!saleRef) throw new Error('saleRef required')
  if (!card?.num) throw new Error('card required')
  if (!order?.id) throw new Error('order required')
  const backend = resolveBackend(opts)
  if (!backend) throw new Error('completeBonusSpendEffect requires PG or memory backend')

  return runOnBackend(backend, opts.failAt, async (clientApi) => {
    const fail = clientApi.fail || (() => {})
    const claim = await lockOrCreateClaim(clientApi, POS_EFFECT_KINDS.BONUS_SPEND, saleRef, fail)
    if (claim.done) {
      return {
        replay: true,
        result: claim.data.result,
        card: claim.data.result?.card || null,
        client: claim.data.result?.client || null,
        order: claim.data.result?.order || null,
        claim: claim.data,
      }
    }

    const cId = cardDocId(card)
    const clId = clientDocId(client)
    const oId = orderDocId(order)

    const cardRow = await ensureLocked(clientApi, 'cards', cId, card)
    fail('after_target_lock')
    const clientRow = clId ? await ensureLocked(clientApi, 'clients', clId, client) : null
    const orderRow = await ensureLocked(clientApi, 'orders', oId, order)

    const cardData = structuredClone(cardRow.data)
    const clientData = clientRow ? structuredClone(clientRow.data) : (client ? structuredClone(client) : null)
    const orderData = structuredClone(orderRow.data)

    if (orderData.bonusSpendApplied) {
      const donePayload = buildPosEffectPayload(POS_EFFECT_KINDS.BONUS_SPEND, saleRef, {
        status: 'done',
        result: {
          bonusSpent: Math.max(0, Math.floor(Number(orderData.bonusSpent) || 0)),
          orderId: orderData.id,
          card: cardData,
          client: clientData,
          order: orderData,
        },
        createdAtIso: claim.data.createdAtIso,
      })
      await clientApi.upsert('opRefs', claim.id, donePayload, 0)
      return {
        replay: true,
        result: donePayload.result,
        card: cardData,
        client: clientData,
        order: orderData,
        claim: donePayload,
      }
    }

    const balance = Number(cardData.bonus) || 0
    const goodsCap = Math.floor(
      Number(opts.goodsCap)
      || Number(orderData.goodsTotal)
      || Number(orderData.total)
      || 0,
    )
    const deduct = amount <= 0
      ? 0
      : Math.min(balance, amount, goodsCap > 0 ? goodsCap : amount)

    if (deduct > 0) {
      cardData.bonus = Math.max(0, balance - deduct)
      if (clientData) clientData.bonus = cardData.bonus
    }
    orderData.bonusSpent = deduct
    orderData.bonusSpendApplied = true

    fail('after_balance_update')
    await clientApi.upsert('cards', cId, cardData, cardRow.sort_idx || 0)
    if (clientData && clId) {
      await clientApi.upsert('clients', clId, clientData, clientRow?.sort_idx || 0)
    }
    await clientApi.upsert('orders', oId, orderData, orderRow.sort_idx || 0)

    const donePayload = buildPosEffectPayload(POS_EFFECT_KINDS.BONUS_SPEND, saleRef, {
      status: 'done',
      result: {
        bonusSpent: deduct,
        orderId: orderData.id,
        card: structuredClone(cardData),
        client: clientData ? structuredClone(clientData) : null,
        order: structuredClone(orderData),
      },
      createdAtIso: claim.data.createdAtIso,
    })
    fail('after_done_marker')
    await clientApi.upsert('opRefs', claim.id, donePayload, 0)
    return {
      replay: false,
      result: donePayload.result,
      card: cardData,
      client: clientData,
      order: orderData,
      claim: donePayload,
    }
  })
}

export async function completeBonusEarnEffect(opts = {}) {
  const saleRef = String(opts.saleRef || '').trim()
  const card = opts.card
  const client = opts.client
  const order = opts.order
  const earnedIn = Math.max(0, Math.floor(Number(opts.earned) || 0))
  if (!saleRef) throw new Error('saleRef required')
  if (!card?.num) throw new Error('card required')
  if (!order?.id) throw new Error('order required')
  const backend = resolveBackend(opts)
  if (!backend) throw new Error('completeBonusEarnEffect requires PG or memory backend')

  return runOnBackend(backend, opts.failAt, async (clientApi) => {
    const fail = clientApi.fail || (() => {})
    const claim = await lockOrCreateClaim(clientApi, POS_EFFECT_KINDS.BONUS_EARN, saleRef, fail)
    if (claim.done) {
      return {
        replay: true,
        result: claim.data.result,
        card: claim.data.result?.card || null,
        client: claim.data.result?.client || null,
        order: claim.data.result?.order || null,
        claim: claim.data,
      }
    }

    const cId = cardDocId(card)
    const clId = clientDocId(client)
    const oId = orderDocId(order)

    const cardRow = await ensureLocked(clientApi, 'cards', cId, card)
    fail('after_target_lock')
    const clientRow = clId ? await ensureLocked(clientApi, 'clients', clId, client) : null
    const orderRow = await ensureLocked(clientApi, 'orders', oId, order)

    const cardData = structuredClone(cardRow.data)
    const clientData = clientRow ? structuredClone(clientRow.data) : (client ? structuredClone(client) : null)
    const orderData = structuredClone(orderRow.data)

    let earned = earnedIn
    let didMutate = false
    if (orderData.bonusCredited) {
      earned = Math.max(0, Math.floor(Number(orderData.bonusEarned) || 0))
    } else {
      if (earned > 0) {
        cardData.bonus = (Number(cardData.bonus) || 0) + earned
        if (clientData) clientData.bonus = cardData.bonus
      }
      orderData.bonusCredited = true
      orderData.bonusEarned = earned
      didMutate = true
      fail('after_balance_update')
      await clientApi.upsert('cards', cId, cardData, cardRow.sort_idx || 0)
      if (clientData && clId) {
        await clientApi.upsert('clients', clId, clientData, clientRow?.sort_idx || 0)
      }
      await clientApi.upsert('orders', oId, orderData, orderRow.sort_idx || 0)
    }

    const donePayload = buildPosEffectPayload(POS_EFFECT_KINDS.BONUS_EARN, saleRef, {
      status: 'done',
      result: {
        bonusEarned: earned,
        orderId: orderData.id,
        card: structuredClone(cardData),
        client: clientData ? structuredClone(clientData) : null,
        order: structuredClone(orderData),
      },
      createdAtIso: claim.data.createdAtIso,
    })
    fail('after_done_marker')
    await clientApi.upsert('opRefs', claim.id, donePayload, 0)
    return {
      replay: !didMutate,
      result: donePayload.result,
      card: cardData,
      client: clientData,
      order: orderData,
      claim: donePayload,
    }
  })
}

/** Patch in-memory db from txn canonical rows. */
export function reconcileEffectCache(db, { order, card, client, claim } = {}) {
  if (!db) return
  if (order) {
    if (!Array.isArray(db.orders)) db.orders = []
    const i = db.orders.findIndex(o =>
      String(o.id) === String(order.id)
      || (order.posSaleClientRef && String(o.posSaleClientRef || '') === String(order.posSaleClientRef)),
    )
    if (i >= 0) db.orders[i] = { ...db.orders[i], ...structuredClone(order) }
    else db.orders.push(structuredClone(order))
    // drop other local orders with same posSaleClientRef
    if (order.posSaleClientRef) {
      const ref = String(order.posSaleClientRef)
      db.orders = db.orders.filter(o =>
        String(o.posSaleClientRef || '') !== ref || String(o.id) === String(order.id),
      )
    }
  }
  if (card?.num) {
    if (!Array.isArray(db.cards)) db.cards = []
    const i = db.cards.findIndex(c => String(c.num) === String(card.num))
    if (i >= 0) db.cards[i] = { ...db.cards[i], ...structuredClone(card) }
    else db.cards.push(structuredClone(card))
  }
  if (client?.id) {
    if (!Array.isArray(db.clients)) db.clients = []
    const i = db.clients.findIndex(c => String(c.id) === String(client.id))
    if (i >= 0) db.clients[i] = { ...db.clients[i], ...structuredClone(client) }
    else db.clients.push(structuredClone(client))
  }
  if (claim?.id) {
    if (!Array.isArray(db.opRefs)) db.opRefs = []
    const i = db.opRefs.findIndex(r =>
      String(r.id || '') === String(claim.id)
      || (r.kind === claim.kind && String(r.clientRef || '') === String(claim.clientRef || '')),
    )
    if (i >= 0) db.opRefs[i] = { ...db.opRefs[i], ...structuredClone(claim) }
    else db.opRefs.push(structuredClone(claim))
  }
}

export { POS_EFFECT_KINDS, posEffectDocId }
