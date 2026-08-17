'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { FinanceTruthBundle } from '@/lib/types'
import {
  buildLocalFinanceTruth,
  cacheFinanceTruth,
  readCachedFinanceTruth,
} from '@/lib/financeTruthCache'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { loadDebtHistory } from '@/lib/clientVipCredit'
import { softSyncPosAfterSale, softSyncWarehouse, usePosStore } from '@/lib/posStore'
import { useProducts } from '@/lib/store'
import { fmtDateTime, fmtMoney } from './warehouse/warehouseShared'
import {
  PAY_OPTS,
  REPORT_PERIODS,
  REPORT_TABS,
  SALE_STATUS_OPTS,
  abcClassify,
  aggregateSales,
  buildProductInsights,
  cashierStats,
  canComparePeriod,
  comparePeriodLabel,
  dailyBreakdown,
  defaultPosId,
  deltaPct,
  downloadCsv,
  filterByCreatedAt,
  filterSales,
  filterShifts,
  formatPeriodLabel,
  hourlyBreakdown,
  inPeriod,
  isSaleFullyReturned,
  isSalePartiallyReturned,
  lookbackRange,
  lossProducts,
  matchesPos,
  orderSuggestions,
  paymentLabel,
  periodRange,
  periodToApiQuery,
  pickDebtRepaid,
  pointStats,
  posName,
  previousPeriodRange,
  revisionDiffCount,
  round2,
  saleNumberLabel,
  sumCogs,
  sumExpenses,
  sumFinanceMoves,
  sumReceiptCost,
  sumReceiptPaid,
  sumWriteoffCost,
  topProducts,
  ymdLocal,
  type PayFilter,
  type ReportPeriod,
  type ReportTab,
  type SaleStatusFilter,
} from './reportsHelpers'

export default function ReportsModule() {
  const sales = usePosStore(s => s.sales)
  const shifts = usePosStore(s => s.shifts)
  const receipts = usePosStore(s => s.receipts)
  const writeoffs = usePosStore(s => s.writeoffs)
  const revisions = usePosStore(s => s.revisions)
  const expenses = usePosStore(s => s.expenses)
  const financeMoves = usePosStore(s => s.financeMoves)
  const suppliers = usePosStore(s => s.suppliers)
  const expiry = usePosStore(s => s.expiry)
  const posPoints = usePosStore(s => s.posPoints)
  const cashiers = usePosStore(s => s.cashiers)
  const apiError = usePosStore(s => s.apiError)
  const clients = useClientStore(s => s.clients)
  const products = useProducts(s => s.products)

  const [period, setPeriod] = useState<ReportPeriod>('today')
  const [customFrom, setCustomFrom] = useState(ymdLocal(new Date(Date.now() - 6 * 864e5)))
  const [customTo, setCustomTo] = useState(ymdLocal())
  const [posFilter, setPosFilter] = useState('')
  const [cashierFilter, setCashierFilter] = useState('')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [statusFilter, setStatusFilter] = useState<SaleStatusFilter>('all')
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<ReportTab>('overview')
  const [productView, setProductView] = useState<'top' | 'unsold' | 'dead' | 'loss' | 'order' | 'abc' | 'categories' | 'suppliers'>('top')
  const [showHelp, setShowHelp] = useState(false)
  const [comparePrev, setComparePrev] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [truth, setTruth] = useState<FinanceTruthBundle | null>(null)

  const { from, to } = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )
  const defPos = useMemo(() => defaultPosId(posPoints), [posPoints])
  const filterPosId = posFilter || null
  const filterCashier = cashierFilter || null

  const periodSalesAll = useMemo(
    () => filterSales(sales, {
      from, to, posId: filterPosId, defPos, cashierId: filterCashier,
    }),
    [sales, from, to, filterPosId, defPos, filterCashier],
  )

  const periodSales = useMemo(
    () => filterSales(sales, {
      from, to, posId: filterPosId, defPos,
      cashierId: filterCashier, pay: payFilter, status: statusFilter, q,
    }),
    [sales, from, to, filterPosId, defPos, filterCashier, payFilter, statusFilter, q],
  )

  const returnSales = useMemo(
    () => periodSalesAll.filter(s => isSaleFullyReturned(s) || isSalePartiallyReturned(s)),
    [periodSalesAll],
  )

  const periodShifts = useMemo(
    () => filterShifts(shifts, from, to, filterPosId, defPos, filterCashier),
    [shifts, from, to, filterPosId, defPos, filterCashier],
  )
  const periodReceipts = useMemo(() => filterByCreatedAt(receipts, from, to), [receipts, from, to])
  const periodWriteoffs = useMemo(() => filterByCreatedAt(writeoffs, from, to), [writeoffs, from, to])
  const periodRevisions = useMemo(() => filterByCreatedAt(revisions, from, to), [revisions, from, to])
  const periodExpenses = useMemo(() => filterByCreatedAt(expenses, from, to), [expenses, from, to])
  const periodMoves = useMemo(
    () => filterByCreatedAt(financeMoves, from, to).filter(m => {
      if (!filterPosId) return true
      if (!m.posId) return true
      return m.posId === filterPosId
    }),
    [financeMoves, from, to, filterPosId],
  )

  const salesAgg = useMemo(() => aggregateSales(periodSalesAll), [periodSalesAll])
  const filteredAgg = useMemo(() => aggregateSales(periodSales), [periodSales])
  const productsById = useMemo(() => new Map(products.map(p => [Number(p.id), p])), [products])
  const productRows = useMemo(() => topProducts(periodSalesAll, productsById, 10_000), [periodSalesAll, productsById])
  const productInsights = useMemo(
    () => buildProductInsights(products, periodSalesAll, periodReceipts),
    [products, periodSalesAll, periodReceipts],
  )
  const sales30d = useMemo(
    () => {
      const { from: f, to: t } = lookbackRange(30)
      return filterSales(sales, {
        from: f, to: t, posId: filterPosId, defPos, cashierId: filterCashier,
      })
    },
    [sales, filterPosId, defPos, filterCashier],
  )
  const sales7d = useMemo(
    () => {
      const { from: f, to: t } = lookbackRange(7)
      return filterSales(sales, {
        from: f, to: t, posId: filterPosId, defPos, cashierId: filterCashier,
      })
    },
    [sales, filterPosId, defPos, filterCashier],
  )
  const stockInsights = useMemo(
    () => buildProductInsights(products, sales30d, receipts),
    [products, sales30d, receipts],
  )
  const orderInsights = useMemo(
    () => buildProductInsights(products, sales7d, receipts),
    [products, sales7d, receipts],
  )
  const cogs = useMemo(() => sumCogs(productRows), [productRows])
  const purchaseCost = useMemo(() => sumReceiptCost(periodReceipts), [periodReceipts])
  const purchasePaid = useMemo(() => sumReceiptPaid(periodReceipts), [periodReceipts])
  const writeoffCost = useMemo(() => sumWriteoffCost(periodWriteoffs), [periodWriteoffs])
  const expenseTotal = useMemo(() => sumExpenses(periodExpenses), [periodExpenses])
  const revStats = useMemo(() => revisionDiffCount(periodRevisions), [periodRevisions])
  const byCashier = useMemo(() => cashierStats(periodSalesAll), [periodSalesAll])
  const byDay = useMemo(() => dailyBreakdown(periodSalesAll), [periodSalesAll])
  const byPoint = useMemo(() => pointStats(periodSalesAll, posPoints, defPos), [periodSalesAll, posPoints, defPos])
  const byHour = useMemo(() => hourlyBreakdown(periodSalesAll), [periodSalesAll])
  const abcRows = useMemo(() => abcClassify(productInsights.all), [productInsights.all])
  const lossRows = useMemo(() => lossProducts(productInsights.all), [productInsights.all])
  const orderRows = useMemo(() => orderSuggestions(orderInsights.all, 7), [orderInsights.all])

  const prevRange = useMemo(
    () => previousPeriodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )
  const prevSales = useMemo(
    () => filterSales(sales, {
      from: prevRange.from, to: prevRange.to, posId: filterPosId, defPos, cashierId: filterCashier,
    }),
    [sales, prevRange, filterPosId, defPos, filterCashier],
  )
  const prevAgg = useMemo(() => aggregateSales(prevSales), [prevSales])

  const historyRepaid = useMemo(() => {
    let n = 0
    for (const c of clients) {
      if (!c.phone) continue
      for (const row of loadDebtHistory(c.phone)) {
        if (row.type !== 'pay') continue
        const iso = row.ts ? new Date(row.ts).toISOString() : ''
        if (!inPeriod(iso, from, to)) continue
        n = round2(n + (Number(row.amount) || 0))
      }
    }
    return n
  }, [clients, from, to])
  const repaidPick = useMemo(
    () => pickDebtRepaid({
      journal: truth?.journal,
      cashBook: truth?.cashBook?.entries,
      historyTotal: historyRepaid,
    }),
    [truth, historyRepaid],
  )
  const supplierDebt = useMemo(
    () => round2(suppliers.reduce((s, x) => s + (Number(x.payableAmount) || 0), 0)),
    [suppliers],
  )
  const clientDebtors = useMemo(
    () => [...clients].filter(c => (Number(c.debt) || 0) > 0.001).sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0)),
    [clients],
  )
  const clientDebtTotal = useMemo(
    () => round2(clientDebtors.reduce((s, c) => s + (Number(c.debt) || 0), 0)),
    [clientDebtors],
  )
  const debtRepaid = repaidPick.amount
  const debtLeft = round2(Math.max(0, clientDebtTotal))
  const repaidAllPoints = repaidPick.source === 'history' && !!(posFilter || cashierFilter)
  const creditSales = useMemo(
    () => periodSalesAll.filter(s => !isSaleFullyReturned(s) && (Number(s.debtAdded) || 0) > 0.001),
    [periodSalesAll],
  )
  const grossProfit = useMemo(() => round2(salesAgg.revenue - cogs), [salesAgg.revenue, cogs])
  const netProfit = useMemo(() => round2(grossProfit - expenseTotal), [grossProfit, expenseTotal])
  const openShiftsNow = useMemo(
    () => shifts.filter(s => {
      if (s.status !== 'open') return false
      if (!matchesPos(s.posId, filterPosId, defPos)) return false
      if (filterCashier && s.cashierId !== filterCashier && s.cashierName !== filterCashier) return false
      return true
    }),
    [shifts, filterPosId, defPos, filterCashier],
  )
  const depositSum = useMemo(() => sumFinanceMoves(periodMoves, 'deposit'), [periodMoves])
  const withdrawSum = useMemo(() => sumFinanceMoves(periodMoves, 'withdraw'), [periodMoves])
  const tillIn = useMemo(() => round2(salesAgg.cash + depositSum), [salesAgg.cash, depositSum])
  const cashless = useMemo(() => round2(salesAgg.card + salesAgg.wallet), [salesAgg.card, salesAgg.wallet])
  const tillOut = useMemo(
    () => round2(purchasePaid + expenseTotal + withdrawSum),
    [purchasePaid, expenseTotal, withdrawSum],
  )
  const shiftRows = useMemo(() => {
    const seen = new Set(periodShifts.map(s => s.id))
    return [...openShiftsNow.filter(s => !seen.has(s.id)), ...periodShifts]
  }, [openShiftsNow, periodShifts])
  const dbTill = truth?.expectedVsActual
  const profitPct = salesAgg.revenue > 0 ? round2((grossProfit / salesAgg.revenue) * 100) : 0

  const periodLabel = formatPeriodLabel(period, customFrom, customTo)
  const activeTabHint = REPORT_TABS.find(t => t.id === tab)?.hint || ''
  const compareOn = comparePrev && canComparePeriod(period)
  const prevLabel = comparePeriodLabel(period)
  const revDelta = compareOn ? deltaPct(salesAgg.revenue, prevAgg.revenue) : null

  const apiQuery = useMemo(
    () => periodToApiQuery(period, customFrom, customTo, {
      posId: posFilter || undefined,
      cashierId: cashierFilter || undefined,
    }),
    [period, customFrom, customTo, posFilter, cashierFilter],
  )

  const loadTruth = useCallback(async () => {
    // Всегда локально — Отчёты работают без сервера
    setTruth(buildLocalFinanceTruth({
      shifts,
      financeMoves,
      expenses,
      sales,
      fromMs: from,
      toMs: to,
      posId: posFilter || undefined,
      cashierId: cashierFilter || undefined,
    }))
    if (!USE_API) return
    try {
      const { useOfflineSync } = await import('@/lib/offlineSync')
      const { isOnline } = await import('@/lib/offline')
      const online = isOnline() && useOfflineSync.getState().online
      if (!online) {
        void cacheFinanceTruth(apiQuery, buildLocalFinanceTruth({
          shifts, financeMoves, expenses, sales,
          fromMs: from, toMs: to,
          posId: posFilter || undefined,
          cashierId: cashierFilter || undefined,
        }))
        return
      }
      const data = await api.getFinanceTruth(apiQuery)
      setTruth(data)
      void cacheFinanceTruth(apiQuery, data)
    } catch {
      // Без сети — локальный расчёт уже на экране
      const cached = await readCachedFinanceTruth(apiQuery)
      if (cached) {
        setTruth(cached)
      }
    }
  }, [apiQuery, shifts, financeMoves, expenses, sales, from, to, posFilter, cashierFilter])

  useEffect(() => {
    void loadTruth()
  }, [loadTruth])

  const refresh = useCallback(() => {
    setRefreshing(true)
    void (async () => {
      try {
        const { useOfflineSync } = await import('@/lib/offlineSync')
        const { isOnline } = await import('@/lib/offline')
        const online = isOnline() && useOfflineSync.getState().online
        if (online) {
          await Promise.allSettled([
            softSyncPosAfterSale(),
            softSyncWarehouse(),
            syncClientsFromApi(),
          ])
        }
        await loadTruth()
      } finally {
        setRefreshing(false)
      }
    })()
  }, [loadTruth])

  function resetFilters() {
    setPeriod('today')
    setPosFilter('')
    setCashierFilter('')
    setPayFilter('all')
    setStatusFilter('all')
    setQ('')
    setComparePrev(false)
  }

  function exportSales() {
    downloadCsv(
      `kakapo-sales-${periodLabel}.csv`,
      ['Чек', 'Дата', 'Точка', 'Кассир', 'Оплата', 'Клиент', 'Сумма', 'Нал', 'Карта', 'Кошелёк', 'Долг', 'Статус'],
      periodSales.map(s => {
        const full = isSaleFullyReturned(s)
        const partial = isSalePartiallyReturned(s)
        return [
          saleNumberLabel(s),
          fmtDateTime(s.createdAtIso),
          posName(posPoints, s.posId || defPos),
          s.cashierName || '',
          paymentLabel(s),
          s.clientName || '',
          Number(s.total) || 0,
          Number(s.paidCash) || 0,
          Number(s.paidCard) || 0,
          Number(s.paidWallet) || 0,
          Number(s.debtAdded) || 0,
          full ? 'Возврат' : partial ? 'Частичный' : 'Продажа',
        ]
      }),
    )
  }

  function exportProducts() {
    if (productView === 'categories') {
      downloadCsv(
        `kakapo-categories-${periodLabel}.csv`,
        ['Категория', 'Товаров', 'Продавались', 'Не продавались', 'Кол-во', 'Выручка', 'Себест', 'Прибыль', 'Остаток'],
        productInsights.categories.map(r => [
          r.cat, r.products, r.soldProducts, r.unsoldProducts, r.qty, r.revenue, r.cogs, r.profit, r.stock,
        ]),
      )
      return
    }
    if (productView === 'suppliers') {
      downloadCsv(
        `kakapo-product-suppliers-${periodLabel}.csv`,
        ['Поставщик', 'Товаров', 'Приходов', 'Закуп', 'Оплачено', 'Долг', 'Продано', 'Выручка', 'Себест', 'Прибыль'],
        productInsights.suppliers.map(r => [
          r.name, r.products, r.receipts, r.suppliedCost, r.paid, r.debt, r.soldQty, r.revenue, r.cogs, r.profit,
        ]),
      )
      return
    }
    if (productView === 'abc') {
      downloadCsv(
        `kakapo-abc-${periodLabel}.csv`,
        ['ABC', 'Товар', 'Выручка', 'Доля %', 'Кол-во', 'Прибыль', 'Остаток'],
        abcRows.map(r => [r.abc, r.productName, r.revenue, r.share, r.qty, r.profit, r.stock]),
      )
      return
    }
    if (productView === 'loss') {
      downloadCsv(
        `kakapo-loss-${periodLabel}.csv`,
        ['Товар', 'Причина', 'Кол-во', 'Выручка', 'Себест', 'Прибыль', 'Остаток'],
        lossRows.map(r => [r.productName, r.reason, r.qty, r.revenue, r.cogs, r.profit, r.stock]),
      )
      return
    }
    if (productView === 'order') {
      downloadCsv(
        `kakapo-order-${periodLabel}.csv`,
        ['Товар', 'Остаток', 'Продано', 'Заказать', 'Причина'],
        orderRows.map(r => [r.productName, r.stock, r.qty, r.suggestQty, r.reason]),
      )
      return
    }
    const rows = productView === 'top'
      ? productInsights.top
      : productView === 'dead'
        ? stockInsights.deadStock
        : stockInsights.unsold
    downloadCsv(
      `kakapo-products-${productView}-${periodLabel}.csv`,
      ['Товар', 'Категория', 'Поставщик', 'Остаток', 'Цена', 'Кол-во', 'Выручка', 'Себест', 'Прибыль'],
      rows.map(r => [r.productName, r.cat, r.supplierName, r.stock, r.price, r.qty, r.revenue, r.cogs, r.profit]),
    )
  }

  // Не блокируем «Загрузка…» — сначала локальные продажи/отчёты

  const filterCount = [
    posFilter,
    cashierFilter,
    payFilter !== 'all' ? payFilter : '',
    statusFilter !== 'all' ? statusFilter : '',
    q.trim(),
  ].filter(Boolean).length

  return (
    <div className="k-reports-mod">
      <div className="k-rep-toolbar">
        <div className="k-subtabs k-rep-periods">
          {REPORT_PERIODS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`k-subtab ${period === p.id ? 'active' : ''}`}
              onClick={() => {
                setPeriod(p.id)
                if (p.id === 'all') setComparePrev(false)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          className={`k-inp k-rep-search${tab === 'cashiers' || tab === 'shifts' || tab === 'till' ? ' k-rep-search-opt' : ''}`}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск: чек, клиент…"
          aria-label="Поиск"
        />
        <div className="k-rep-actions">
          <button type="button" className="k-btn k-btn-s" title="Справка" onClick={() => setShowHelp(v => !v)}>
            ?
          </button>
          <button
            type="button"
            className={`k-btn k-btn-s${compareOn ? ' is-on' : ''}`}
            title={canComparePeriod(period) ? `Сравнить ${comparePeriodLabel(period)}` : 'Для «Всё время» сравнивать не с чем'}
            disabled={!canComparePeriod(period)}
            onClick={() => setComparePrev(v => !v)}
          >
            ±
          </button>
          <button
            type="button"
            className={`k-btn k-btn-s k-rep-flt-btn${filtersOpen || filterCount ? ' is-on' : ''}`}
            title="Фильтры"
            onClick={() => setFiltersOpen(v => !v)}
          >
            ⚙{filterCount ? ` ${filterCount}` : ''}
          </button>
          <button type="button" className="k-btn k-btn-s" title="Сбросить" onClick={resetFilters}>↺</button>
          <button type="button" className="k-btn k-btn-s" disabled={refreshing} title="Обновить" onClick={() => void refresh()}>
            {refreshing ? '…' : '↻'}
          </button>
        </div>
      </div>

      {period === 'custom' && (
        <div className="k-rep-dates">
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>С</label>
            <input className="k-inp" type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          </div>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>По</label>
            <input className="k-inp" type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      {showHelp && (
        <div className="k-rep-help">
          <b>Как смотреть</b>
          <div>1) Период сверху · ± сравнение: сегодня с вчера, месяц с прошлым месяцем</div>
          <div>2) Долг: выдали и вернули — за выбранные дни. Осталось — сколько должны сейчас</div>
          <div>3) Доход = продажи − закуп товара. После расходов = ещё минус расходы кассы</div>
          <div>4) Товары: топ за период · не продавались / залежались за 30 дней · заказ по 7 дням</div>
        </div>
      )}

      <div className={`k-rep-filters${filtersOpen ? ' is-open' : ''}`}>
        <select className="k-sel" value={posFilter} onChange={e => setPosFilter(e.target.value)} title="Точка" aria-label="Точка">
          <option value="">Точка · все</option>
          {posPoints.filter(p => p.active !== false).map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className="k-sel" value={cashierFilter} onChange={e => setCashierFilter(e.target.value)} title="Кассир" aria-label="Кассир">
          <option value="">Кассир · все</option>
          {cashiers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="k-sel" value={payFilter} onChange={e => setPayFilter(e.target.value as PayFilter)} title="Оплата" aria-label="Оплата">
          {PAY_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select className="k-sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value as SaleStatusFilter)} title="Статус" aria-label="Статус">
          {SALE_STATUS_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      {(payFilter !== 'all' || statusFilter !== 'all' || q.trim()) && (
        <div className="k-rep-filter-note">
          Фильтр продаж: {periodSales.length} из {periodSalesAll.length} · {periodLabel}
        </div>
      )}

      {/* Сетевые ошибки не блокируют отчёты — данные из локального стора */}
      {apiError && !truth && (
        <div className="k-rep-err">{apiError}</div>
      )}

      <div className="k-subtabs k-rep-tabs">
        {REPORT_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`k-subtab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            title={t.hint}
          >
            <span className="k-rep-tab-ic">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {activeTabHint && <div className="k-rep-hint">{activeTabHint}</div>}

      {tab === 'overview' && (
        <>
          <div className="k-rep-highlight">
            <div>
              <span>Выручка</span>
              <b style={{ color: 'var(--green)' }}>{fmtMoney(salesAgg.revenue)}</b>
              {compareOn && (
                <small style={{ color: revDelta == null ? 'var(--muted)' : revDelta >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 800 }}>
                  {revDelta != null ? `${revDelta >= 0 ? '+' : ''}${revDelta}% ${prevLabel}` : `было ${fmtMoney(prevAgg.revenue)}`}
                </small>
              )}
            </div>
            <div>
              <span>Доход без расходов</span>
              <b style={{ color: grossProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(grossProfit)}</b>
              <small style={{ color: 'var(--muted)' }}>продажи − закуп товара</small>
            </div>
            <div>
              <span>После расходов</span>
              <b style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(netProfit)}</b>
              <small style={{ color: 'var(--muted)' }}>ещё − {fmtMoney(expenseTotal)} расходов</small>
            </div>
            <div>
              <span>% дохода</span>
              <b style={{ color: profitPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{profitPct}%</b>
            </div>
          </div>

          {compareOn && (
            <div className="k-rep-note">
              Было {prevLabel}: выручка {fmtMoney(prevAgg.revenue)}
              {' · '}нал {fmtMoney(prevAgg.cash)}
              {' · '}карта {fmtMoney(prevAgg.card)}
              {prevAgg.wallet > 0.001 ? ` · кошелёк ${fmtMoney(prevAgg.wallet)}` : ''}
              {' · '}долг {fmtMoney(prevAgg.credit)}
              {' · '}чеков {prevAgg.salesCount}
            </div>
          )}

          <div className="k-rep-stats">
            <div><span>Нал</span><b>{fmtMoney(salesAgg.cash)}</b></div>
            <div><span>Карта</span><b>{fmtMoney(salesAgg.card)}</b></div>
            <div><span>Кошелёк</span><b>{fmtMoney(salesAgg.wallet)}</b></div>
            <div title="За выбранные дни"><span>Выдали за дни</span><b style={{ color: 'var(--gold)' }}>{fmtMoney(salesAgg.credit)}</b></div>
            <div title={repaidAllPoints ? 'Погашения без точки — все клиенты' : 'За выбранные дни'}>
              <span>Вернули за дни</span>
              <b style={{ color: 'var(--green)' }}>{fmtMoney(debtRepaid)}</b>
            </div>
            <div title="Сколько клиенты должны сейчас, не за период"><span>Сейчас должны</span><b style={{ color: 'var(--gold)' }}>{fmtMoney(debtLeft)}</b></div>
            <div><span>Чеков</span><b>{salesAgg.salesCount}</b></div>
            <div><span>Ср. чек</span><b>{fmtMoney(salesAgg.avgCheck)}</b></div>
            <div><span>Возвраты</span><b style={{ color: 'var(--red)' }}>{salesAgg.returnedCount}</b></div>
            <div title="Нал продаж + вклады в кассу"><span>В кассу</span><b style={{ color: 'var(--green)' }}>{fmtMoney(tillIn)}</b></div>
            <div title="Карта + кошелёк"><span>Безнал</span><b>{fmtMoney(cashless)}</b></div>
            <div title="Расходы + снятия + оплата закупа"><span>Из кассы</span><b>{fmtMoney(tillOut)}</b></div>
            <div><span>Закупки</span><b>{fmtMoney(purchaseCost)}</b></div>
            <div><span>Расходы</span><b>{fmtMoney(expenseTotal)}</b></div>
            <div><span>Поставщ.</span><b>{fmtMoney(supplierDebt)}</b></div>
            <div><span>Должников</span><b>{clientDebtors.length}</b></div>
          </div>

          <div className="k-rep-note">
            Выдали / вернули — за {periodLabel}. Сейчас должны — сколько на клиентах сейчас
            {repaidAllPoints ? ' · вернули: все точки (в погашении нет точки)' : ''}
            {' · '}открыто сейчас {openShiftsNow.length} / смен в периоде {periodShifts.length}
            {' · '}списания {periodWriteoffs.length} ({fmtMoney(writeoffCost)})
            {' · '}ревизии {revStats.count}
            {(dbTill?.summary.withAlert ?? 0) > 0
              ? ` · ⚠ ${dbTill?.summary.withAlert} сверки ≥ ${dbTill?.threshold} сом`
              : ''}
          </div>

          <div className="k-rep-split">
            <div className="k-rep-panel">
              <div className="k-rep-panel-h">По дням</div>
              {!byDay.length ? (
                <div className="k-empty">Нет продаж</div>
              ) : (
                <div className="k-rep-list">
                  {byDay.slice(0, 60).map(d => (
                    <div key={d.day} className="k-rep-row">
                      <div className="k-rep-row-txt">
                        <b>{d.day}</b>
                        <small>{d.checks} чек. · нал {fmtMoney(d.cash)} · карта {fmtMoney(d.card)}</small>
                      </div>
                      <b className="k-rep-amt">{fmtMoney(d.revenue)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="k-rep-panel">
              <div className="k-rep-panel-h">
                <span>Топ товаров</span>
                <button type="button" className="k-btn k-btn-s" onClick={exportProducts}>CSV</button>
              </div>
              {!productRows.length ? (
                <div className="k-empty">Нет продаж</div>
              ) : (
                <div className="k-rep-list">
                  {productRows.slice(0, 12).map((r, i) => (
                    <div key={r.productId} className="k-rep-row">
                      <div className="k-rep-row-txt">
                        <b>{i + 1}. {r.productName}</b>
                        <small>×{r.qty} · себ. {fmtMoney(r.cogs)}</small>
                      </div>
                      <b className="k-rep-amt" style={{ color: 'var(--green)' }}>{fmtMoney(r.revenue)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="k-rep-split">
            <div className="k-rep-panel">
              <div className="k-rep-panel-h">По точкам</div>
              {!byPoint.length ? (
                <div className="k-empty">Нет продаж</div>
              ) : (
                <div className="k-rep-list">
                  {byPoint.map(p => (
                    <div key={p.key} className="k-rep-row">
                      <div className="k-rep-row-txt">
                        <b>{p.name}</b>
                        <small>{p.checks} чек. · нал {fmtMoney(p.cash)} · карта {fmtMoney(p.card)} · долг {fmtMoney(p.credit)}</small>
                      </div>
                      <b className="k-rep-amt">{fmtMoney(p.revenue)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="k-rep-panel">
              <div className="k-rep-panel-h">Пик по часам</div>
              {byHour.every(h => !h.checks) ? (
                <div className="k-empty">Нет продаж</div>
              ) : (
                <div className="k-rep-list">
                  {[...byHour].filter(h => h.checks > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8).map(h => (
                    <div key={h.hour} className="k-rep-row">
                      <div className="k-rep-row-txt">
                        <b>{String(h.hour).padStart(2, '0')}:00</b>
                        <small>{h.checks} чек.</small>
                      </div>
                      <b className="k-rep-amt">{fmtMoney(h.revenue)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'sales' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Показано</div><div className="kv">{periodSales.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выручка (фильтр)</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(filteredAgg.revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Нал / Карта / Кошелёк</div><div className="kv">{fmtMoney(filteredAgg.cash)} / {fmtMoney(filteredAgg.card)} / {fmtMoney(filteredAgg.wallet)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Долг</div><div className="kv">{fmtMoney(filteredAgg.credit)}</div></div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h">
              <b>Чеки</b>
              <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportSales}>CSV</button>
            </div>
            {!periodSales.length ? (
              <div className="k-empty">Нет чеков по фильтрам</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Чек</th>
                      <th>Дата</th>
                      <th>Точка</th>
                      <th>Кассир</th>
                      <th>Оплата</th>
                      <th>Клиент</th>
                      <th>Сумма</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodSales.slice(0, 300).map(s => {
                      const full = isSaleFullyReturned(s)
                      const partial = isSalePartiallyReturned(s)
                      return (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 800 }}>{saleNumberLabel(s)}</td>
                          <td>{fmtDateTime(s.createdAtIso)}</td>
                          <td>{posName(posPoints, s.posId || defPos)}</td>
                          <td>{s.cashierName || '—'}</td>
                          <td>{paymentLabel(s)}</td>
                          <td>{s.clientName || '—'}</td>
                          <td style={{ fontWeight: 800 }}>{fmtMoney(s.total)}</td>
                          <td style={{ color: full ? 'var(--red)' : partial ? 'var(--gold)' : 'var(--green)' }}>
                            {full ? 'Возврат' : partial ? 'Частичный' : 'Продажа'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'returns' && (
        <div className="k-card" style={{ overflow: 'hidden' }}>
          <div className="k-card-h">
            <b>Возвраты · {returnSales.length}</b>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>Сумма возвратов ≈ {fmtMoney(salesAgg.returnTotal)}</span>
          </div>
          {!returnSales.length ? (
            <div className="k-empty">Возвратов за период нет</div>
          ) : (
            <div className="k-tbl-scroll">
              <table className="k-tbl">
                <thead>
                  <tr>
                    <th>Чек</th>
                    <th>Дата</th>
                    <th>Точка</th>
                    <th>Кассир</th>
                    <th>Тип</th>
                    <th>Сумма чека</th>
                    <th>Возврат</th>
                  </tr>
                </thead>
                <tbody>
                  {returnSales.map(s => {
                    const full = isSaleFullyReturned(s)
                    return (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 800 }}>{saleNumberLabel(s)}</td>
                        <td>{fmtDateTime(s.createdAtIso)}</td>
                        <td>{posName(posPoints, s.posId || defPos)}</td>
                        <td>{s.cashierName || '—'}</td>
                        <td style={{ color: full ? 'var(--red)' : 'var(--gold)' }}>{full ? 'Полный' : 'Частичный'}</td>
                        <td>{fmtMoney(s.originalTotal || s.total)}</td>
                        <td style={{ fontWeight: 800 }}>{fmtMoney(s.lastReturnTotal || (full ? s.originalTotal || s.total : 0))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'cashiers' && (
        <div className="k-rep-panel">
          <div className="k-rep-panel-h"><span>Кассиры</span></div>
          {!byCashier.length ? (
            <div className="k-empty">Нет продаж по кассирам</div>
          ) : (
            <div className="k-rep-list">
              {byCashier.map(r => (
                <div key={r.key} className="k-rep-row k-rep-row-rich">
                  <div className="k-rep-row-txt">
                    <b>{r.name}</b>
                    <small>{r.checks} чек. · возвратов {r.returns || 0}</small>
                  </div>
                  <b className="k-rep-amt" style={{ color: 'var(--green)' }}>{fmtMoney(r.revenue)}</b>
                  <div className="k-rep-row-metrics">
                    <div><span>Нал</span><b>{fmtMoney(r.cash)}</b></div>
                    <div><span>Карта</span><b>{fmtMoney(r.card)}</b></div>
                    <div><span>Долг</span><b>{fmtMoney(r.credit)}</b></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'hours' && (
        <div className="k-card" style={{ overflow: 'hidden' }}>
          <div className="k-card-h"><b>Продажи по часам</b></div>
          {byHour.every(h => !h.checks) ? (
            <div className="k-empty">Нет продаж за период</div>
          ) : (
            <div className="k-tbl-scroll">
              <table className="k-tbl">
                <thead>
                  <tr>
                    <th>Час</th>
                    <th>Чеков</th>
                    <th>Выручка</th>
                    <th>Нал</th>
                    <th>Карта</th>
                    <th>Долг</th>
                  </tr>
                </thead>
                <tbody>
                  {byHour.map(h => (
                    <tr key={h.hour} style={{ opacity: h.checks ? 1 : 0.45 }}>
                      <td style={{ fontWeight: 800 }}>{String(h.hour).padStart(2, '0')}:00</td>
                      <td>{h.checks}</td>
                      <td style={{ fontWeight: 800 }}>{fmtMoney(h.revenue)}</td>
                      <td>{fmtMoney(h.cash)}</td>
                      <td>{fmtMoney(h.card)}</td>
                      <td>{fmtMoney(h.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'shifts' && (
        <>
          <div className="k-rep-stats">
            <div><span>Смен в периоде</span><b>{periodShifts.length}</b></div>
            <div title="Все открытые сейчас, даже если открыли вчера"><span>Открыто сейчас</span><b style={{ color: 'var(--green)' }}>{openShiftsNow.length}</b></div>
          </div>
          <div className="k-rep-panel">
            {!shiftRows.length ? (
              <div className="k-empty">Нет смен</div>
            ) : (
              <div className="k-rep-list">
                {shiftRows.map(s => {
                  const expected = s.expectedCash != null
                    ? Number(s.expectedCash)
                    : round2((Number(s.openingCash) || 0) + (Number(s.salesCash) || 0) + (Number(s.cashInTotal) || 0) - (Number(s.expenseTotal) || 0))
                  const actual = s.actualCash != null ? Number(s.actualCash) : (s.closingCash != null ? Number(s.closingCash) : null)
                  const diff = s.cashDiff != null
                    ? Number(s.cashDiff)
                    : actual != null ? round2(actual - expected) : null
                  const open = s.status === 'open'
                  return (
                    <div key={s.id} className="k-rep-row k-rep-row-rich">
                      <div className="k-rep-row-txt">
                        <b style={{ color: open ? 'var(--green)' : 'var(--muted)' }}>
                          {open ? '● Открыта' : '○ Закрыта'} · {s.cashierName || '—'}
                        </b>
                        <small>
                          {posName(posPoints, s.posId || defPos)}
                          {' · '}
                          {s.openedAtIso ? fmtDateTime(s.openedAtIso) : '—'}
                          {s.closedAtIso ? ` → ${fmtDateTime(s.closedAtIso)}` : ''}
                        </small>
                      </div>
                      <b className="k-rep-amt">{s.salesCount || 0} пр.</b>
                      <div className="k-rep-row-metrics">
                        <div><span>Нал</span><b>{fmtMoney(s.salesCash)}</b></div>
                        <div><span>Карта</span><b>{fmtMoney(s.salesCard)}</b></div>
                        <div><span>Долг</span><b>{fmtMoney(s.salesCredit)}</b></div>
                        <div><span>Старт</span><b>{fmtMoney(s.openingCash)}</b></div>
                        <div><span>Ожид.</span><b>{s.status === 'closed' ? fmtMoney(expected) : '—'}</b></div>
                        <div>
                          <span>Δ</span>
                          <b style={{
                            color: diff == null || Math.abs(diff) < 0.009 ? 'var(--muted)' : diff < 0 ? 'var(--red)' : 'var(--green)',
                          }}>
                            {diff == null ? '—' : `${diff > 0 ? '+' : ''}${fmtMoney(diff)}`}
                          </b>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'till' && (
        <>
          <div className="k-rep-stats">
            <div><span>Смен</span><b>{dbTill?.summary.shifts ?? 0}</b></div>
            <div><span>Алерты</span><b style={{ color: 'var(--red)' }}>{dbTill?.summary.withAlert ?? 0}</b></div>
            <div><span>Недостачи</span><b style={{ color: 'var(--red)' }}>{dbTill?.summary.shortCount ?? 0}</b></div>
            <div><span>Излишки</span><b style={{ color: 'var(--green)' }}>{dbTill?.summary.overCount ?? 0}</b></div>
          </div>
          <div className="k-rep-panel">
            <div className="k-rep-panel-h"><span>Ожидаемое vs факт</span></div>
            {!dbTill?.rows?.length ? (
              <div className="k-empty">Нет закрытых смен за период</div>
            ) : (
              <div className="k-rep-list">
                {dbTill.rows.map(r => (
                  <div
                    key={r.shiftId}
                    className={`k-rep-row k-rep-row-rich${r.alert ? ' is-warn' : ''}`}
                  >
                    <div className="k-rep-row-txt">
                      <b>{r.day} · {r.cashierName || '—'}</b>
                      <small>{posName(posPoints, r.posId || defPos)}</small>
                    </div>
                    <b
                      className="k-rep-amt"
                      style={{
                        color: Math.abs(r.cashDiff) < 0.009 ? 'var(--muted)' : r.cashDiff < 0 ? 'var(--red)' : 'var(--green)',
                      }}
                    >
                      {r.cashDiff > 0 ? '+' : ''}{fmtMoney(r.cashDiff)}{r.alert ? ' ⚠' : ''}
                    </b>
                    <div className="k-rep-row-metrics k-rep-row-metrics-2">
                      <div><span>Ожидалось</span><b>{fmtMoney(r.expectedCash)}</b></div>
                      <div><span>Факт</span><b>{fmtMoney(r.actualCash)}</b></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'profit' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Выручка</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(salesAgg.revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Закуп товара</div><div className="kv">{fmtMoney(cogs)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Доход без расходов</div>
              <div className="kv" style={{ color: grossProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(grossProfit)}</div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Расходы кассы</div><div className="kv" style={{ color: 'var(--red)' }}>{fmtMoney(expenseTotal)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">После расходов</div>
              <div className="kv" style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(netProfit)}</div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">% дохода</div><div className="kv">{profitPct}%</div></div>
          </div>
          <div className="k-rep-note">Доход без расходов = продажи минус закуп товара. После расходов = ещё минус расходы кассы за период.</div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h"><b>Доход по товарам</b></div>
            {!productRows.length ? (
              <div className="k-empty">Нет продаж за период</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Кол-во</th>
                      <th>Выручка</th>
                      <th>Закуп</th>
                      <th>Доход</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.slice(0, 100).map(p => {
                      const rowProfit = round2(p.revenue - p.cogs)
                      return (
                        <tr key={p.productId}>
                          <td style={{ fontWeight: 800 }}>{p.productName}</td>
                          <td>{p.qty}</td>
                          <td>{fmtMoney(p.revenue)}</td>
                          <td>{fmtMoney(p.cogs)}</td>
                          <td style={{ fontWeight: 900, color: rowProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(rowProfit)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'warehouse' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Приходы</div><div className="kv">{periodReceipts.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Сумма приходов</div><div className="kv">{fmtMoney(purchaseCost)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Списания</div><div className="kv" style={{ color: 'var(--red)' }}>{periodWriteoffs.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Сумма списаний</div><div className="kv">{fmtMoney(writeoffCost)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Ревизии</div><div className="kv">{revStats.count}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Риск срока</div><div className="kv">{expiry.length}</div></div>
          </div>

          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div className="k-card-h"><b>Приходы</b></div>
            {!periodReceipts.length ? <div className="k-empty">Нет приходов</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Поставщик</th>
                      <th>Поз.</th>
                      <th>Сумма</th>
                      <th>Оплачено</th>
                      <th>В долг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodReceipts.slice(0, 100).map(r => (
                      <tr key={r.id}>
                        <td>{fmtDateTime(r.createdAtIso)}</td>
                        <td>{r.supplierName || '—'}</td>
                        <td>{r.items?.length || 0}</td>
                        <td>{fmtMoney(r.totalCost)}</td>
                        <td>{fmtMoney(r.paidNow)}</td>
                        <td>{fmtMoney(r.debtAdded)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div className="k-card-h"><b>Списания</b></div>
            {!periodWriteoffs.length ? <div className="k-empty">Нет списаний</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Причина</th>
                      <th>Поз.</th>
                      <th>Сумма</th>
                      <th>Кто</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodWriteoffs.slice(0, 100).map(w => (
                      <tr key={w.id}>
                        <td>{fmtDateTime(w.createdAtIso)}</td>
                        <td>{w.reason || '—'}</td>
                        <td>{w.items?.length || 0}</td>
                        <td>{fmtMoney(w.totalCost)}</td>
                        <td>{w.createdBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div className="k-card-h"><b>Ревизии</b></div>
            {!periodRevisions.length ? <div className="k-empty">Нет ревизий</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Поз.</th>
                      <th>Кто</th>
                      <th>Заметка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodRevisions.slice(0, 80).map(r => (
                      <tr key={r.id}>
                        <td>{fmtDateTime(r.createdAtIso)}</td>
                        <td>{r.items?.length || 0}</td>
                        <td>{r.createdBy || '—'}</td>
                        <td>{r.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h"><b>Сроки годности</b></div>
            {!expiry.length ? <div className="k-empty">Нет риска по срокам</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Кол-во</th>
                      <th>Срок</th>
                      <th>Дней</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiry.slice(0, 80).map((e, i) => (
                      <tr key={`${e.receiptId}-${e.productId}-${i}`}>
                        <td>{e.productName}</td>
                        <td>{e.qty}</td>
                        <td>{e.expiryDate}</td>
                        <td style={{ color: e.daysLeft <= 0 ? 'var(--red)' : e.daysLeft <= 7 ? 'var(--gold)' : 'var(--text)', fontWeight: 800 }}>
                          {e.daysLeft}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'suppliers' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Долг поставщикам</div><div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(supplierDebt)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Закупки</div><div className="kv">{fmtMoney(purchaseCost)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Оплачено при приходе</div><div className="kv">{fmtMoney(purchasePaid)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Расходы</div><div className="kv">{fmtMoney(expenseTotal)}</div></div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div className="k-card-h"><b>Поставщики</b></div>
            {!suppliers.length ? <div className="k-empty">Нет поставщиков</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Поставщик</th>
                      <th>Долг</th>
                      <th>Поставлено</th>
                      <th>Оплачено</th>
                      <th>Последняя поставка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...suppliers]
                      .sort((a, b) => (Number(b.payableAmount) || 0) - (Number(a.payableAmount) || 0))
                      .map(s => (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 800 }}>{s.name}</td>
                          <td style={{ color: (Number(s.payableAmount) || 0) > 0 ? 'var(--gold)' : 'var(--muted)' }}>{fmtMoney(s.payableAmount)}</td>
                          <td>{fmtMoney(s.totalSupplied)}</td>
                          <td>{fmtMoney(s.totalPaid)}</td>
                          <td>{s.lastDeliveryAtIso ? fmtDateTime(s.lastDeliveryAtIso) : '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h"><b>Расходы за период</b></div>
            {!periodExpenses.length ? <div className="k-empty">Нет расходов</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Категория</th>
                      <th>Сумма</th>
                      <th>Кто</th>
                      <th>Заметка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodExpenses.map(e => (
                      <tr key={e.id}>
                        <td>{fmtDateTime(e.createdAtIso)}</td>
                        <td>{e.category || '—'}</td>
                        <td style={{ fontWeight: 800 }}>{fmtMoney(e.amount)}</td>
                        <td>{e.createdBy || '—'}</td>
                        <td>{e.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'debts' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard">
              <div className="kl">Сейчас должны</div>
              <div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(debtLeft)}</div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Должников сейчас</div><div className="kv">{clientDebtors.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выдали за дни</div><div className="kv">{fmtMoney(salesAgg.credit)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Вернули за дни</div>
              <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(debtRepaid)}</div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Чеков в долг</div><div className="kv">{creditSales.length}</div></div>
          </div>
          <div className="k-rep-note">
            Выдали и вернули — за {periodLabel}. Сейчас должны — не за период, а сколько осталось на клиентах.
            {repaidAllPoints ? ' Вернули без фильтра точки: в погашении нет точки.' : ''}
          </div>
          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div className="k-card-h"><b>Топ должников</b></div>
            {!clientDebtors.length ? <div className="k-empty">Нет должников</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Клиент</th>
                      <th>Телефон</th>
                      <th>Долг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientDebtors.slice(0, 50).map((c, i) => (
                      <tr key={c.id}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 800 }}>{c.name}</td>
                        <td>{c.phone || '—'}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 900 }}>{fmtMoney(c.debt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h"><b>Продажи в долг</b></div>
            {!creditSales.length ? <div className="k-empty">Нет выдач в долг</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Чек</th>
                      <th>Дата</th>
                      <th>Клиент</th>
                      <th>Точка</th>
                      <th>В долг</th>
                      <th>Итого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditSales.slice(0, 120).map(s => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 800 }}>{saleNumberLabel(s)}</td>
                        <td>{fmtDateTime(s.createdAtIso)}</td>
                        <td>{s.clientName || s.clientPhone || '—'}</td>
                        <td>{posName(posPoints, s.posId || defPos)}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 900 }}>{fmtMoney(s.debtAdded)}</td>
                        <td>{fmtMoney(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'products' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Всего товаров</div><div className="kv">{productInsights.all.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Продавались</div><div className="kv" style={{ color: 'var(--green)' }}>{productInsights.top.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Не продавались 30 дн.</div><div className="kv" style={{ color: 'var(--gold)' }}>{stockInsights.unsold.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Залежались 30 дн.</div><div className="kv" style={{ color: 'var(--red)' }}>{stockInsights.deadStock.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выручка</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(salesAgg.revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Закуп товара</div><div className="kv">{fmtMoney(cogs)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Доход без расходов</div>
              <div className="kv" style={{ color: grossProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(grossProfit)}
              </div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Категорий</div><div className="kv">{productInsights.categories.length}</div></div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {([
              { id: 'top', label: 'Хорошо продаются' },
              { id: 'abc', label: 'ABC' },
              { id: 'order', label: 'Заказать' },
              { id: 'loss', label: 'В минус' },
              { id: 'unsold', label: 'Не продавались' },
              { id: 'dead', label: 'Залежались' },
              { id: 'categories', label: 'Категории' },
              { id: 'suppliers', label: 'Поставщики +/−' },
            ] as const).map(v => (
              <button
                key={v.id}
                type="button"
                className={`k-subtab ${productView === v.id ? 'active' : ''}`}
                style={{ padding: '7px 12px', fontSize: 12 }}
                onClick={() => setProductView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>

          {productView === 'top' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>Топ продаж · {productInsights.top.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!productInsights.top.length ? <div className="k-empty">Нет продаж за период</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Товар</th>
                        <th>Категория</th>
                        <th>Поставщик</th>
                        <th>Остаток</th>
                        <th>Кол-во</th>
                        <th>Выручка</th>
                        <th>Себест.</th>
                        <th>Прибыль</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productInsights.top.map((r, i) => (
                        <tr key={r.productId}>
                          <td>{i + 1}</td>
                          <td style={{ fontWeight: 800 }}>{r.productName}</td>
                          <td>{r.cat}</td>
                          <td>{r.supplierName}</td>
                          <td>{r.stock}</td>
                          <td>{r.qty}</td>
                          <td>{fmtMoney(r.revenue)}</td>
                          <td>{fmtMoney(r.cogs)}</td>
                          <td style={{ color: r.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 800 }}>{fmtMoney(r.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {productView === 'abc' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>ABC · A ≈ 80% выручки, B ≈ 15%, C ≈ 5%</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!abcRows.length ? <div className="k-empty">Нет продаж за период</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>ABC</th>
                        <th>Товар</th>
                        <th>Доля</th>
                        <th>Кол-во</th>
                        <th>Выручка</th>
                        <th>Прибыль</th>
                        <th>Остаток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {abcRows.map(r => (
                        <tr key={r.productId}>
                          <td style={{ fontWeight: 900, color: r.abc === 'A' ? 'var(--green)' : r.abc === 'B' ? 'var(--gold)' : 'var(--muted)' }}>{r.abc}</td>
                          <td style={{ fontWeight: 800 }}>{r.productName}</td>
                          <td>{r.share}%</td>
                          <td>{r.qty}</td>
                          <td>{fmtMoney(r.revenue)}</td>
                          <td style={{ color: r.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(r.profit)}</td>
                          <td>{r.stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {productView === 'order' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>Нужно заказать · продажи за 7 дней · {orderRows.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!orderRows.length ? <div className="k-empty">Пока хватает остатка</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>Товар</th>
                        <th>Остаток</th>
                        <th>Продано</th>
                        <th>Заказать</th>
                        <th>Почему</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderRows.map(r => (
                        <tr key={r.productId}>
                          <td style={{ fontWeight: 800 }}>{r.productName}</td>
                          <td style={{ color: r.stock <= 0 ? 'var(--red)' : 'var(--gold)', fontWeight: 800 }}>{r.stock}</td>
                          <td>{r.qty}</td>
                          <td style={{ fontWeight: 900, color: 'var(--green)' }}>{r.suggestQty}</td>
                          <td>{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {productView === 'loss' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>В минус · {lossRows.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!lossRows.length ? <div className="k-empty">Убыточных продаж нет</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>Товар</th>
                        <th>Причина</th>
                        <th>Кол-во</th>
                        <th>Выручка</th>
                        <th>Себест.</th>
                        <th>Прибыль</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lossRows.map(r => (
                        <tr key={r.productId}>
                          <td style={{ fontWeight: 800 }}>{r.productName}</td>
                          <td>{r.reason}</td>
                          <td>{r.qty}</td>
                          <td>{fmtMoney(r.revenue)}</td>
                          <td>{fmtMoney(r.cogs)}</td>
                          <td style={{ color: 'var(--red)', fontWeight: 900 }}>{fmtMoney(r.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {productView === 'unsold' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>Не продавались 30 дней · {stockInsights.unsold.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!stockInsights.unsold.length ? <div className="k-empty">За 30 дней все товары продавались</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Товар</th>
                        <th>Категория</th>
                        <th>Поставщик</th>
                        <th>Остаток</th>
                        <th>Цена</th>
                        <th>Себест.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockInsights.unsold.slice(0, 150).map((r, i) => (
                        <tr key={r.productId}>
                          <td>{i + 1}</td>
                          <td style={{ fontWeight: 800 }}>{r.productName}</td>
                          <td>{r.cat}</td>
                          <td>{r.supplierName}</td>
                          <td style={{ color: r.stock > 0 ? 'var(--gold)' : 'var(--muted)', fontWeight: 800 }}>{r.stock}</td>
                          <td>{fmtMoney(r.price)}</td>
                          <td>{fmtMoney(r.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {productView === 'dead' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>Залежались · остаток есть, за 30 дней продаж нет · {stockInsights.deadStock.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!stockInsights.deadStock.length ? <div className="k-empty">Нет залежавшихся за 30 дней</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Товар</th>
                        <th>Категория</th>
                        <th>Поставщик</th>
                        <th>Остаток</th>
                        <th>Цена</th>
                        <th>Заморожено ≈</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockInsights.deadStock.map((r, i) => (
                        <tr key={r.productId}>
                          <td>{i + 1}</td>
                          <td style={{ fontWeight: 800 }}>{r.productName}</td>
                          <td>{r.cat}</td>
                          <td>{r.supplierName}</td>
                          <td style={{ color: 'var(--red)', fontWeight: 900 }}>{r.stock}</td>
                          <td>{fmtMoney(r.price)}</td>
                          <td style={{ fontWeight: 800 }}>{fmtMoney(round2(r.stock * (r.cost || r.price)))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {productView === 'categories' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>Категории · {productInsights.categories.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!productInsights.categories.length ? <div className="k-empty">Нет категорий</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>Категория</th>
                        <th>Товаров</th>
                        <th>Продавались</th>
                        <th>Не продавались</th>
                        <th>Кол-во</th>
                        <th>Выручка</th>
                        <th>Себест.</th>
                        <th>Прибыль</th>
                        <th>Остаток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productInsights.categories.map(r => (
                        <tr key={r.cat}>
                          <td style={{ fontWeight: 800 }}>{r.cat}</td>
                          <td>{r.products}</td>
                          <td style={{ color: 'var(--green)' }}>{r.soldProducts}</td>
                          <td style={{ color: r.unsoldProducts ? 'var(--gold)' : 'var(--muted)' }}>{r.unsoldProducts}</td>
                          <td>{r.qty}</td>
                          <td>{fmtMoney(r.revenue)}</td>
                          <td>{fmtMoney(r.cogs)}</td>
                          <td style={{ color: r.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 800 }}>{fmtMoney(r.profit)}</td>
                          <td>{r.stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {productView === 'suppliers' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>Поставщики: плюс / минус · {productInsights.suppliers.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!productInsights.suppliers.length ? <div className="k-empty">Нет приходов поставщиков за период</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>Поставщик</th>
                        <th>Статус</th>
                        <th>Товаров</th>
                        <th>Закуп</th>
                        <th>Продано</th>
                        <th>Выручка</th>
                        <th>Себест.</th>
                        <th>Прибыль</th>
                        <th>Долг</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productInsights.suppliers.map(r => {
                        const plus = r.profit >= 0 && r.revenue > 0
                        const minus = r.profit < 0 || (r.suppliedCost > 0 && r.revenue <= 0)
                        return (
                          <tr key={r.key}>
                            <td style={{ fontWeight: 800 }}>{r.name}</td>
                            <td style={{ fontWeight: 900, color: plus ? 'var(--green)' : minus ? 'var(--red)' : 'var(--muted)' }}>
                              {plus ? 'В плюс' : minus ? 'В минус' : 'Нейтрально'}
                            </td>
                            <td>{r.products}</td>
                            <td>{fmtMoney(r.suppliedCost)}</td>
                            <td>{r.soldQty}</td>
                            <td>{fmtMoney(r.revenue)}</td>
                            <td>{fmtMoney(r.cogs)}</td>
                            <td style={{ color: r.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 900 }}>{fmtMoney(r.profit)}</td>
                            <td style={{ color: r.debt > 0 ? 'var(--gold)' : 'var(--muted)' }}>{fmtMoney(r.debt)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
