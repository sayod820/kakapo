'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { FinanceTruthBundle, MoneyLedgerEntry } from '@/lib/types'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { fmtDateTime, fmtMoney } from './warehouse/warehouseShared'
import {
  REPORT_PERIODS,
  filterByCreatedAt,
  inPeriod,
  isSaleFullyReturned,
  ledgerTypeLabel,
  periodRange,
  periodToApiQuery,
  round2,
  type ReportPeriod,
  ymdLocal,
} from './reportsHelpers'

const EXPENSE_CATS = ['Аренда', 'Зарплата', 'Коммунальные', 'Транспорт', 'Реклама', 'Хозтовары', 'Прочее']

type FinanceTab =
  | 'alerts'
  | 'till'
  | 'cashbook'
  | 'journal'
  | 'profit'
  | 'expenses'
  | 'deposits'
  | 'debts'

const FINANCE_TABS: { id: FinanceTab; label: string; icon: string }[] = [
  { id: 'alerts', label: 'Сигналы', icon: '⚠️' },
  { id: 'till', label: 'Ожид. vs факт', icon: '⚖️' },
  { id: 'cashbook', label: 'Кассовая книга', icon: '📒' },
  { id: 'journal', label: 'Журнал', icon: '📋' },
  { id: 'profit', label: 'Прибыль', icon: '💎' },
  { id: 'expenses', label: 'Расходы', icon: '🧾' },
  { id: 'deposits', label: 'Вклады', icon: '🏦' },
  { id: 'debts', label: 'Долги', icon: '💳' },
]

export default function FinanceModule() {
  const sales = usePosStore(s => s.sales)
  const shifts = usePosStore(s => s.shifts)
  const expenses = usePosStore(s => s.expenses)
  const financeMoves = usePosStore(s => s.financeMoves)
  const suppliers = usePosStore(s => s.suppliers)
  const cashiers = usePosStore(s => s.cashiers)
  const posPoints = usePosStore(s => s.posPoints)
  const apiReady = usePosStore(s => s.apiReady)
  const apiError = usePosStore(s => s.apiError)
  const clients = useClientStore(s => s.clients)

  const [period, setPeriod] = useState<ReportPeriod>('30d')
  const [customFrom, setCustomFrom] = useState(ymdLocal(new Date(Date.now() - 6 * 864e5)))
  const [customTo, setCustomTo] = useState(ymdLocal())
  const [posFilter, setPosFilter] = useState('')
  const [cashierFilter, setCashierFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [tab, setTab] = useState<FinanceTab>('alerts')
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [truth, setTruth] = useState<FinanceTruthBundle | null>(null)
  const [truthError, setTruthError] = useState('')

  const [expOpen, setExpOpen] = useState(false)
  const [expCat, setExpCat] = useState('Прочее')
  const [expAmount, setExpAmount] = useState('')
  const [expNote, setExpNote] = useState('')

  const [depOpen, setDepOpen] = useState(false)
  const [depType, setDepType] = useState<'deposit' | 'withdraw'>('deposit')
  const [depAmount, setDepAmount] = useState('')
  const [depNote, setDepNote] = useState('')

  const { from, to } = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )

  const apiQuery = useMemo(
    () => periodToApiQuery(period, customFrom, customTo, {
      posId: posFilter || undefined,
      cashierId: cashierFilter || undefined,
      type: typeFilter || undefined,
    }),
    [period, customFrom, customTo, posFilter, cashierFilter, typeFilter],
  )

  const periodExpenses = useMemo(() => filterByCreatedAt(expenses, from, to), [expenses, from, to])
  const periodMoves = useMemo(
    () => financeMoves.filter(m => inPeriod(m.createdAtIso, from, to)),
    [financeMoves, from, to],
  )
  const periodSales = useMemo(
    () => sales.filter(s => inPeriod(s.createdAtIso, from, to) && !isSaleFullyReturned(s)),
    [sales, from, to],
  )
  const creditOut = useMemo(
    () => round2(periodSales.reduce((s, x) => s + (Number(x.debtAdded) || 0), 0)),
    [periodSales],
  )
  const expenseTotal = useMemo(
    () => round2(periodExpenses.reduce((s, x) => s + (Number(x.amount) || 0), 0)),
    [periodExpenses],
  )
  const deposits = useMemo(
    () => round2(periodMoves.filter(m => m.type === 'deposit').reduce((s, m) => s + (Number(m.amount) || 0), 0)),
    [periodMoves],
  )
  const withdraws = useMemo(
    () => round2(periodMoves.filter(m => m.type === 'withdraw').reduce((s, m) => s + (Number(m.amount) || 0), 0)),
    [periodMoves],
  )
  const depositsAll = useMemo(
    () => round2(financeMoves.filter(m => m.type === 'deposit').reduce((s, m) => s + (Number(m.amount) || 0), 0)),
    [financeMoves],
  )
  const withdrawsAll = useMemo(
    () => round2(financeMoves.filter(m => m.type === 'withdraw').reduce((s, m) => s + (Number(m.amount) || 0), 0)),
    [financeMoves],
  )
  const capitalNet = useMemo(() => round2(depositsAll - withdrawsAll), [depositsAll, withdrawsAll])

  const cashInTills = useMemo(() => {
    return round2(
      shifts
        .filter(s => s.status === 'open')
        .reduce((sum, s) => {
          const expected = (Number(s.openingCash) || 0) + (Number(s.salesCash) || 0) - (Number(s.expenseTotal) || 0)
          return sum + expected
        }, 0),
    )
  }, [shifts])
  const openTillCount = useMemo(() => shifts.filter(s => s.status === 'open').length, [shifts])

  const supplierDebt = useMemo(
    () => round2(suppliers.reduce((s, x) => s + (Number(x.payableAmount) || 0), 0)),
    [suppliers],
  )
  const clientDebtors = useMemo(
    () => [...clients].filter(c => (Number(c.debt) || 0) > 0.001).sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0)),
    [clients],
  )
  const clientDebt = useMemo(
    () => round2(clientDebtors.reduce((s, c) => s + (Number(c.debt) || 0), 0)),
    [clientDebtors],
  )

  const loadTruth = useCallback(async () => {
    if (!USE_API) return
    setTruthError('')
    try {
      const data = await api.getFinanceTruth(apiQuery)
      setTruth(data)
    } catch (e) {
      setTruthError(e instanceof Error ? e.message : 'Не удалось загрузить финансы из БД')
    }
  }, [apiQuery])

  useEffect(() => {
    if (!apiReady || !USE_API) return
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

  async function submitExpense() {
    setBusy(true)
    setMsg('')
    try {
      const amount = Number(expAmount)
      if (!(amount > 0)) throw new Error('Укажите сумму расхода')
      if (!USE_API) throw new Error('Нужен API')
      await api.createExpense({
        category: expCat.trim() || 'Прочее',
        amount,
        note: expNote.trim() || undefined,
      })
      await refresh()
      setExpOpen(false)
      setExpAmount('')
      setExpNote('')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  async function submitDeposit() {
    setBusy(true)
    setMsg('')
    try {
      const amount = Number(depAmount)
      if (!(amount > 0)) throw new Error('Укажите сумму')
      if (!USE_API) throw new Error('Нужен API')
      await api.createFinanceMove({
        type: depType,
        amount,
        note: depNote.trim() || undefined,
      })
      await refresh()
      setDepOpen(false)
      setDepAmount('')
      setDepNote('')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  async function removeMove(id: string) {
    if (!confirm('Удалить запись?')) return
    try {
      await api.deleteFinanceMove(id)
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  function posLabel(posId?: string) {
    if (!posId) return '—'
    return posPoints.find(p => p.id === posId)?.name || posId
  }

  function diffColor(diff: number) {
    if (Math.abs(diff) < 0.009) return 'var(--muted)'
    return diff < 0 ? 'var(--red)' : 'var(--green)'
  }

  if (!apiReady) {
    return (
      <div>
        <div className="k-page-h">
          <div>
            <h1>💰 Финансы</h1>
            <div className="sub">Одно место правды — цифры из базы</div>
          </div>
        </div>
        <div className="k-card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>
      </div>
    )
  }

  const alerts = truth?.alerts
  const vs = truth?.expectedVsActual
  const cashBook = truth?.cashBook
  const profit = truth?.profit
  const journal: MoneyLedgerEntry[] = truth?.journal || []

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>💰 Финансы</h1>
          <div className="sub">Все суммы считаются на сервере из БД · касса, журнал, прибыль</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="k-btn k-btn-g" onClick={() => { setMsg(''); setDepType('deposit'); setDepOpen(true) }}>
            + Вклад
          </button>
          <button type="button" className="k-btn k-btn-s" onClick={() => { setMsg(''); setExpOpen(true) }}>
            + Расход
          </button>
          <button type="button" className="k-btn k-btn-s" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? '↻ …' : '↻ Обновить'}
          </button>
        </div>
      </div>

      {(apiError || truthError) && (
        <div className="k-alert" style={{ marginBottom: 14, background: '#2a1420', color: '#FF8A8A', border: '1px solid #5a2030' }}>
          {truthError || apiError}
        </div>
      )}

      <div className="k-kpis" style={{ marginBottom: 14 }}>
        <div className="k-kpi k-statcard">
          <div className="kl">В кассах сейчас</div>
          <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(cashInTills)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontWeight: 700 }}>
            {openTillCount ? `${openTillCount} открытых смен` : 'Нет открытых смен'}
          </div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Книга · баланс нал</div>
          <div className="kv">{fmtMoney(cashBook?.balance ?? 0)}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Прибыль (БД)</div>
          <div className="kv" style={{ color: (profit?.summary.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmtMoney(profit?.summary.profit ?? 0)}
          </div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Сигналы ≥ {alerts?.threshold ?? 50} сом</div>
          <div className="kv" style={{ color: (alerts?.count ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>
            {alerts?.count ?? 0}
          </div>
        </div>
      </div>

      <div className="k-card" style={{ padding: 14, marginBottom: 14 }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 420, marginBottom: 12 }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>Точка</label>
            <select className="k-sel" value={posFilter} onChange={e => setPosFilter(e.target.value)}>
              <option value="">Все</option>
              {posPoints.filter(p => p.active !== false).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>Кассир (журнал)</label>
            <select className="k-sel" value={cashierFilter} onChange={e => setCashierFilter(e.target.value)}>
              <option value="">Все</option>
              {cashiers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>Тип операции</label>
            <select className="k-sel" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">Все типы</option>
              {Object.entries({
                sale_cash: 'Продажа · нал',
                sale_card: 'Продажа · карта',
                sale_credit: 'Продажа · долг',
                expense: 'Расход',
                deposit: 'Вклад',
                withdraw: 'Снятие',
                shift_close: 'Сверка кассы',
                purchase_pay: 'Оплата закупа',
                sale_return_cash: 'Возврат · нал',
                sale_return_card: 'Возврат · карта',
              }).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="k-subtabs">
        {FINANCE_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`k-subtab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
            {t.id === 'alerts' && (alerts?.count ?? 0) > 0 ? ` (${alerts?.count})` : ''}
          </button>
        ))}
      </div>

      {tab === 'alerts' && (
        <div className="k-card" style={{ overflow: 'hidden' }}>
          <div className="k-card-h">
            <b>Автоматические предупреждения</b>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
              порог {alerts?.threshold ?? 50} сом
            </span>
          </div>
          {!alerts?.alerts?.length ? (
            <div className="k-empty">Нет расхождений и долгих смен — всё в норме</div>
          ) : (
            <div className="k-tbl-scroll">
              <table className="k-tbl">
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Сигнал</th>
                    <th>Детали</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.alerts.map(a => (
                    <tr key={a.id}>
                      <td>{a.atIso ? fmtDateTime(a.atIso) : '—'}</td>
                      <td style={{ fontWeight: 900, color: a.severity === 'high' ? 'var(--red)' : 'var(--gold)' }}>
                        {a.title}
                      </td>
                      <td>{a.message}</td>
                      <td style={{ fontWeight: 900, color: diffColor(a.amount) }}>{fmtMoney(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'till' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Закрытых смен</div><div className="kv">{vs?.summary.shifts ?? 0}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">С алертами</div><div className="kv" style={{ color: 'var(--red)' }}>{vs?.summary.withAlert ?? 0}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Недостачи</div><div className="kv" style={{ color: 'var(--red)' }}>{vs?.summary.shortCount ?? 0}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Излишки</div><div className="kv" style={{ color: 'var(--green)' }}>{vs?.summary.overCount ?? 0}</div></div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h">
              <b>Ожидаемое vs фактическое</b>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>главный отчёт против недостач</span>
            </div>
            {!vs?.rows?.length ? (
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
                    {vs.rows.map(r => (
                      <tr key={r.shiftId} style={r.alert ? { background: 'rgba(180,40,40,.12)' } : undefined}>
                        <td style={{ fontWeight: 800 }}>{r.day || '—'}</td>
                        <td>{posLabel(r.posId)}</td>
                        <td>{r.cashierName || '—'}</td>
                        <td>{fmtMoney(r.expectedCash)}</td>
                        <td>{fmtMoney(r.actualCash)}</td>
                        <td style={{ fontWeight: 900, color: diffColor(r.cashDiff) }}>
                          {r.cashDiff > 0 ? '+' : ''}{fmtMoney(r.cashDiff)}
                          {r.alert ? ' ⚠' : ''}
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

      {tab === 'cashbook' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Приход нал</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(cashBook?.summary.inflow ?? 0)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Расход нал</div><div className="kv" style={{ color: 'var(--red)' }}>{fmtMoney(cashBook?.summary.outflow ?? 0)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Баланс</div><div className="kv">{fmtMoney(cashBook?.balance ?? 0)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Записей</div><div className="kv">{cashBook?.summary.count ?? 0}</div></div>
          </div>
          <div className="k-grid2" style={{ marginBottom: 14 }}>
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h"><b>По дням</b></div>
              {!cashBook?.days?.length ? <div className="k-empty">Нет движений</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>День</th>
                        <th>Приход</th>
                        <th>Расход</th>
                        <th>Нетто</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashBook.days.slice(0, 60).map(d => (
                        <tr key={d.day}>
                          <td style={{ fontWeight: 800 }}>{d.day}</td>
                          <td style={{ color: 'var(--green)' }}>{fmtMoney(d.inflow)}</td>
                          <td style={{ color: 'var(--red)' }}>{fmtMoney(d.outflow)}</td>
                          <td style={{ fontWeight: 900, color: diffColor(d.net) }}>{fmtMoney(d.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h"><b>Движения (наличные)</b></div>
              {!cashBook?.entries?.length ? <div className="k-empty">Пусто</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Операция</th>
                        <th>Сумма</th>
                        <th>Остаток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashBook.entries.slice(0, 200).map(e => (
                        <tr key={e.id}>
                          <td>{fmtDateTime(e.createdAtIso)}</td>
                          <td>
                            <div style={{ fontWeight: 800 }}>{ledgerTypeLabel(e.type)}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.reason || e.note || e.cashierName || ''}</div>
                          </td>
                          <td style={{ fontWeight: 900, color: (e.signedAmount || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {(e.signedAmount || 0) >= 0 ? '+' : ''}{fmtMoney(e.signedAmount)}
                          </td>
                          <td>{fmtMoney(e.balanceAfter ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'journal' && (
        <div className="k-card" style={{ overflow: 'hidden' }}>
          <div className="k-card-h">
            <b>Журнал всех операций</b>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>кто · когда · сколько · почему</span>
          </div>
          {!journal.length ? (
            <div className="k-empty">Нет записей — операции появятся после продаж, расходов, закрытия смен</div>
          ) : (
            <div className="k-tbl-scroll">
              <table className="k-tbl">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тип</th>
                    <th>Кто</th>
                    <th>Сумма</th>
                    <th>Почему</th>
                    <th>Ссылка</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map(r => (
                    <tr key={r.id}>
                      <td>{fmtDateTime(r.createdAtIso)}</td>
                      <td style={{ fontWeight: 800 }}>{ledgerTypeLabel(r.type)}</td>
                      <td>{r.cashierName || r.cashierId || '—'}</td>
                      <td style={{ fontWeight: 900, color: r.direction === 'out' ? 'var(--red)' : r.direction === 'in' ? 'var(--green)' : 'var(--muted)' }}>
                        {r.direction === 'info'
                          ? fmtMoney(r.signedAmount || r.amount)
                          : `${r.direction === 'out' ? '−' : '+'}${fmtMoney(r.amount)}`}
                      </td>
                      <td>{r.reason || r.note || '—'}</td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{r.refType ? `${r.refType}:${r.refId}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'profit' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard"><div className="kl">Выручка</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(profit?.summary.revenue ?? 0)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Себестоимость (FIFO)</div><div className="kv">{fmtMoney(profit?.summary.cogs ?? 0)}</div></div>
            <div className="k-kpi k-statcard">
              <div className="kl">Прибыль</div>
              <div className="kv" style={{ color: (profit?.summary.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(profit?.summary.profit ?? 0)}
              </div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Наценка %</div><div className="kv">{profit?.summary.marginPct ?? 0}%</div></div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h"><b>Прибыль по товарам</b></div>
            {!profit?.products?.length ? <div className="k-empty">Нет данных</div> : (
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
                    {profit.products.map(p => (
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

      {tab === 'expenses' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard">
              <div className="kl">Расходы за период</div>
              <div className="kv" style={{ color: 'var(--red)' }}>{fmtMoney(expenseTotal)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Записей</div>
              <div className="kv">{periodExpenses.length}</div>
            </div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h">
              <b>Список расходов</b>
              <button type="button" className="k-btn k-btn-g" style={{ padding: '8px 12px' }} onClick={() => { setMsg(''); setExpOpen(true) }}>
                + Добавить
              </button>
            </div>
            {!periodExpenses.length ? (
              <div className="k-empty">Расходов за период нет — нажмите «Добавить»</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Категория</th>
                      <th>Сумма</th>
                      <th>Заметка</th>
                      <th>Кто</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodExpenses.map(e => (
                      <tr key={e.id}>
                        <td>{fmtDateTime(e.createdAtIso)}</td>
                        <td style={{ fontWeight: 800 }}>{e.category}</td>
                        <td style={{ color: 'var(--red)', fontWeight: 900 }}>{fmtMoney(e.amount)}</td>
                        <td>{e.note || '—'}</td>
                        <td>{e.createdBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'deposits' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard">
              <div className="kl">Вклады (всё время)</div>
              <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(depositsAll)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Снятия (всё время)</div>
              <div className="kv" style={{ color: 'var(--red)' }}>{fmtMoney(withdrawsAll)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Чистый капитал</div>
              <div className="kv" style={{ color: capitalNet >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(capitalNet)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">За период · вклад / снятие</div>
              <div className="kv" style={{ fontSize: 18 }}>{fmtMoney(deposits)} / {fmtMoney(withdraws)}</div>
            </div>
          </div>
          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h">
              <b>Вклады и снятия</b>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="k-btn k-btn-g" style={{ padding: '8px 12px' }} onClick={() => { setMsg(''); setDepType('deposit'); setDepOpen(true) }}>
                  + Вклад
                </button>
                <button type="button" className="k-btn k-btn-s" style={{ padding: '8px 12px' }} onClick={() => { setMsg(''); setDepType('withdraw'); setDepOpen(true) }}>
                  − Снятие
                </button>
              </div>
            </div>
            {!financeMoves.length ? (
              <div className="k-empty">Пока нет вкладов — добавьте, если положили свои деньги в кассу</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Тип</th>
                      <th>Сумма</th>
                      <th>Заметка</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {financeMoves.map(m => (
                      <tr key={m.id}>
                        <td>{fmtDateTime(m.createdAtIso)}</td>
                        <td style={{ fontWeight: 800, color: m.type === 'deposit' ? 'var(--green)' : 'var(--red)' }}>
                          {m.type === 'deposit' ? 'Вклад' : 'Снятие'}
                        </td>
                        <td style={{ fontWeight: 900 }}>{fmtMoney(m.amount)}</td>
                        <td>{m.note || '—'}</td>
                        <td>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px' }} onClick={() => void removeMove(m.id)}>
                            Удалить
                          </button>
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

      {tab === 'debts' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard">
              <div className="kl">Нам должны (клиенты)</div>
              <div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(clientDebt)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Мы должны (поставщики)</div>
              <div className="kv">{fmtMoney(supplierDebt)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Выдано в долг за период</div>
              <div className="kv">{fmtMoney(creditOut)}</div>
            </div>
          </div>
          <div className="k-grid2">
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h"><b>Клиенты-должники</b></div>
              {!clientDebtors.length ? <div className="k-empty">Нет долгов клиентов</div> : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>Клиент</th>
                        <th>Долг</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientDebtors.slice(0, 30).map(c => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 800 }}>{c.name}</td>
                          <td style={{ color: 'var(--gold)', fontWeight: 900 }}>{fmtMoney(c.debt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="k-card" style={{ overflow: 'hidden' }}>
              <div className="k-card-h"><b>Долг поставщикам</b></div>
              {!suppliers.filter(s => (Number(s.payableAmount) || 0) > 0).length ? (
                <div className="k-empty">Нет долга поставщикам</div>
              ) : (
                <div className="k-tbl-scroll">
                  <table className="k-tbl">
                    <thead>
                      <tr>
                        <th>Поставщик</th>
                        <th>Долг</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...suppliers]
                        .filter(s => (Number(s.payableAmount) || 0) > 0)
                        .sort((a, b) => (Number(b.payableAmount) || 0) - (Number(a.payableAmount) || 0))
                        .map(s => (
                          <tr key={s.id}>
                            <td style={{ fontWeight: 800 }}>{s.name}</td>
                            <td style={{ fontWeight: 900 }}>{fmtMoney(s.payableAmount)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {expOpen && (
        <div className="k-modal-bg" onClick={() => !busy && setExpOpen(false)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>Новый расход</b>
              <button type="button" onClick={() => setExpOpen(false)}>×</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div className="k-field">
                <label>Категория</label>
                <select className="k-sel" value={expCat} onChange={e => setExpCat(e.target.value)}>
                  {EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="k-field">
                <label>Сумма</label>
                <input className="k-inp" value={expAmount} onChange={e => setExpAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="k-field">
                <label>Заметка</label>
                <input className="k-inp" value={expNote} onChange={e => setExpNote(e.target.value)} placeholder="За что…" />
              </div>
              {msg && <div className="k-alert" style={{ marginBottom: 12, background: '#2a1420', color: '#FF8A8A' }}>{msg}</div>}
              <button type="button" className="k-btn k-btn-g" style={{ width: '100%' }} disabled={busy} onClick={() => void submitExpense()}>
                {busy ? 'Сохраняем…' : 'Сохранить расход'}
              </button>
            </div>
          </div>
        </div>
      )}

      {depOpen && (
        <div className="k-modal-bg" onClick={() => !busy && setDepOpen(false)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>{depType === 'deposit' ? 'Вклад в кассу' : 'Снятие из кассы'}</b>
              <button type="button" onClick={() => setDepOpen(false)}>×</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div className="k-field">
                <label>Тип</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className={`k-subtab ${depType === 'deposit' ? 'active' : ''}`} onClick={() => setDepType('deposit')}>Вклад</button>
                  <button type="button" className={`k-subtab ${depType === 'withdraw' ? 'active' : ''}`} onClick={() => setDepType('withdraw')}>Снятие</button>
                </div>
              </div>
              <div className="k-field">
                <label>Сумма</label>
                <input className="k-inp" value={depAmount} onChange={e => setDepAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="k-field">
                <label>Заметка</label>
                <input className="k-inp" value={depNote} onChange={e => setDepNote(e.target.value)} placeholder="Откуда / зачем…" />
              </div>
              {msg && <div className="k-alert" style={{ marginBottom: 12, background: '#2a1420', color: '#FF8A8A' }}>{msg}</div>}
              <button type="button" className="k-btn k-btn-g" style={{ width: '100%' }} disabled={busy} onClick={() => void submitDeposit()}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
