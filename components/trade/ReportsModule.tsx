'use client'

import { useCallback, useMemo, useState } from 'react'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { useProducts } from '@/lib/store'
import { fmtDateTime, fmtMoney } from './warehouse/warehouseShared'
import {
  REPORT_PERIODS,
  REPORT_TABS,
  aggregateSales,
  defaultPosId,
  filterByCreatedAt,
  filterSales,
  filterShifts,
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
  type ReportPeriod,
  type ReportTab,
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
  const apiReady = usePosStore(s => s.apiReady)
  const apiError = usePosStore(s => s.apiError)
  const clients = useClientStore(s => s.clients)
  const products = useProducts(s => s.products)

  const [period, setPeriod] = useState<ReportPeriod>('30d')
  const [posFilter, setPosFilter] = useState<string>('')
  const [tab, setTab] = useState<ReportTab>('overview')
  const [refreshing, setRefreshing] = useState(false)

  const { from, to } = useMemo(() => periodRange(period), [period])
  const defPos = useMemo(() => defaultPosId(posPoints), [posPoints])
  const filterPosId = posFilter || null

  const periodSales = useMemo(
    () => filterSales(sales, from, to, filterPosId, defPos),
    [sales, from, to, filterPosId, defPos],
  )
  const periodShifts = useMemo(
    () => filterShifts(shifts, from, to, filterPosId, defPos),
    [shifts, from, to, filterPosId, defPos],
  )
  const periodReceipts = useMemo(() => filterByCreatedAt(receipts, from, to), [receipts, from, to])
  const periodWriteoffs = useMemo(() => filterByCreatedAt(writeoffs, from, to), [writeoffs, from, to])
  const periodRevisions = useMemo(() => filterByCreatedAt(revisions, from, to), [revisions, from, to])
  const periodExpenses = useMemo(() => filterByCreatedAt(expenses, from, to), [expenses, from, to])

  const salesAgg = useMemo(() => aggregateSales(periodSales), [periodSales])
  const productsById = useMemo(() => {
    const m = new Map(products.map(p => [Number(p.id), p]))
    return m
  }, [products])
  const productRows = useMemo(() => topProducts(periodSales, productsById, 50), [periodSales, productsById])
  const cogs = useMemo(() => sumCogs(productRows), [productRows])
  const purchaseCost = useMemo(() => sumReceiptCost(periodReceipts), [periodReceipts])
  const purchasePaid = useMemo(() => sumReceiptPaid(periodReceipts), [periodReceipts])
  const writeoffCost = useMemo(() => sumWriteoffCost(periodWriteoffs), [periodWriteoffs])
  const expenseTotal = useMemo(() => sumExpenses(periodExpenses), [periodExpenses])
  const revStats = useMemo(() => revisionDiffCount(periodRevisions), [periodRevisions])

  const supplierDebt = useMemo(
    () => round2(suppliers.reduce((s, x) => s + (Number(x.payableAmount) || 0), 0)),
    [suppliers],
  )
  const clientDebtors = useMemo(() => {
    return [...clients]
      .filter(c => (Number(c.debt) || 0) > 0.001)
      .sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0))
  }, [clients])
  const clientDebtTotal = useMemo(
    () => round2(clientDebtors.reduce((s, c) => s + (Number(c.debt) || 0), 0)),
    [clientDebtors],
  )
  const creditSales = useMemo(
    () => periodSales.filter(s => !isSaleFullyReturned(s) && (Number(s.debtAdded) || 0) > 0.001),
    [periodSales],
  )

  const margin = useMemo(
    () => round2(salesAgg.revenue - cogs - expenseTotal),
    [salesAgg.revenue, cogs, expenseTotal],
  )

  const openShiftsNow = useMemo(
    () => periodShifts.filter(s => s.status === 'open'),
    [periodShifts],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([syncPosFromApi(), syncClientsFromApi()])
    } finally {
      setRefreshing(false)
    }
  }, [])

  if (!apiReady) {
    return (
      <div>
        <div className="k-page-h">
          <div>
            <h1>📊 Отчёты</h1>
            <div className="sub">Сводка по продажам, складу и деньгам</div>
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
          <div className="sub">Продажи, смены, склад, поставщики и долги</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="k-sel"
            value={period}
            onChange={e => setPeriod(e.target.value as ReportPeriod)}
            style={{ minWidth: 130 }}
          >
            {REPORT_PERIODS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select
            className="k-sel"
            value={posFilter}
            onChange={e => setPosFilter(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">Все точки</option>
            {posPoints.filter(p => p.active !== false).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button type="button" className="k-btn k-btn-s" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? '↻ …' : '↻ Обновить'}
          </button>
        </div>
      </div>

      {apiError && (
        <div className="k-alert" style={{ marginBottom: 14, background: '#2a1420', color: '#FF8A8A', border: '1px solid #5a2030' }}>
          {apiError}
        </div>
      )}

      <div className="k-subtabs" style={{ marginBottom: 16 }}>
        {REPORT_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`k-subtab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard">
              <div className="kl">Выручка</div>
              <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(salesAgg.revenue)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Наличные</div>
              <div className="kv">{fmtMoney(salesAgg.cash)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Карта</div>
              <div className="kv">{fmtMoney(salesAgg.card)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">В долг</div>
              <div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(salesAgg.credit)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Чеков</div>
              <div className="kv">{salesAgg.salesCount}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Возвраты</div>
              <div className="kv" style={{ color: 'var(--red)' }}>{salesAgg.returnedCount}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Закупки</div>
              <div className="kv">{fmtMoney(purchaseCost)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Расходы</div>
              <div className="kv">{fmtMoney(expenseTotal)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Себест. продаж</div>
              <div className="kv">{fmtMoney(cogs)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Маржа ≈</div>
              <div className="kv" style={{ color: margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(margin)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Долг поставщикам</div>
              <div className="kv">{fmtMoney(supplierDebt)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Долг клиентов</div>
              <div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(clientDebtTotal)}</div>
            </div>
          </div>

          <div className="k-card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Кратко за период</div>
            <div style={{ display: 'grid', gap: 8, fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>
              <div>Открытых смен: <b style={{ color: 'var(--text)' }}>{openShiftsNow.length}</b> · всего смен в отчёте: <b style={{ color: 'var(--text)' }}>{periodShifts.length}</b></div>
              <div>Приходы на склад: <b style={{ color: 'var(--text)' }}>{periodReceipts.length}</b> · оплачено при приходе: <b style={{ color: 'var(--text)' }}>{fmtMoney(purchasePaid)}</b></div>
              <div>Списания: <b style={{ color: 'var(--text)' }}>{periodWriteoffs.length}</b> ({fmtMoney(writeoffCost)}) · ревизии: <b style={{ color: 'var(--text)' }}>{revStats.count}</b></div>
              <div style={{ fontSize: 12, opacity: .85 }}>Маржа ≈ выручка − себестоимость проданных (costPrice) − расходы. Не учитывает налоги и списания склада.</div>
            </div>
          </div>

          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', fontWeight: 900, borderBottom: '1px solid var(--border)' }}>
              Топ товаров
            </div>
            {!productRows.length ? (
              <div className="k-empty" style={{ padding: 24 }}>Нет продаж за выбранный период</div>
            ) : (
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
                  {productRows.slice(0, 10).map((r, i) => (
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
            )}
          </div>
        </>
      )}

      {tab === 'sales' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Чеков</div><div className="kv">{periodSales.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выручка</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(salesAgg.revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Нал / Карта</div><div className="kv">{fmtMoney(salesAgg.cash)} / {fmtMoney(salesAgg.card)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Долг / Возвраты</div><div className="kv">{fmtMoney(salesAgg.credit)} / {salesAgg.returnedCount}</div></div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            {!periodSales.length ? (
              <div className="k-empty" style={{ padding: 28 }}>Нет чеков за период</div>
            ) : (
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
                  {periodSales.slice(0, 200).map(s => {
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
            )}
          </div>
        </>
      )}

      {tab === 'shifts' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Смен</div><div className="kv">{periodShifts.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Открыто сейчас</div><div className="kv" style={{ color: 'var(--green)' }}>{openShiftsNow.length}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Продаж в сменах</div>
              <div className="kv">{periodShifts.reduce((n, s) => n + (Number(s.salesCount) || 0), 0)}</div>
            </div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            {!periodShifts.length ? (
              <div className="k-empty" style={{ padding: 28 }}>Нет смен за период</div>
            ) : (
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
            <div className="k-kpi k-statcard"><div className="kl">Сроки (риск)</div><div className="kv">{expiry.length}</div></div>
          </div>

          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '12px 14px', fontWeight: 900, borderBottom: '1px solid var(--border)' }}>Приходы</div>
            {!periodReceipts.length ? (
              <div className="k-empty" style={{ padding: 20 }}>Нет приходов</div>
            ) : (
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
                  {periodReceipts.slice(0, 80).map(r => (
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
            )}
          </div>

          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '12px 14px', fontWeight: 900, borderBottom: '1px solid var(--border)' }}>Списания</div>
            {!periodWriteoffs.length ? (
              <div className="k-empty" style={{ padding: 20 }}>Нет списаний</div>
            ) : (
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
                  {periodWriteoffs.slice(0, 80).map(w => (
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
            )}
          </div>

          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', fontWeight: 900, borderBottom: '1px solid var(--border)' }}>
              Сроки годности
            </div>
            {!expiry.length ? (
              <div className="k-empty" style={{ padding: 20 }}>Нет позиций с риском по сроку</div>
            ) : (
              <table className="k-tbl">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Кол-во</th>
                    <th>Срок</th>
                    <th>Осталось дней</th>
                  </tr>
                </thead>
                <tbody>
                  {expiry.slice(0, 60).map((e, i) => (
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
            )}
          </div>
        </>
      )}

      {tab === 'suppliers' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Долг поставщикам</div><div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(supplierDebt)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Закупки за период</div><div className="kv">{fmtMoney(purchaseCost)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Оплачено при приходе</div><div className="kv">{fmtMoney(purchasePaid)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Расходы</div><div className="kv">{fmtMoney(expenseTotal)}</div></div>
          </div>

          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '12px 14px', fontWeight: 900, borderBottom: '1px solid var(--border)' }}>Поставщики</div>
            {!suppliers.length ? (
              <div className="k-empty" style={{ padding: 20 }}>Нет поставщиков</div>
            ) : (
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
                        <td style={{ color: (Number(s.payableAmount) || 0) > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                          {fmtMoney(s.payableAmount)}
                        </td>
                        <td>{fmtMoney(s.totalSupplied)}</td>
                        <td>{fmtMoney(s.totalPaid)}</td>
                        <td>{s.lastDeliveryAtIso ? fmtDateTime(s.lastDeliveryAtIso) : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', fontWeight: 900, borderBottom: '1px solid var(--border)' }}>
              Расходы за период
            </div>
            {!periodExpenses.length ? (
              <div className="k-empty" style={{ padding: 20 }}>Нет расходов</div>
            ) : (
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
            )}
          </div>
        </>
      )}

      {tab === 'debts' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Долг клиентов</div><div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(clientDebtTotal)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Должников</div><div className="kv">{clientDebtors.length}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выдано в долг (период)</div><div className="kv">{fmtMoney(salesAgg.credit)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Чеков в долг</div><div className="kv">{creditSales.length}</div></div>
          </div>

          <div className="k-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '12px 14px', fontWeight: 900, borderBottom: '1px solid var(--border)' }}>
              Топ должников
            </div>
            {!clientDebtors.length ? (
              <div className="k-empty" style={{ padding: 20 }}>Нет клиентов с долгом</div>
            ) : (
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
                  {clientDebtors.slice(0, 40).map((c, i) => (
                    <tr key={c.id}>
                      <td>{i + 1}</td>
                      <td style={{ fontWeight: 800 }}>{c.name}</td>
                      <td>{c.phone || '—'}</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 900 }}>{fmtMoney(c.debt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', fontWeight: 900, borderBottom: '1px solid var(--border)' }}>
              Продажи в долг за период
            </div>
            {!creditSales.length ? (
              <div className="k-empty" style={{ padding: 20 }}>Нет выдач в долг за период</div>
            ) : (
              <table className="k-tbl">
                <thead>
                  <tr>
                    <th>Чек</th>
                    <th>Дата</th>
                    <th>Клиент</th>
                    <th>Точка</th>
                    <th>В долг</th>
                    <th>Итого чек</th>
                  </tr>
                </thead>
                <tbody>
                  {creditSales.slice(0, 100).map(s => (
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
            )}
          </div>
        </>
      )}

      {tab === 'products' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Позиций в топе</div><div className="kv">{productRows.length}</div></div>
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
            {!productRows.length ? (
              <div className="k-empty" style={{ padding: 28 }}>Нет проданных товаров за период</div>
            ) : (
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
            )}
          </div>
        </>
      )}
    </div>
  )
}
