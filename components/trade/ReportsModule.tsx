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
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { useProducts } from '@/lib/store'
import { fmtDateTime, fmtMoney } from './warehouse/warehouseShared'
import {
  PAY_OPTS,
  REPORT_PERIODS,
  REPORT_TABS,
  SALE_STATUS_OPTS,
  aggregateSales,
  buildProductInsights,
  cashierStats,
  dailyBreakdown,
  defaultPosId,
  downloadCsv,
  filterByCreatedAt,
  filterSales,
  filterShifts,
  formatPeriodLabel,
  isSaleFullyReturned,
  isSalePartiallyReturned,
  paymentLabel,
  periodRange,
  periodToApiQuery,
  posName,
  revisionDiffCount,
  round2,
  saleNumberLabel,
  sumCogs,
  sumExpenses,
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
  const apiReady = usePosStore(s => s.apiReady)
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
  const [productView, setProductView] = useState<'top' | 'unsold' | 'dead' | 'categories' | 'suppliers'>('top')
  const [showHelp, setShowHelp] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [truth, setTruth] = useState<FinanceTruthBundle | null>(null)
  const [truthLocal, setTruthLocal] = useState(false)

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

  const salesAgg = useMemo(() => aggregateSales(periodSalesAll), [periodSalesAll])
  const filteredAgg = useMemo(() => aggregateSales(periodSales), [periodSales])
  const productsById = useMemo(() => new Map(products.map(p => [Number(p.id), p])), [products])
  const productRows = useMemo(() => topProducts(periodSalesAll, productsById, 100), [periodSalesAll, productsById])
  const productInsights = useMemo(
    () => buildProductInsights(products, periodSalesAll, periodReceipts),
    [products, periodSalesAll, periodReceipts],
  )
  const cogs = useMemo(() => sumCogs(productRows), [productRows])
  const purchaseCost = useMemo(() => sumReceiptCost(periodReceipts), [periodReceipts])
  const purchasePaid = useMemo(() => sumReceiptPaid(periodReceipts), [periodReceipts])
  const writeoffCost = useMemo(() => sumWriteoffCost(periodWriteoffs), [periodWriteoffs])
  const expenseTotal = useMemo(() => sumExpenses(periodExpenses), [periodExpenses])
  const revStats = useMemo(() => revisionDiffCount(periodRevisions), [periodRevisions])
  const byCashier = useMemo(() => cashierStats(periodSalesAll), [periodSalesAll])
  const byDay = useMemo(() => dailyBreakdown(periodSalesAll), [periodSalesAll])

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
  const creditSales = useMemo(
    () => periodSalesAll.filter(s => !isSaleFullyReturned(s) && (Number(s.debtAdded) || 0) > 0.001),
    [periodSalesAll],
  )
  const margin = useMemo(() => round2(salesAgg.revenue - cogs - expenseTotal), [salesAgg.revenue, cogs, expenseTotal])
  const openShiftsNow = useMemo(() => periodShifts.filter(s => s.status === 'open'), [periodShifts])
  const cashIn = useMemo(() => round2(salesAgg.cash + salesAgg.card), [salesAgg.cash, salesAgg.card])
  const cashOut = useMemo(() => round2(purchasePaid + expenseTotal), [purchasePaid, expenseTotal])
  const dbProfit = truth?.profit?.summary
  const dbTill = truth?.expectedVsActual
  const profitAmt = dbProfit?.profit ?? margin
  const profitPct = dbProfit?.marginPct != null
    ? Number(dbProfit.marginPct)
    : (salesAgg.revenue > 0 ? round2((profitAmt / salesAgg.revenue) * 100) : 0)

  const periodLabel = formatPeriodLabel(period, customFrom, customTo)
  const activeTabHint = REPORT_TABS.find(t => t.id === tab)?.hint || ''

  const apiQuery = useMemo(
    () => periodToApiQuery(period, customFrom, customTo, {
      posId: posFilter || undefined,
      cashierId: cashierFilter || undefined,
    }),
    [period, customFrom, customTo, posFilter, cashierFilter],
  )

  const loadTruth = useCallback(async () => {
    if (!USE_API) {
      setTruth(buildLocalFinanceTruth({ shifts, financeMoves, expenses, sales }))
      setTruthLocal(true)
      return
    }
    try {
      const data = await api.getFinanceTruth(apiQuery)
      setTruth(data)
      setTruthLocal(false)
      void cacheFinanceTruth(apiQuery, data)
    } catch {
      const cached = await readCachedFinanceTruth(apiQuery)
      if (cached) {
        setTruth(cached)
        setTruthLocal(true)
        return
      }
      setTruth(buildLocalFinanceTruth({ shifts, financeMoves, expenses, sales }))
      setTruthLocal(true)
    }
  }, [apiQuery, shifts, financeMoves, expenses, sales])

  useEffect(() => {
    if (!apiReady) return
    void loadTruth()
  }, [apiReady, loadTruth])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([syncPosFromApi(), syncClientsFromApi(), loadTruth()])
    } finally {
      setRefreshing(false)
    }
  }, [loadTruth])

  function resetFilters() {
    setPeriod('30d')
    setPosFilter('')
    setCashierFilter('')
    setPayFilter('all')
    setStatusFilter('all')
    setQ('')
  }

  function exportSales() {
    downloadCsv(
      `kakapo-sales-${periodLabel}.csv`,
      ['Чек', 'Дата', 'Точка', 'Кассир', 'Оплата', 'Клиент', 'Сумма', 'Нал', 'Карта', 'Долг', 'Статус'],
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
    const rows = productView === 'top'
      ? productInsights.top
      : productView === 'dead'
        ? productInsights.deadStock
        : productInsights.unsold
    downloadCsv(
      `kakapo-products-${productView}-${periodLabel}.csv`,
      ['Товар', 'Категория', 'Поставщик', 'Остаток', 'Цена', 'Кол-во', 'Выручка', 'Себест', 'Прибыль'],
      rows.map(r => [r.productName, r.cat, r.supplierName, r.stock, r.price, r.qty, r.revenue, r.cogs, r.profit]),
    )
  }

  if (!apiReady) {
    return (
      <div className="k-reports-mod">
        <div className="k-empty">Загрузка…</div>
      </div>
    )
  }

  const filterCount = [
    posFilter,
    cashierFilter,
    payFilter !== 'all' ? payFilter : '',
    statusFilter !== 'all' ? statusFilter : '',
    q.trim(),
  ].filter(Boolean).length

  return (
    <div className="k-reports-mod">
      {truthLocal && (
        <div className="k-rep-sync-bar">Локальные данные · обновятся при связи</div>
      )}

      <div className="k-rep-toolbar">
        <div className="k-subtabs k-rep-periods">
          {REPORT_PERIODS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`k-subtab ${period === p.id ? 'active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          className="k-inp k-rep-search"
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
          <div>1) Период сверху · фильтры через ⚙</div>
          <div>2) Вкладки — разные отчёты</div>
          <div>3) Выручка = чеки · Прибыль = выручка − себестоимость · Сверки = касса факт</div>
          <div>4) CSV — выгрузка в Excel</div>
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

      {apiError && <div className="k-rep-err">{apiError}</div>}

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
            </div>
            <div>
              <span>Прибыль</span>
              <b style={{ color: profitAmt >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(profitAmt)}</b>
            </div>
            <div>
              <span>% прибыли</span>
              <b style={{ color: profitPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{profitPct}%</b>
            </div>
          </div>

          <div className="k-rep-stats">
            <div><span>Нал</span><b>{fmtMoney(salesAgg.cash)}</b></div>
            <div><span>Карта</span><b>{fmtMoney(salesAgg.card)}</b></div>
            <div><span>Долг</span><b style={{ color: 'var(--gold)' }}>{fmtMoney(salesAgg.credit)}</b></div>
            <div><span>Чеков</span><b>{salesAgg.salesCount}</b></div>
            <div><span>Ср. чек</span><b>{fmtMoney(salesAgg.avgCheck)}</b></div>
            <div><span>Возвраты</span><b style={{ color: 'var(--red)' }}>{salesAgg.returnedCount}</b></div>
            <div><span>Пришло</span><b style={{ color: 'var(--green)' }}>{fmtMoney(cashIn)}</b></div>
            <div><span>Ушло</span><b>{fmtMoney(cashOut)}</b></div>
            <div><span>Закупки</span><b>{fmtMoney(purchaseCost)}</b></div>
            <div><span>Расходы</span><b>{fmtMoney(expenseTotal)}</b></div>
            <div><span>Поставщ.</span><b>{fmtMoney(supplierDebt)}</b></div>
            <div><span>Клиенты</span><b style={{ color: 'var(--gold)' }}>{fmtMoney(clientDebtTotal)}</b></div>
          </div>

          <div className="k-rep-note">
            Смен: {openShiftsNow.length} откр. / {periodShifts.length} в периоде
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
        </>
      )}

      {tab === 'sales' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Показано</div><div className="kv">{periodSales.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выручка (фильтр)</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(filteredAgg.revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Нал / Карта</div><div className="kv">{fmtMoney(filteredAgg.cash)} / {fmtMoney(filteredAgg.card)}</div></div>
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
        <div className="k-card" style={{ overflow: 'hidden' }}>
          <div className="k-card-h"><b>Кассиры</b></div>
          {!byCashier.length ? (
            <div className="k-empty">Нет продаж по кассирам</div>
          ) : (
            <div className="k-tbl-scroll">
              <table className="k-tbl">
                <thead>
                  <tr>
                    <th>Кассир</th>
                    <th>Чеков</th>
                    <th>Выручка</th>
                    <th>Нал</th>
                    <th>Карта</th>
                    <th>Долг</th>
                    <th>Возвраты</th>
                  </tr>
                </thead>
                <tbody>
                  {byCashier.map(r => (
                    <tr key={r.key}>
                      <td style={{ fontWeight: 800 }}>{r.name}</td>
                      <td>{r.checks}</td>
                      <td style={{ color: 'var(--green)', fontWeight: 800 }}>{fmtMoney(r.revenue)}</td>
                      <td>{fmtMoney(r.cash)}</td>
                      <td>{fmtMoney(r.card)}</td>
                      <td>{fmtMoney(r.credit)}</td>
                      <td style={{ color: r.returns ? 'var(--red)' : 'var(--muted)' }}>{r.returns}</td>
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
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Смен</div><div className="kv">{periodShifts.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Открыто</div><div className="kv" style={{ color: 'var(--green)' }}>{openShiftsNow.length}</div></div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            {!periodShifts.length ? (
              <div className="k-empty">Нет смен</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Статус</th>
                      <th>Точка</th>
                      <th>Кассир</th>
                      <th>Открыта</th>
                      <th>Закрыта</th>
                      <th>Продаж</th>
                      <th>Нал</th>
                      <th>Карта</th>
                      <th>Долг</th>
                      <th>Старт</th>
                      <th>Ожид.</th>
                      <th>Факт</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodShifts.map(s => {
                      const expected = s.expectedCash != null
                        ? Number(s.expectedCash)
                        : round2((Number(s.openingCash) || 0) + (Number(s.salesCash) || 0) + (Number(s.cashInTotal) || 0) - (Number(s.expenseTotal) || 0))
                      const actual = s.actualCash != null ? Number(s.actualCash) : (s.closingCash != null ? Number(s.closingCash) : null)
                      const diff = s.cashDiff != null
                        ? Number(s.cashDiff)
                        : actual != null ? round2(actual - expected) : null
                      return (
                      <tr key={s.id}>
                        <td style={{ color: s.status === 'open' ? 'var(--green)' : 'var(--muted)', fontWeight: 800 }}>
                          {s.status === 'open' ? 'Открыта' : 'Закрыта'}
                        </td>
                        <td>{posName(posPoints, s.posId || defPos)}</td>
                        <td>{s.cashierName || '—'}</td>
                        <td>{s.openedAtIso ? fmtDateTime(s.openedAtIso) : '—'}</td>
                        <td>{s.closedAtIso ? fmtDateTime(s.closedAtIso) : '—'}</td>
                        <td>{s.salesCount || 0}</td>
                        <td>{fmtMoney(s.salesCash)}</td>
                        <td>{fmtMoney(s.salesCard)}</td>
                        <td>{fmtMoney(s.salesCredit)}</td>
                        <td>{fmtMoney(s.openingCash)}</td>
                        <td>{s.status === 'closed' ? fmtMoney(expected) : '—'}</td>
                        <td>{actual != null ? fmtMoney(actual) : '—'}</td>
                        <td style={{
                          fontWeight: 900,
                          color: diff == null || Math.abs(diff) < 0.009 ? 'var(--muted)' : diff < 0 ? 'var(--red)' : 'var(--green)',
                        }}>
                          {diff == null ? '—' : `${diff > 0 ? '+' : ''}${fmtMoney(diff)}`}
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

      {tab === 'till' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Смен</div><div className="kv">{dbTill?.summary.shifts ?? 0}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">С алертами (≥{dbTill?.threshold ?? 50})</div><div className="kv" style={{ color: 'var(--red)' }}>{dbTill?.summary.withAlert ?? 0}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Недостачи</div><div className="kv" style={{ color: 'var(--red)' }}>{dbTill?.summary.shortCount ?? 0}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Излишки</div><div className="kv" style={{ color: 'var(--green)' }}>{dbTill?.summary.overCount ?? 0}</div></div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h"><b>Ожидаемое vs фактическое (из БД)</b></div>
            {!dbTill?.rows?.length ? (
              <div className="k-empty">Нет закрытых смен за период</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>День</th>
                      <th>Точка</th>
                      <th>Кассир</th>
                      <th>Ожидалось</th>
                      <th>Факт</th>
                      <th>Разница</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbTill.rows.map(r => (
                      <tr key={r.shiftId} style={r.alert ? { background: 'rgba(180,40,40,.12)' } : undefined}>
                        <td style={{ fontWeight: 800 }}>{r.day}</td>
                        <td>{posName(posPoints, r.posId || defPos)}</td>
                        <td>{r.cashierName || '—'}</td>
                        <td>{fmtMoney(r.expectedCash)}</td>
                        <td>{fmtMoney(r.actualCash)}</td>
                        <td style={{
                          fontWeight: 900,
                          color: Math.abs(r.cashDiff) < 0.009 ? 'var(--muted)' : r.cashDiff < 0 ? 'var(--red)' : 'var(--green)',
                        }}>
                          {r.cashDiff > 0 ? '+' : ''}{fmtMoney(r.cashDiff)}{r.alert ? ' ⚠' : ''}
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

      {tab === 'profit' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Выручка</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(dbProfit?.revenue ?? salesAgg.revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Себестоимость FIFO</div><div className="kv">{fmtMoney(dbProfit?.cogs ?? cogs)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Прибыль</div>
              <div className="kv" style={{ color: (dbProfit?.profit ?? salesAgg.revenue - cogs) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(dbProfit?.profit ?? round2(salesAgg.revenue - cogs))}
              </div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Наценка %</div><div className="kv">{dbProfit?.marginPct ?? 0}%</div></div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h"><b>Прибыль по товарам (сервер)</b></div>
            {!(truth?.profit?.products?.length) ? (
              <div className="k-empty">Нет данных прибыли из БД</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Кол-во</th>
                      <th>Выручка</th>
                      <th>Себест.</th>
                      <th>Прибыль</th>
                    </tr>
                  </thead>
                  <tbody>
                    {truth!.profit.products.map(p => (
                      <tr key={p.productId}>
                        <td style={{ fontWeight: 800 }}>{p.productName}</td>
                        <td>{p.qty}</td>
                        <td>{fmtMoney(p.revenue)}</td>
                        <td>{fmtMoney(p.cogs)}</td>
                        <td style={{ fontWeight: 900, color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(p.profit)}</td>
                      </tr>
                    ))}
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
            <div className="k-kpi k-statcard"><div className="kl">Долг клиентов</div><div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(clientDebtTotal)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Должников</div><div className="kv">{clientDebtors.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выдано в долг</div><div className="kv">{fmtMoney(salesAgg.credit)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Чеков в долг</div><div className="kv">{creditSales.length}</div></div>
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
            <div className="k-kpi k-statcard"><div className="kl">Не продавались</div><div className="kv" style={{ color: 'var(--gold)' }}>{productInsights.unsold.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Лежат на складе без продаж</div><div className="kv" style={{ color: 'var(--red)' }}>{productInsights.deadStock.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выручка</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(salesAgg.revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Себестоимость</div><div className="kv">{fmtMoney(dbProfit?.cogs ?? cogs)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Прибыль</div>
              <div className="kv" style={{ color: (dbProfit?.profit ?? salesAgg.revenue - cogs) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(dbProfit?.profit ?? round2(salesAgg.revenue - cogs))}
              </div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Категорий</div><div className="kv">{productInsights.categories.length}</div></div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {([
              { id: 'top', label: 'Хорошо продаются' },
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

          {productView === 'unsold' && (
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h">
                <b>Не продавались · {productInsights.unsold.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!productInsights.unsold.length ? <div className="k-empty">Все товары продавались</div> : (
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
                      {productInsights.unsold.slice(0, 150).map((r, i) => (
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
                <b>Залежались (есть остаток, продаж нет) · {productInsights.deadStock.length}</b>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
              </div>
              {!productInsights.deadStock.length ? <div className="k-empty">Нет залежавшихся товаров</div> : (
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
                      {productInsights.deadStock.map((r, i) => (
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
