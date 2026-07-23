'use strict'

/** Срок погашения каждого отдельного долга (дней) */
export const DEBT_TERM_DAYS = 30
/** За сколько дней до срока напомнить */
export const DEBT_REMINDER_DAYS = 3
/** После скольких просрочек блокировать новый долг */
export const DEBT_BLOCK_AFTER_STRIKES = 2

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function parseIso(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isNaN(t) ? null : t
}

function addDaysIso(iso, days) {
  const t = parseIso(iso) ?? Date.now()
  return new Date(t + days * 864e5).toISOString()
}

function fmtDueRu(iso) {
  const t = parseIso(iso)
  if (t == null) return '—'
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function startOfDayMs(iso = new Date().toISOString()) {
  const d = new Date(parseIso(iso) ?? Date.now())
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function daysUntilDue(dueAtIso, nowIso = new Date().toISOString()) {
  const due = startOfDayMs(dueAtIso)
  const now = startOfDayMs(nowIso)
  return Math.ceil((due - now) / 864e5)
}

export function ensureDebtLedger(client) {
  if (!client) return
  if (!Array.isArray(client.debtLedger)) client.debtLedger = []
  if (client.debtOverdueStrikes == null) client.debtOverdueStrikes = 0
  if (client.debtCreditBlocked == null) client.debtCreditBlocked = false
}

export function syncDebtLedgerToCard(client, card) {
  if (!client || !card) return
  ensureDebtLedger(client)
  card.debtLedger = client.debtLedger
  card.debtOverdueStrikes = client.debtOverdueStrikes
  card.debtCreditBlocked = client.debtCreditBlocked
}

export function syncDebtLedgerFromCard(card, client) {
  if (!client || !card) return
  if (Array.isArray(card.debtLedger)) client.debtLedger = card.debtLedger
  if (card.debtOverdueStrikes != null) client.debtOverdueStrikes = card.debtOverdueStrikes
  if (card.debtCreditBlocked != null) client.debtCreditBlocked = card.debtCreditBlocked
  ensureDebtLedger(client)
}

export function canTakeNewDebt(client, card, amount = 0) {
  ensureDebtLedger(client)
  const blocked = !!(client.debtCreditBlocked || card?.debtCreditBlocked)
  if (blocked) {
    return {
      ok: false,
      reason: 'Новый долг недоступен: была повторная просрочка. Погасите долг и обратитесь в магазин.',
      blocked: true,
    }
  }
  const debt = round2(client.debt)
  const limit = round2(client.debtLimit)
  const add = round2(amount)
  if (add > 0 && debt + add > limit + 0.001) {
    return {
      ok: false,
      reason: `Недостаточно лимита. Доступно ${Math.max(0, round2(limit - debt))} ЅМ`,
      blocked: false,
    }
  }
  return { ok: true, blocked: false }
}

function buildCreatedNotification(client, entry) {
  const phone = client.phone || ''
  const dueLabel = fmtDueRu(entry.dueAtIso)
  return {
    id: `debt-${entry.id}-created`,
    targetPhone: phone,
    kind: 'system',
    action: 'debts',
    icon: '💳',
    color: '#FFB800',
    title: 'Оформлен долг',
    body: `Долг ${entry.amount} ЅМ. Погасите до ${dueLabel}.`,
  }
}

function buildReminderNotification(client, entry, daysLeft) {
  return {
    id: `debt-${entry.id}-remind`,
    targetPhone: client.phone || '',
    kind: 'system',
    action: 'debts',
    icon: '⏳',
    color: '#FFB800',
    title: 'Напоминание о долге',
    body: `Осталось ${daysLeft} дн. до срока. Долг ${entry.remaining} ЅМ · до ${fmtDueRu(entry.dueAtIso)}.`,
  }
}

function buildOverdueNotification(client, entry, strikeNo) {
  const repeat = strikeNo >= DEBT_BLOCK_AFTER_STRIKES
  return {
    id: `debt-${entry.id}-overdue`,
    targetPhone: client.phone || '',
    kind: 'system',
    action: 'debts',
    icon: '⚠️',
    color: '#FF4545',
    title: repeat ? 'Повторная просрочка долга' : 'Просрочка долга',
    body: repeat
      ? `Долг ${entry.remaining} ЅМ просрочен повторно. Новый долг временно недоступен.`
      : `Долг ${entry.remaining} ЅМ просрочен. Погасите срочно, иначе новый долг будет закрыт.`,
  }
}

function buildBlockedNotification(client) {
  return {
    id: `debt-block-${phoneKey(client.phone)}-${Date.now()}`,
    targetPhone: client.phone || '',
    kind: 'system',
    action: 'debts',
    icon: '🚫',
    color: '#FF4545',
    title: 'Новый долг закрыт',
    body: 'Из-за повторной просрочки новый долг недоступен. Погасите текущий долг в магазине.',
  }
}

export function addDebtCharge(client, card, {
  amount,
  source = 'pos',
  orderId,
  saleId,
  desc = 'Долг',
  createdAtIso,
} = {}) {
  ensureDebtLedger(client)
  const amt = round2(amount)
  if (!(amt > 0)) return { entry: null, notifications: [] }

  const when = createdAtIso && !Number.isNaN(Date.parse(createdAtIso))
    ? new Date(createdAtIso).toISOString()
    : new Date().toISOString()

  const entry = {
    id: `DL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    amount: amt,
    remaining: amt,
    createdAtIso: when,
    dueAtIso: addDaysIso(when, DEBT_TERM_DAYS),
    source,
    orderId: orderId || undefined,
    saleId: saleId || undefined,
    desc: String(desc || 'Долг').trim(),
    createdNotified: false,
    reminderNotified: false,
    overdueNotified: false,
    overdueStrikeApplied: false,
  }

  client.debtLedger.unshift(entry)
  client.debtLedger = client.debtLedger.slice(0, 120)
  syncDebtLedgerToCard(client, card)

  const notifications = [buildCreatedNotification(client, entry)]
  entry.createdNotified = true
  return { entry, notifications }
}

export function applyDebtRepayment(client, card, amount, meta = {}) {
  ensureDebtLedger(client)
  let left = round2(amount)
  if (!(left > 0)) return { applied: 0, repayments: [], notifications: [] }

  const open = client.debtLedger
    .filter(e => round2(e.remaining) > 0)
    .sort((a, b) => (parseIso(a.createdAtIso) || 0) - (parseIso(b.createdAtIso) || 0))

  const repayments = []
  for (const entry of open) {
    if (left <= 0.001) break
    const need = round2(entry.remaining)
    if (need <= 0.001) continue
    const pay = Math.min(need, left)
    entry.remaining = round2(need - pay)
    left = round2(left - pay)
    repayments.push({ id: entry.id, paid: pay, remaining: entry.remaining })
  }

  syncDebtLedgerToCard(client, card)
  recomputeDebtBlockState(client, card)

  return {
    applied: round2(amount - left),
    repayments,
    desc: meta.desc || 'Погашение долга',
    notifications: [],
  }
}

function hasOpenOverdueEntries(client, nowIso = new Date().toISOString()) {
  ensureDebtLedger(client)
  return client.debtLedger.some(e => round2(e.remaining) > 0 && daysUntilDue(e.dueAtIso, nowIso) < 0)
}

export function recomputeDebtBlockState(client, card) {
  ensureDebtLedger(client)
  const debt = round2(client.debt)
  const hasOverdue = hasOpenOverdueEntries(client)
  if (debt <= 0.001 && !hasOverdue) {
    client.debtOverdueStrikes = 0
    client.debtCreditBlocked = false
  } else if ((client.debtOverdueStrikes || 0) >= DEBT_BLOCK_AFTER_STRIKES) {
    client.debtCreditBlocked = true
  }
  syncDebtLedgerToCard(client, card)
}

function reconcileDebtLedger(client) {
  ensureDebtLedger(client)
  const debt = round2(client.debt)
  const ledgerRemaining = round2(
    (client.debtLedger || []).reduce((s, e) => s + round2(e.remaining), 0),
  )
  const gap = round2(debt - ledgerRemaining)
  if (gap > 0.001) {
    const when = new Date().toISOString()
    client.debtLedger.unshift({
      id: `DL-BF-${phoneKey(client.phone)}-${Date.now()}`,
      amount: gap,
      remaining: gap,
      createdAtIso: when,
      dueAtIso: addDaysIso(when, DEBT_TERM_DAYS),
      source: 'backfill',
      desc: 'Существующий долг',
      createdNotified: true,
      reminderNotified: false,
      overdueNotified: false,
      overdueStrikeApplied: false,
    })
    client.debtLedger = client.debtLedger.slice(0, 120)
  }
}

export function runDebtMaintenance(db, nowIso = new Date().toISOString()) {
  const notifications = []
  for (const client of db.clients || []) {
    if (!client?.phone) continue
    ensureDebtLedger(client)
    reconcileDebtLedger(client)
    const card = (db.cards || []).find(c =>
      (client.card && String(c.num).toUpperCase() === String(client.card).toUpperCase())
      || phoneKey(c.phone) === phoneKey(client.phone),
    )
    let blockedNow = false

    for (const entry of client.debtLedger) {
      const remaining = round2(entry.remaining)
      if (!(remaining > 0)) continue
      const leftDays = daysUntilDue(entry.dueAtIso, nowIso)

      if (leftDays <= DEBT_REMINDER_DAYS && leftDays >= 0 && !entry.reminderNotified) {
        notifications.push(buildReminderNotification(client, entry, leftDays))
        entry.reminderNotified = true
      }

      if (leftDays < 0 && !entry.overdueNotified) {
        entry.overdueNotified = true
        if (!entry.overdueStrikeApplied) {
          client.debtOverdueStrikes = Number(client.debtOverdueStrikes || 0) + 1
          entry.overdueStrikeApplied = true
        }
        notifications.push(buildOverdueNotification(client, entry, client.debtOverdueStrikes))
        if (client.debtOverdueStrikes >= DEBT_BLOCK_AFTER_STRIKES) {
          client.debtCreditBlocked = true
          blockedNow = true
        }
      }
    }

    recomputeDebtBlockState(client, card)
    if (blockedNow && client.debtCreditBlocked) {
      notifications.push(buildBlockedNotification(client))
    }
    if (card) syncDebtLedgerToCard(client, card)
  }
  return notifications
}

export function buildDebtLedgerResponse(client) {
  ensureDebtLedger(client)
  const nowIso = new Date().toISOString()
  const entries = (client.debtLedger || []).map(entry => {
    const remaining = round2(entry.remaining)
    const leftDays = daysUntilDue(entry.dueAtIso, nowIso)
    const overdue = remaining > 0 && leftDays < 0
    return {
      id: entry.id,
      amount: round2(entry.amount),
      remaining,
      paidAmount: round2(entry.amount - remaining),
      createdAtIso: entry.createdAtIso,
      dueAtIso: entry.dueAtIso,
      dueDate: fmtDueRu(entry.dueAtIso),
      daysLeft: remaining > 0 ? leftDays : 0,
      overdue,
      source: entry.source || 'pos',
      orderId: entry.orderId,
      saleId: entry.saleId,
      desc: entry.desc || 'Долг',
      status: remaining <= 0.001 ? 'paid' : (overdue ? 'overdue' : 'open'),
    }
  })

  const openEntries = entries.filter(e => e.status !== 'paid')
  const nextDue = openEntries
    .filter(e => e.status === 'open')
    .sort((a, b) => (parseIso(a.dueAtIso) || 0) - (parseIso(b.dueAtIso) || 0))[0]

  return {
    termDays: DEBT_TERM_DAYS,
    debt: round2(client.debt),
    debtLimit: round2(client.debtLimit),
    overdueStrikes: Number(client.debtOverdueStrikes) || 0,
    creditBlocked: !!client.debtCreditBlocked,
    nextDueDate: nextDue?.dueDate || null,
    nextDueDaysLeft: nextDue?.daysLeft ?? null,
    entries,
  }
}

export function handleClientDebtDelta(db, client, card, prevDebt, nextDebt, meta = {}) {
  const before = round2(prevDebt)
  const after = round2(nextDebt)
  const delta = round2(after - before)
  if (Math.abs(delta) <= 0.001) return { notifications: [] }

  if (delta > 0) {
    // Лимит/блокировка проверяются только для клиентского приложения.
    // Из админки и кассы (meta.enforceLimit === false) долг оформляется без ограничений.
    if (meta.enforceLimit !== false) {
      const gate = canTakeNewDebt(client, card, delta)
      if (!gate.ok) {
        const err = new Error(gate.reason)
        err.status = gate.blocked ? 403 : 400
        throw err
      }
    }
    const { notifications } = addDebtCharge(client, card, {
      amount: delta,
      source: meta.source || 'admin',
      orderId: meta.orderId,
      saleId: meta.saleId,
      desc: meta.desc || 'Долг',
      createdAtIso: meta.createdAtIso,
    })
    return { notifications }
  }

  applyDebtRepayment(client, card, Math.abs(delta), { desc: meta.desc || 'Погашение долга' })
  return { notifications: [] }
}
