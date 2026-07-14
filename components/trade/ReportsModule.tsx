'use client'

import { useCallback, useMemo, useState } from 'react'
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
  const suppliers = usePosStore(s => s.suppliers)
  const expiry = usePosStore(s => s.expiry)
  const posPoints = usePosStore(s => s.posPoints)
  const cashiers = usePosStore(s => s.cashiers)
  const apiReady = usePosStore(s => s.apiReady)
  const apiError = usePosStore(s => s.apiError)
  const clients = useClientStore(s => s.clients)
  const products = useProducts(s => s.products)

  const [period, setPeriod] = useState<ReportPeriod>('30d')
  const [customFrom, setCustomFrom] = useState(ymdLocal(new Date(Date.now() - 6 * 864e5)))
  const [customTo, setCustomTo] = useState(ymdLocal())
  const [posFilter, setPosFilter] = useState('')
  const [cashierFilter, setCashierFilter] = useState('')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [statusFilter, setStatusFilter] = useState<SaleStatusFilter>('all')
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<ReportTab>('overview')
  const [showHelp, setShowHelp] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

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

  const periodLabel = formatPeriodLabel(period, customFrom, customTo)
  const activeTabHint = REPORT_TABS.find(t => t.id === tab)?.hint || ''

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([syncPosFromApi(), syncClientsFromApi()])
    } finally {
      setRefreshing(false)
    }
  }, [])

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
    downloadCsv(
      `kakapo-products-${periodLabel}.csv`,
      ['Товар', 'Кол-во', 'Выручка', 'Себест', 'Маржа'],
      productRows.map(r => [r.productName, r.qty, r.revenue, r.cogs, round2(r.revenue - r.cogs)]),
    )
  }

  if (!apiReady) {
    return (
      <div>
        <div className="k-page-h">
          <div>
            <h1>📊 Отчёты</h1>
            <div className="sub">Полная отчётность по кассе, складу, поставщикам и клиентам</div>
          </div>
        </div>
        <div className="k-card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
          Загрузка данных…
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>📊 Отчёты</h1>
          <div className="sub">Полная отчётность по кассе, складу, поставщикам и клиентам</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="k-btn k-btn-s" onClick={() => setShowHelp(v => !v)}>
            {showHelp ? 'Скрыть справку' : 'Что здесь?'}
          </button>
          <button type="button" className="k-btn k-btn-s" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? '↻ …' : '↻ Обновить'}
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="k-card" style={{ padding: 16, marginBottom: 14, lineHeight: 1.5, fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>
          <b style={{ color: 'var(--text)', display: 'block', marginBottom: 8 }}>Как пользоваться</b>
          <div>1) Сверху выберите <b style={{ color: 'var(--text)' }}>период</b>, <b style={{ color: 'var(--text)' }}>кассу</b>, <b style={{ color: 'var(--text)' }}>кассира</b> и оплату.</div>
          <div>2) Вкладки ниже — разные отчёты по действиям программы (продажи, возвраты, склад…).</div>
          <div>3) <b style={{ color: 'var(--text)' }}>Выручка</b> — сумма проданных чеков (без полных возвратов). <b style={{ color: 'var(--text)' }}>Маржа ≈</b> выручка − себестоимость товаров − расходы.</div>
          <div>4) Кнопка <b style={{ color: 'var(--text)' }}>CSV</b> сохраняет таблицу в Excel/таблицу.</div>
        </div>
      )}

      {apiError && (
        <div className="k-alert" style={{ marginBottom: 14, background: '#2a1420', color: '#FF8A8A', border: '1px solid #5a2030' }}>
          {apiError}
        </div>
      )}

      {/* Фильтры */}
      <div className="k-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>Фильтры · {periodLabel}</b>
          <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={resetFilters}>Сбросить</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {REPORT_PERIODS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`k-subtab ${period === p.id ? 'active' : ''}`}
              style={{ padding: '7px 12px', fontSize: 12 }}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12, maxWidth: 420 }}>
            <div className="k-field" style={{ marginBottom: 0 }}>
              <label>С даты</label>
              <input className="k-inp" type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            </div>
            <div className="k-field" style={{ marginBottom: 0 }}>
              <label>По дату</label>
              <input className="k-inp" type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>Точка продаж</label>
            <select className="k-sel" value={posFilter} onChange={e => setPosFilter(e.target.value)}>
              <option value="">Все точки</option>
              {posPoints.filter(p => p.active !== false).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>Кассир</label>
            <select className="k-sel" value={cashierFilter} onChange={e => setCashierFilter(e.target.value)}>
              <option value="">Все кассиры</option>
              {cashiers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>Оплата</label>
            <select className="k-sel" value={payFilter} onChange={e => setPayFilter(e.target.value as PayFilter)}>
              {PAY_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>Статус чека</label>
            <select className="k-sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value as SaleStatusFilter)}>
              {SALE_STATUS_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="k-field" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
            <label>Поиск (чек, клиент, товар)</label>
            <input className="k-inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Например: K-120 или имя клиента…" />
          </div>
        </div>
        {(payFilter !== 'all' || statusFilter !== 'all' || q.trim()) && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
            В таблицах продаж применены доп. фильтры · показано чеков: <b style={{ color: 'var(--text)' }}>{periodSales.length}</b>
            {' '}из <b style={{ color: 'var(--text)' }}>{periodSalesAll.length}</b>
          </div>
        )}
      </div>

      <div className="k-subtabs" style={{ marginBottom: 8 }}>
        {REPORT_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`k-subtab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            title={t.hint}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginBottom: 14 }}>{activeTabHint}</div>

      {tab === 'overview' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard">
              <div className="kl">Выручка</div>
              <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(salesAgg.revenue)}</div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Наличные</div><div className="kv">{fmtMoney(salesAgg.cash)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Карта</div><div className="kv">{fmtMoney(salesAgg.card)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">В долг</div><div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(salesAgg.credit)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Чеков</div><div className="kv">{salesAgg.salesCount}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Средний чек</div><div className="kv">{fmtMoney(salesAgg.avgCheck)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Возвраты</div><div className="kv" style={{ color: 'var(--red)' }}>{salesAgg.returnedCount}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Пришло денег</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(cashIn)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Ушло (закупки+расходы)</div><div className="kv">{fmtMoney(cashOut)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Закупки</div><div className="kv">{fmtMoney(purchaseCost)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Расходы</div><div className="kv">{fmtMoney(expenseTotal)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Маржа ≈</div>
              <div className="kv" style={{ color: margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(margin)}</div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Долг поставщикам</div><div className="kv">{fmtMoney(supplierDebt)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Долг клиентов</div><div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(clientDebtTotal)}</div></div>
          </div>

          <div className="k-card" style={{ padding: 16, marginBottom: 14, fontSize: 13, color: 'var(--muted)', fontWeight: 700, lineHeight: 1.55 }}>
            <div>Открытых смен: <b style={{ color: 'var(--text)' }}>{openShiftsNow.length}</b> · смен в периоде: <b style={{ color: 'var(--text)' }}>{periodShifts.length}</b></div>
            <div>Списания: <b style={{ color: 'var(--text)' }}>{periodWriteoffs.length}</b> ({fmtMoney(writeoffCost)}) · ревизии: <b style={{ color: 'var(--text)' }}>{revStats.count}</b></div>
            <div style={{ marginTop: 6, opacity: .9 }}>Маржа приблизительная: выручка − себестоимость (цена закупки товара) − расходы кассы. Списания склада в маржу не входят.</div>
          </div>

          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div className="k-card-h"><b>По дням</b></div>
            {!byDay.length ? (
              <div className="k-empty">Нет продаж за период</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>День</th>
                      <th>Чеков</th>
                      <th>Выручка</th>
                      <th>Нал</th>
                      <th>Карта</th>
                      <th>Долг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDay.slice(0, 60).map(d => (
                      <tr key={d.day}>
                        <td style={{ fontWeight: 800 }}>{d.day}</td>
                        <td>{d.checks}</td>
                        <td>{fmtMoney(d.revenue)}</td>
                        <td>{fmtMoney(d.cash)}</td>
                        <td>{fmtMoney(d.card)}</td>
                        <td>{fmtMoney(d.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h">
              <b>Топ товаров</b>
              <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
            </div>
            {!productRows.length ? (
              <div className="k-empty">Нет продаж</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Товар</th>
                      <th>Кол-во</th>
                      <th>Выручка</th>
                      <th>Себест.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.slice(0, 12).map((r, i) => (
                      <tr key={r.productId}>
                        <td>{i + 1}</td>
                        <td>{r.productName}</td>
                        <td>{r.qty}</td>
                        <td>{fmtMoney(r.revenue)}</td>
                        <td>{fmtMoney(r.cogs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                      <th>Старт / Факт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodShifts.map(s => (
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
                        <td>{fmtMoney(s.openingCash)} / {s.closingCash != null ? fmtMoney(s.closingCash) : '—'}</td>
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
            <div className="k-kpi k-statcard"><div className="kl">Позиций</div><div className="kv">{productRows.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выручка</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(salesAgg.revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Себестоимость</div><div className="kv">{fmtMoney(cogs)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Маржа товаров ≈</div>
              <div className="kv" style={{ color: salesAgg.revenue - cogs >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(salesAgg.revenue - cogs)}
              </div>
            </div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h">
              <b>Товары</b>
              <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 12px' }} onClick={exportProducts}>CSV</button>
            </div>
            {!productRows.length ? <div className="k-empty">Нет продаж</div> : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Товар</th>
                      <th>Кол-во</th>
                      <th>Выручка</th>
                      <th>Себест.</th>
                      <th>Маржа ≈</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map((r, i) => (
                      <tr key={r.productId}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 800 }}>{r.productName}</td>
                        <td>{r.qty}</td>
                        <td>{fmtMoney(r.revenue)}</td>
                        <td>{fmtMoney(r.cogs)}</td>
                        <td style={{ color: r.revenue - r.cogs >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 800 }}>
                          {fmtMoney(r.revenue - r.cogs)}
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
    </div>
  )
}
