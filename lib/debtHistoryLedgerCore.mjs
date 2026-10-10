/**
 * Детерминированная проекция «истории долга» из авторитетного серверного журнала.
 *
 * Зачем: лента чеков и оплат собиралась из локальной памяти каждого устройства плюс
 * частичного долива из серверного журнала, поэтому устройства и онлайн расходились
 * (разное число строк «Оплаты», разная разбивка). Здесь история строится СТРОГО из
 * одного источника — серверного debtLedger (он одинаков на всех устройствах):
 *   • каждая запись журнала → строка долга (чек / начисление / выдача наличных);
 *   • каждая оплата из entry.payments[] → строка погашения (реальная дата/способ);
 *   • у старых записей без разбивки → одна детерминированная строка «Погашение (с сервера)».
 *
 * Функции чистые (без I/O) и не трогают канонические балансы — это только представление.
 * Локальные ручные записи (которых ещё нет на сервере) подмешиваются отдельно вызывающей стороной.
 */
import {
  CASH_ADVANCE_HISTORY_LABEL,
  isCashAdvanceLedgerSource,
  mapDebtLedgerSource,
  round2,
} from './cashAdvanceHistoryCore.mjs'

export const LEDGER_DEBT_ROW_PREFIX = 'ldg-'
/** Строка погашения, построенная из серверной разбивки entry.payments[] */
export const LEDGER_PAY_ROW_PREFIX = 'srvpay-'
/** Синтетическая строка погашения для старых записей без разбивки */
export const LEDGER_SYNTH_PAY_PREFIX = 'ldg-pay-'

const PAY_EPS = 0.05
/** Окно, внутри которого одинаковые суммы считаем одной и той же операцией. */
const SAME_ROW_MS = 15 * 60 * 1000

export function isLedgerDerivedHistoryId(id) {
  const v = String(id || '')
  return v.startsWith(LEDGER_DEBT_ROW_PREFIX)
    || v.startsWith(LEDGER_SYNTH_PAY_PREFIX)
    || v.startsWith(LEDGER_PAY_ROW_PREFIX)
}

function toMs(iso) {
  const ms = Date.parse(String(iso || ''))
  return Number.isFinite(ms) ? ms : 0
}

function ruDate(ms) {
  const d = new Date(ms || Date.now())
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ruTime(ms) {
  const d = new Date(ms || Date.now())
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function normOrderId(v) {
  return String(v || '').trim()
}

function sameOrderId(a, b) {
  const x = normOrderId(a)
  const y = normOrderId(b)
  if (!x || !y) return false
  if (x === y) return true
  const dx = x.replace(/\D+/g, '')
  const dy = y.replace(/\D+/g, '')
  return !!dx && dx === dy
}

function sameOperationRow(a, b) {
  if (!a || !b) return false
  if (String(a.type) !== String(b.type)) return false
  if (sameOrderId(a.orderId, b.orderId)) return true
  const aa = Math.abs(Number(a.amount) || 0)
  const ba = Math.abs(Number(b.amount) || 0)
  if (Math.abs(aa - ba) >= 0.02) return false
  const at = Number(a.ts) || 0
  const bt = Number(b.ts) || 0
  return at > 0 && bt > 0 && Math.abs(at - bt) < SAME_ROW_MS
}

/**
 * Идентификатор операции оплаты: batchId (одна оплата = несколько чеков) или clientRef.
 * Одинаков на кассе (оптимистичные строки) и на сервере (paymentId = clientRef).
 */
function historyOperationKey(row) {
  const batch = String(row?.batchId || '').trim()
  if (batch) return batch
  return String(row?.clientRef || '').trim()
}

/** Строка «оплата текущего чека» в комбинированной оплате (чек + погашение) — не погашение долга. */
function isSaleScopeRow(row) {
  return String(row?.payScope || '').trim() === 'sale'
}

/** Одна и та же операция оплаты (по batchId/clientRef), даже если разбивка сумм отличается. */
function samePaymentOperation(a, b) {
  const ka = historyOperationKey(a)
  const kb = historyOperationKey(b)
  return !!ka && ka === kb
}

/**
 * Приводит запись журнала (сырую client.debtLedger или ответ API) к единому виду.
 * paidAmount/разбивку умеет вычислять и для сырых записей.
 */
export function normalizeLedgerEntry(entry) {
  const amount = round2(Math.abs(Number(entry?.amount) || 0))
  const remaining = round2(Number(entry?.remaining) || 0)
  const paidAmount = entry?.paidAmount != null
    ? round2(Number(entry.paidAmount) || 0)
    : round2(Math.max(0, amount - remaining))
  const payments = Array.isArray(entry?.payments) && entry.payments.length
    ? entry.payments
    : undefined
  return {
    id: String(entry?.id || ''),
    amount,
    remaining,
    paidAmount,
    createdAtIso: String(entry?.createdAtIso || ''),
    orderId: normOrderId(entry?.orderId || entry?.saleId) || undefined,
    source: entry?.source,
    desc: entry?.desc,
    clientRef: entry?.clientRef,
    payments,
    dueAtIso: entry?.dueAtIso,
    dueDate: entry?.dueDate,
    daysLeft: entry?.daysLeft,
    overdue: !!entry?.overdue,
  }
}

/** Сырой client.debtLedger (синхронизированный со всех устройств) → нормализованные записи. */
export function entriesFromClientLedger(debtLedger) {
  return (Array.isArray(debtLedger) ? debtLedger : [])
    .map(normalizeLedgerEntry)
    .filter(e => e.amount > 0.001)
}

/**
 * Выбор авторитетного набора записей журнала для витрины.
 *
 * Последний ответ API (`GET /debt/ledger`) — самый полный источник: там вся история
 * И разбивка оплат (у старых записей в сыром client.debtLedger `payments[]` нет).
 * Поэтому если ответ API уже получен — он берётся за основу, а сырой синхронизированный
 * журнал подмешивается только теми записями, которых в ответе ещё нет (совсем свежие).
 * До первого ответа API показывается сырой журнал. Так устройство с устаревшим локальным
 * снимком и онлайн не расходятся: свежие записи не теряются, старые получают разбивку.
 *
 * @param {any[]} rawLedger       сырой client.debtLedger (или уже нормализованные записи)
 * @param {any[]} [cachedEntries] entries из последнего ответа API
 * @returns {object[]} нормализованные записи журнала
 */
export function selectAuthoritativeLedgerEntries(rawLedger, cachedEntries) {
  const raw = (Array.isArray(rawLedger) ? rawLedger : [])
    .map(normalizeLedgerEntry)
    .filter(e => e.amount > 0.001)
  const cached = (Array.isArray(cachedEntries) ? cachedEntries : [])
    .map(normalizeLedgerEntry)
    .filter(e => e.amount > 0.001)
  if (!cached.length) return raw
  const byId = new Map()
  for (const e of cached) byId.set(String(e.id), e)
  for (const e of raw) {
    const id = String(e.id)
    if (id && !byId.has(id)) byId.set(id, e)
  }
  return [...byId.values()]
}

/**
 * Строит строки истории строго из записей журнала. Одинаковых вход → одинаковый выход
 * (никаких зависимостей от локального состояния устройства).
 */
export function buildLedgerHistoryRows(entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : []
  const withPaidSynthetic = opts.withSyntheticPays !== false
  const out = []

  for (const e of list) {
    if (!(e.amount > 0.001)) continue
    const dms = toMs(e.createdAtIso) || Date.now()
    const cash = isCashAdvanceLedgerSource(e.source)
    out.push({
      id: `${LEDGER_DEBT_ROW_PREFIX}${e.id}`,
      date: ruDate(dms),
      time: ruTime(dms),
      ts: dms,
      desc: cash ? CASH_ADVANCE_HISTORY_LABEL : (String(e.desc || '').trim() || 'Долг'),
      amount: -e.amount,
      type: 'debt',
      orderId: e.orderId,
      source: mapDebtLedgerSource(e.source),
      clientRef: e.clientRef,
      dueAtIso: e.dueAtIso,
      dueDate: e.dueDate,
      daysLeft: e.daysLeft,
      overdue: e.overdue,
    })

    if (e.payments) {
      for (const p of e.payments) {
        const pa = round2(Math.abs(Number(p?.amount) || 0))
        if (!(pa > PAY_EPS)) continue
        const pid = String(p?.id || e.id || '')
        const pms = toMs(p?.atIso) || dms
        const method = String(p?.method || '')
        out.push({
          id: `${LEDGER_PAY_ROW_PREFIX}${pid}-${e.id}`,
          date: ruDate(pms),
          time: ruTime(pms),
          ts: pms,
          desc: method === 'card'
            ? 'Погашение · карта'
            : method === 'cash'
              ? 'Погашение · наличные'
              : 'Погашение долга',
          amount: pa,
          type: 'pay',
          orderId: e.orderId,
          source: 'cashier',
          batchId: pid,
          clientRef: String(p?.clientRef || '').trim() || undefined,
          ledgerEntryId: String(e.id || ''),
        })
      }
    } else if (withPaidSynthetic && e.paidAmount > PAY_EPS) {
      out.push({
        id: `${LEDGER_SYNTH_PAY_PREFIX}${e.id}`,
        date: ruDate(dms),
        time: ruTime(dms),
        ts: dms + 1,
        desc: 'Погашение (с сервера)',
        amount: e.paidAmount,
        type: 'pay',
        orderId: e.orderId,
        source: 'cashier',
      })
    }
  }

  out.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  return out
}

/**
 * Оставляет только те локальные строки, которых нет в серверной истории.
 * `localOnly(row)` решает, какие локальные строки вообще можно показывать
 * (например, ручные записи раздела «Долги»). Дубли по операции отбрасываются.
 */
export function mergeLocalOnlyRows(authoritative, localRows, localOnly) {
  const auth = Array.isArray(authoritative) ? authoritative.map(r => ({ ...r })) : []
  const local = Array.isArray(localRows) ? localRows : []
  const knownIds = new Set(auth.map(r => String(r.id || '')))
  for (const r of local) {
    if (!r || typeof r !== 'object') continue
    if (knownIds.has(String(r.id || ''))) continue
    if (typeof localOnly === 'function' && !localOnly(r)) continue
    if (auth.some(a => sameOperationRow(a, r))) continue
    // Та же операция уже разложена сервером (pays с тем же id платежа) — не показываем
    // локальный оптимистичный дубль. «Оплату текущего чека» (payScope=sale) оставляем:
    // она не погашение, а часть строки «чек + долг» одной оплаты.
    if (String(r.type) === 'pay' && !isSaleScopeRow(r)
      && auth.some(a => String(a.type) === 'pay' && samePaymentOperation(a, r))) continue
    auth.push({ ...r })
    knownIds.add(String(r.id || ''))
  }
  auth.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  return auth
}
