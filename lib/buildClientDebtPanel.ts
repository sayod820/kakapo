import { phonesMatch } from '@/lib/clientCrm'
import {
  buildDebtOrderBalances,
  buildSaleDebtStatuses,
  cashDebtOrderId,
  debtOrderIdsMatch,
  isLedgerCashHistoryDebt,
  isManualDebtHistoryEntry,
  loadDebtHistoryForClient,
  saleOpenCreditAmount,
  saleWasOnCredit,
  type DebtHistoryEntry,
} from '@/lib/clientVipCredit'
import type { PosSale, PosSaleItem, Product } from '@/lib/types'
import { fmtMoney } from '@/components/trade/warehouse/warehouseShared'

export type ClientDebtCreditSale = {
  id: string
  label: string
  when: string
  items: string
  debtAdded: number
  remain: number
  paid: number
  status: 'open' | 'partial' | 'paid'
  ts: number
  note?: string
}

export type ClientDebtCashView = {
  id: string
  label: string
  when: string
  debtAdded: number
  paid: number
  remain: number
  status: 'open' | 'partial' | 'paid'
  ts: number
  orderId: string
  debtEntryId?: string
  isResidual?: boolean
}

export type ClientDebtPayView = {
  id: string
  when: string
  amount: number
  desc: string
  checkLabel: string
  items?: string
  saleId?: string
  isReturn: boolean
  partKind: 'check' | 'cash' | 'other'
  batchId?: string
  ts: number
  source?: string
  payScope?: 'sale' | 'debt'
}

export type ClientDebtPayGroup = {
  id: string
  when: string
  ts: number
  amount: number
  isReturn: boolean
  parts: ClientDebtPayView[]
  checkCount: number
  cashCount: number
  methodHint: string
  coverHint: string
}

export type ClientDebtFeedRow = {
  key: string
  when: string
  kind: 'pos' | 'cash' | 'pay'
  desc: string
  amount: number
  balance: number
  saleId?: string
}

export type ClientDebtPanelData = {
  posOriginal: number
  posRemain: number
  cashOnCard: number
  residualCash: number
  openChecks: number
  totalChecks: number
  openCash: number
  cashRows: DebtHistoryEntry[]
  cashView: ClientDebtCashView[]
  payRows: DebtHistoryEntry[]
  payView: ClientDebtPayView[]
  payGroups: ClientDebtPayGroup[]
  feed: ClientDebtFeedRow[]
  creditSales: ClientDebtCreditSale[]
}

type ClientDebtClient = {
  id?: string
  phone?: string
  name?: string
}

type ClientHistLine = {
  name: string
  qty: number
  price: number
  sum: number
  unit?: string
}

function emptyClientDebtPanel(): ClientDebtPanelData {
  return {
    posOriginal: 0,
    posRemain: 0,
    cashOnCard: 0,
    residualCash: 0,
    openChecks: 0,
    totalChecks: 0,
    openCash: 0,
    cashRows: [],
    cashView: [],
    payRows: [],
    payView: [],
    payGroups: [],
    feed: [],
    creditSales: [],
  }
}

function mapSaleLines(
  items: Pick<PosSaleItem, 'productName' | 'productId' | 'qty' | 'price' | 'lineTotal' | 'unit'>[] | undefined,
  products: Pick<Product, 'id' | 'name' | 'price' | 'unit' | 'sellType'>[] = [],
): ClientHistLine[] {
  if (!items?.length) return []
  return items.map(i => {
    const fromCatalog = i.productId ? products.find(p => p.id === i.productId) : undefined
    const name = String(i.productName || fromCatalog?.name || '').trim() || (i.productId ? `#${i.productId}` : 'товар')
    const qty = Number(i.qty) || 0
    const price = Number(i.price) || Number(fromCatalog?.price) || 0
    const sum = Number(i.lineTotal) || Math.round(price * qty * 100) / 100
    const unitFromItem = String(i.unit || '').trim()
    const unitFromCat = fromCatalog
      ? (String(fromCatalog.sellType || '').toLowerCase() === 'weight'
        ? 'кг'
        : String(fromCatalog.unit || '').trim())
      : ''
    const unit = unitFromItem || unitFromCat || (Number.isInteger(qty) ? 'шт' : 'кг')
    return { name, qty, price, sum, unit }
  })
}

function linesLabel(lines: ClientHistLine[]): string {
  if (!lines.length) return ''
  const parts = lines.slice(0, 5).map(l => {
    const q = Number.isInteger(l.qty) ? String(l.qty) : String(Math.round(l.qty * 1000) / 1000)
    const u = String(l.unit || '').trim()
    return u ? `${l.name} ${q} ${u}` : `${l.name} ×${q}`
  })
  if (lines.length > 5) parts.push(`+${lines.length - 5}`)
  return parts.join(', ')
}

export function buildClientDebtPanel({
  client,
  cardDebt,
  sales,
  products,
}: {
  client: ClientDebtClient | null | undefined
  cardDebt: number
  sales: PosSale[]
  products?: Pick<Product, 'id' | 'name' | 'price' | 'unit' | 'sellType'>[]
}): ClientDebtPanelData {
  if (!client) return emptyClientDebtPanel()

  const catalog = products || []
  const history = loadDebtHistoryForClient(client)
  const clientSales = sales.filter(s => {
    const matchId = client.id && s.clientId === client.id
    const matchPhone = client.phone && s.clientPhone && phonesMatch(client.phone, s.clientPhone)
    return !!(matchId || matchPhone)
  })
  const posSales = clientSales
    .filter(s => saleWasOnCredit(s))
    .map(s => {
      const remain = saleOpenCreditAmount(s)
      const orig = remain > 0.001
        ? remain
        : Math.max(
          remain,
          Number(s.originalTotal) || 0,
          Number(s.lastReturnTotal) || 0,
        )
      return {
        id: s.id,
        orderId: s.orderId,
        number: s.number,
        dateIso: s.createdAtIso,
        debtAdded: orig,
        items: mapSaleLines(s.items, catalog),
        note: String(s.note || '').trim() || undefined,
      }
    })
    .filter(s => s.debtAdded > 0.001)
    .sort((a, b) => String(b.dateIso).localeCompare(String(a.dateIso)))

  const normalizedCardDebt = Math.max(0, Math.round(cardDebt * 100) / 100)
  const { saleStatus, posOriginal, posRemain, cashOnCard } = buildSaleDebtStatuses(
    posSales,
    history,
    normalizedCardDebt,
  )

  const manual = history.filter(isManualDebtHistoryEntry)
  const cashRows = history.filter(r => isLedgerCashHistoryDebt(r, clientSales))
  const checkPays = history.filter(r => r.type === 'pay' && !isManualDebtHistoryEntry(r))
  const manualPays = manual.filter(r => r.type === 'pay')
  const cashChargeSum = Math.round(
    cashRows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0) * 100,
  ) / 100
  const residualCash = Math.max(0, Math.round((cashOnCard - cashChargeSum) * 100) / 100)

  const { unpaid: unpaidDebtBal, paid: paidDebtRows } = buildDebtOrderBalances(history)
  const cashIdSet = new Set(cashRows.map(r => r.id))
  const cashView: ClientDebtCashView[] = []
  for (const d of unpaidDebtBal) {
    if (!cashIdSet.has(d.id)) continue
    const orig = Math.round(Math.abs(Number(d.originalAmount ?? d.amount) || 0) * 100) / 100
    const paidAmt = Math.round((Number(d.paidAmount) || 0) * 100) / 100
    const rem = Math.round((Number(d.remainingAmount) || 0) * 100) / 100
    cashView.push({
      id: d.id,
      label: d.desc || 'Наличные',
      when: `${d.date}${d.time ? ` · ${d.time}` : ''}`,
      debtAdded: orig,
      paid: paidAmt,
      remain: rem,
      status: d.partial || paidAmt > 0.001 ? 'partial' : 'open',
      ts: Number(d.ts) || 0,
      orderId: cashDebtOrderId(d),
      debtEntryId: d.id,
    })
  }
  for (const d of paidDebtRows) {
    if (!cashIdSet.has(d.id)) continue
    const orig = Math.round(Math.abs(Number(d.amount) || 0) * 100) / 100
    cashView.push({
      id: d.id,
      label: d.desc || 'Наличные',
      when: `${d.date}${d.time ? ` · ${d.time}` : ''}`,
      debtAdded: orig,
      paid: orig,
      remain: 0,
      status: 'paid',
      ts: Number(d.ts) || 0,
      orderId: cashDebtOrderId(d),
      debtEntryId: d.id,
    })
  }
  if (residualCash > 0.005) {
    cashView.push({
      id: 'residual-cash',
      label: 'Ручной долг на карте',
      when: 'раньше',
      debtAdded: residualCash,
      paid: 0,
      remain: residualCash,
      status: 'open',
      ts: 1,
      orderId: '',
      isResidual: true,
    })
  }
  cashView.sort((a, b) => b.ts - a.ts)

  const creditSales: ClientDebtCreditSale[] = posSales.map(s => {
    const st = saleStatus[s.id] || { status: 'open' as const, paid: 0, remain: s.debtAdded }
    const ts = Date.parse(s.dateIso) || 0
    const label = s.number != null && Number(s.number) > 0
      ? `Чек №${s.number}`
      : (s.orderId ? `Заказ ${s.orderId}` : `Чек ${s.id.slice(-6)}`)
    const when = ts
      ? `${new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}, ${new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
      : s.dateIso
    const paid = Math.max(0, Math.round((Number(st.paid) || Math.max(0, s.debtAdded - st.remain)) * 100) / 100)
    return {
      id: s.id,
      label,
      when,
      items: linesLabel(s.items),
      debtAdded: s.debtAdded,
      remain: st.remain,
      paid,
      status: st.status,
      ts,
      note: s.note,
    }
  })

  const payRows = [...checkPays, ...manualPays].sort((a, b) => (b.ts || 0) - (a.ts || 0))

  const salesLookup = new Map<string, { label: string; items?: string }>()
  for (const s of clientSales) {
    const label = s.number != null && Number(s.number) > 0
      ? `Чек №${s.number}`
      : (s.orderId ? `Заказ ${s.orderId}` : `Чек ${String(s.id).slice(-6)}`)
    const items = linesLabel(mapSaleLines(s.items, catalog))
    salesLookup.set(String(s.id), { label, items })
    if (s.orderId) salesLookup.set(String(s.orderId), { label, items })
    salesLookup.set(`sale-${s.id}`, { label, items })
  }

  const payView: ClientDebtPayView[] = payRows.map(r => {
    const sid = String(r.orderId || '').trim().replace(/^sale-/, '')
    const payScope = r.payScope
    const sale = sid
      ? creditSales.find(s => debtOrderIdsMatch(s.id, sid) || debtOrderIdsMatch(s.id, r.orderId))
      : undefined
    const saleAny = !sale && sid ? salesLookup.get(sid) : undefined
    const cash = !sale && sid
      ? cashView.find(c =>
        !c.isResidual
        && (debtOrderIdsMatch(c.orderId, sid)
          || debtOrderIdsMatch(c.id, sid)
          || debtOrderIdsMatch(`cash-${c.id}`, sid)))
      : undefined
    const isCashPart = !sale && (!!cash || sid.startsWith('cash-'))
    const isReturn = /возврат/i.test(String(r.desc || ''))
    const checkLabel = payScope === 'sale'
      ? `${saleAny?.label || sale?.label || (sid ? `Чек ${sid.slice(-6)}` : 'Текущий чек')} · оплата`
      : sale
        ? sale.label
        : cash
          ? cash.label
          : sid
            ? (sid.startsWith('cash-') ? 'Наличные' : `Чек ${sid.slice(-8)}`)
            : 'Без привязки'
    return {
      id: r.id,
      when: `${r.date}${r.time ? ` · ${r.time}` : ''}`,
      amount: Math.abs(Number(r.amount) || 0),
      desc: r.desc || (isReturn ? 'Возврат товара' : 'Погашение долга'),
      checkLabel,
      items: sale?.items || saleAny?.items || r.itemsSummary || undefined,
      saleId: sale?.id || (sid && !sid.startsWith('cash-') ? sid : undefined),
      isReturn,
      partKind: (payScope === 'sale' || sale ? 'check' : isCashPart ? 'cash' : 'other') as 'check' | 'cash' | 'other',
      batchId: r.batchId || undefined,
      ts: Number(r.ts) || 0,
      source: r.source,
      payScope,
    }
  })

  const PAY_CLUSTER_MS = 2500
  const paySortedAsc = [...payView].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
  const payGroups: ClientDebtPayGroup[] = []
  let cluster: ClientDebtPayView[] = []
  const flushCluster = () => {
    if (!cluster.length) return
    const parts = [...cluster].sort((a, b) => {
      if (a.payScope === 'sale' && b.payScope !== 'sale') return -1
      if (b.payScope === 'sale' && a.payScope !== 'sale') return 1
      return a.ts - b.ts || a.id.localeCompare(b.id)
    })
    cluster = []
    const amount = Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100
    const newest = parts[parts.length - 1]
    const active = parts.filter(p => !p.isReturn)
    const checkParts = active.filter(p => p.partKind === 'check')
    const cashParts = active.filter(p => p.partKind === 'cash')
    const salePart = active.find(p => p.payScope === 'sale')
    const debtCheckParts = checkParts.filter(p => p.payScope !== 'sale')
    const debtCheckCount = new Set(debtCheckParts.map(p => p.checkLabel)).size || debtCheckParts.length
    const cashCount = new Set(cashParts.map(p => p.checkLabel)).size || cashParts.length
    const methodHint = /карта/i.test(parts.map(p => p.desc).join(' '))
      ? 'карта'
      : /наличн/i.test(parts.map(p => p.desc).join(' '))
        ? 'наличные'
        : ''
    const bits: string[] = []
    if (salePart) bits.push(salePart.checkLabel.replace(/\s·\sоплата$/i, ''))
    if (debtCheckCount > 0) {
      bits.push(debtCheckCount === 1
        ? (debtCheckParts[0]?.checkLabel || 'долг')
        : `${debtCheckCount} старых чек${debtCheckCount < 5 ? 'а' : 'ов'}`)
    }
    if (cashCount > 0) {
      bits.push(cashCount === 1
        ? 'нал. выдача'
        : `${cashCount} нал. выдач`)
    }
    if (!bits.length && active[0]) bits.push(active[0].checkLabel)
    payGroups.push({
      id: parts[0].batchId || `cluster-${parts[0].id}`,
      when: newest.when,
      ts: newest.ts,
      amount,
      isReturn: parts.every(p => p.isReturn),
      parts,
      checkCount: (salePart ? 1 : 0) + debtCheckCount,
      cashCount,
      methodHint,
      coverHint: bits.join(' + '),
    })
  }
  for (const row of paySortedAsc) {
    if (row.isReturn) {
      flushCluster()
      payGroups.push({
        id: row.id,
        when: row.when,
        ts: row.ts,
        amount: row.amount,
        isReturn: true,
        parts: [row],
        checkCount: row.partKind === 'check' ? 1 : 0,
        cashCount: row.partKind === 'cash' ? 1 : 0,
        methodHint: '',
        coverHint: row.checkLabel,
      })
      continue
    }
    const last = cluster[cluster.length - 1]
    const sameBatch = !!(row.batchId && last?.batchId && row.batchId === last.batchId)
    const closeInTime = !row.batchId && !last?.batchId && last
      && Math.abs(row.ts - last.ts) <= PAY_CLUSTER_MS
    if (!cluster.length || sameBatch || closeInTime) {
      cluster.push(row)
    } else {
      flushCluster()
      cluster.push(row)
    }
  }
  flushCluster()
  payGroups.sort((a, b) => b.ts - a.ts)

  const cashRemainById = new Map(cashView.filter(c => !c.isResidual).map(c => [c.id, c.remain]))
  type FeedSrcRow = Omit<ClientDebtFeedRow, 'balance'> & { ts: number }
  const feedSrc: FeedSrcRow[] = [
    ...creditSales
      .filter(s => s.remain > 0.001)
      .map(s => ({
        key: `p-${s.id}`,
        ts: s.ts,
        when: s.when,
        kind: 'pos' as const,
        desc: `${s.label}${s.status === 'partial' ? ` · остаток ${fmtMoney(s.remain)}` : ` · к оплате ${fmtMoney(s.remain)}`}${s.debtAdded > s.remain + 0.05 ? ` · было ${fmtMoney(s.debtAdded)}` : ''}${s.items ? ` · ${s.items}` : ''}`,
        amount: s.remain,
        saleId: s.id,
      })),
    ...cashView
      .filter(c => c.remain > 0.001)
      .map(c => ({
        key: `c-${c.id}`,
        ts: c.ts,
        when: c.when,
        kind: 'cash' as const,
        desc: c.isResidual
          ? 'Ручной долг на карте (без записи в истории)'
          : `${c.label}${c.status === 'partial' ? ` · остаток ${fmtMoney(c.remain)}` : ` · к оплате ${fmtMoney(c.remain)}`}${c.debtAdded > c.remain + 0.05 ? ` · было ${fmtMoney(c.debtAdded)}` : ''}`,
        amount: c.remain,
      })),
    ...payRows
      .filter(r => {
        if (r.payScope === 'sale') return false
        const sid = String(r.orderId || '').trim()
        if (!sid) return true
        if (sid.startsWith('cash-') || cashRemainById.has(sid) || cashView.some(c => cashDebtOrderId(c) === sid)) {
          return false
        }
        const sale = creditSales.find(s => debtOrderIdsMatch(s.id, sid.replace(/^sale-/, '')) || debtOrderIdsMatch(s.id, r.orderId))
        return !sale
      })
      .map(r => {
        const isReturn = /возврат/i.test(String(r.desc || ''))
        return {
          key: `pay-${r.id}`,
          ts: Number(r.ts) || 0,
          when: `${r.date}${r.time ? ` · ${r.time}` : ''}`,
          kind: 'pay' as const,
          desc: r.desc || (isReturn ? 'Возврат товара' : 'Погашение долга'),
          amount: -Math.abs(Number(r.amount) || 0),
          saleId: r.orderId?.replace(/^sale-/, ''),
        }
      }),
  ]
  const chrono = [...feedSrc].sort((a, b) => a.ts - b.ts)
  let bal = 0
  let feed: ClientDebtFeedRow[] = chrono.map(({ ts: _ts, ...row }) => {
    bal = Math.round((bal + row.amount) * 100) / 100
    return { ...row, balance: Math.max(0, bal) }
  })
  const targetDebt = Math.max(0, Math.round(normalizedCardDebt * 100) / 100)
  const lastBal = feed.length ? feed[feed.length - 1].balance : 0
  const drift = Math.round((targetDebt - lastBal) * 100) / 100
  if (Math.abs(drift) > 0.05) {
    feed.push({
      key: 'debt-reconcile',
      when: 'сейчас',
      kind: drift > 0 ? 'cash' : 'pay',
      desc: drift > 0
        ? 'Корректировка до долга на карте'
        : 'Учтены оплаты / списание до долга на карте',
      amount: drift,
      balance: targetDebt,
    })
  }
  feed = feed.reverse()

  return {
    posOriginal,
    posRemain,
    cashOnCard,
    residualCash,
    openChecks: creditSales.filter(s => s.remain > 0.001).length,
    totalChecks: creditSales.length,
    openCash: cashView.filter(c => c.remain > 0.001).length,
    cashRows,
    cashView,
    payRows,
    payView,
    payGroups,
    feed,
    creditSales,
  }
}
