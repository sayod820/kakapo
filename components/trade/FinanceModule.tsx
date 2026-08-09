'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { FinanceTruthBundle, MoneyLedgerEntry } from '@/lib/types'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { guardMutation, useCanMutate, OFFLINE_BLOCK_MESSAGE } from '@/lib/offlineGuard'
import { isOfflineV2Full } from '@/lib/offlineV2'
import { expenseCreateSafe, expenseDeleteSafe, financeMoveDeleteSafe, financeMoveSafe } from '@/lib/offlinePosOps'
import {
  buildLocalFinanceTruth,
  cacheFinanceTruth,
  readCachedFinanceTruth,
} from '@/lib/financeTruthCache'
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

const FINANCE_TABS: { id: FinanceTab; label: string; icon: string; hint: string }[] = [
  { id: 'cashbook', label: 'Книга', icon: '📒', hint: 'Наличные: приход, расход и остаток' },
  { id: 'alerts', label: 'Сигналы', icon: '⚠️', hint: 'Недостачи, излишки и долгие смены' },
  { id: 'till', label: 'Сверки', icon: '⚖️', hint: 'Ожидалось в кассе vs факт при закрытии' },
  { id: 'journal', label: 'Журнал', icon: '📋', hint: 'Все операции: кто, когда, сколько' },
  { id: 'profit', label: 'Прибыль', icon: '💎', hint: 'Выручка минус себестоимость' },
  { id: 'expenses', label: 'Расходы', icon: '🧾', hint: 'Траты бизнеса за период' },
  { id: 'deposits', label: 'Вклады', icon: '🏦', hint: 'Свои деньги в кассу и снятия' },
  { id: 'debts', label: 'Долги', icon: '💳', hint: 'Клиенты должны нам · мы — поставщикам' },
]

export default function FinanceModule() {
  const canMutate = useCanMutate()
  const canEditOffline = canMutate || isOfflineV2Full()
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

  const [period, setPeriod] = useState<ReportPeriod>('today')
  const [customFrom, setCustomFrom] = useState(ymdLocal(new Date(Date.now() - 6 * 864e5)))
  const [customTo, setCustomTo] = useState(ymdLocal())
  const [posFilter, setPosFilter] = useState('')
  const [cashierFilter, setCashierFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [tab, setTab] = useState<FinanceTab>('cashbook')
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [truth, setTruth] = useState<FinanceTruthBundle | null>(null)
  const [truthError, setTruthError] = useState('')
  const [truthLocal, setTruthLocal] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

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
          const expected = (Number(s.openingCash) || 0) + (Number(s.salesCash) || 0) + (Number(s.cashInTotal) || 0) - (Number(s.expenseTotal) || 0)
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
    if (!USE_API) {
      const local = buildLocalFinanceTruth({ shifts, financeMoves, expenses, sales })
      setTruth(local)
      setTruthLocal(true)
      setTruthError('')
      return
    }
    setTruthError('')
    try {
      const data = await api.getFinanceTruth(apiQuery)
      setTruth(data)
      setTruthLocal(false)
      void cacheFinanceTruth(apiQuery, data)
    } catch (e) {
      const cached = await readCachedFinanceTruth(apiQuery)
      if (cached) {
        setTruth(cached)
        setTruthLocal(true)
        setTruthError('Нет связи — показаны локальные данные · синк при подключении')
        return
      }
      const local = buildLocalFinanceTruth({ shifts, financeMoves, expenses, sales })
      setTruth(local)
      setTruthLocal(true)
      setTruthError(
        e instanceof Error
          ? `${e.message} · показан локальный расчёт`
          : 'Показан локальный расчёт без сети',
      )
    }
  }, [apiQuery, shifts, financeMoves, expenses, sales])

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

  /** После офлайн-операции сразу пересчитать книгу/KPI из локального стора */
  const applyLocalTruthNow = useCallback(() => {
    const s = usePosStore.getState()
    const local = buildLocalFinanceTruth({
      shifts: s.shifts,
      financeMoves: s.financeMoves,
      expenses: s.expenses,
      sales: s.sales,
    })
    setTruth(local)
    setTruthLocal(true)
    setTruthError('')
    void cacheFinanceTruth(apiQuery, local)
  }, [apiQuery])

  async function afterFinanceMutation(offline: boolean) {
    if (offline) applyLocalTruthNow()
    else await refresh()
  }

  async function submitExpense() {
    if (!isOfflineV2Full() && !guardMutation(setMsg)) return
    setBusy(true)
    setMsg('')
    try {
      const amount = Number(expAmount)
      if (!(amount > 0)) throw new Error('Укажите сумму расхода')
      if (!USE_API && !isOfflineV2Full()) throw new Error('Нужен API')
      const res = await expenseCreateSafe({
        category: expCat.trim() || 'Прочее',
        amount,
        note: expNote.trim() || undefined,
      })
      await afterFinanceMutation(!!res.offline)
      setExpOpen(false)
      setExpAmount('')
      setExpNote('')
      if (res.offline) setMsg('Расход сохранён · отправится при связи')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  async function submitDeposit() {
    if (!isOfflineV2Full() && !guardMutation(setMsg)) return
    setBusy(true)
    setMsg('')
    try {
      const amount = Number(depAmount)
      if (!(amount > 0)) throw new Error('Укажите сумму')
      if (!USE_API && !isOfflineV2Full()) throw new Error('Нужен API')
      const res = await financeMoveSafe({
        type: depType,
        amount,
        note: depNote.trim() || undefined,
      })
      await afterFinanceMutation(!!res.offline)
      setDepOpen(false)
      setDepAmount('')
      setDepNote('')
      if (res.offline) setMsg('Движение сохранено · отправится при связи')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  async function removeMove(id: string) {
    if (!isOfflineV2Full() && !guardMutation()) return
    if (!confirm('Удалить запись?')) return
    try {
      const res = await financeMoveDeleteSafe(id)
      await afterFinanceMutation(!!res.offline)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  async function removeExpense(id: string) {
    if (!isOfflineV2Full() && !guardMutation()) return
    if (!confirm('Удалить этот расход?')) return
    try {
      const res = await expenseDeleteSafe(id)
      await afterFinanceMutation(!!res.offline)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить расход')
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
      <div className="k-finance-mod">
        <div className="k-empty">Загрузка…</div>
      </div>
    )
  }

  const alerts = truth?.alerts
  const vs = truth?.expectedVsActual
  const cashBook = truth?.cashBook
  const profit = truth?.profit
  const journal: MoneyLedgerEntry[] = truth?.journal || []
  const tabMeta = FINANCE_TABS.find(t => t.id === tab)
  const filterCount = [posFilter, cashierFilter, typeFilter].filter(Boolean).length

  return (
    <div className="k-finance-mod">
      {truthLocal && (
        <div className="k-fin-sync-bar">Локальные данные · обновятся при связи</div>
      )}

      <div className="k-kpis k-fin-kpis k-hide-mob">
        <div className="k-kpi k-statcard">
          <div className="kl">В кассе</div>
          <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(cashInTills)}</div>
          <div className="k-fin-kpi-sub">{openTillCount ? `${openTillCount} смен` : 'Нет смен'}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Книга</div>
          <div className="kv">{fmtMoney(cashBook?.balance ?? 0)}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Прибыль</div>
          <div className="kv" style={{ color: (profit?.summary.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmtMoney(profit?.summary.profit ?? 0)}
          </div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Сигналы</div>
          <div className="kv" style={{ color: (alerts?.count ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>
            {alerts?.count ?? 0}
          </div>
        </div>
      </div>

      <div className="k-fin-meta k-hide-desk">
        <div><span>Касса</span><b style={{ color: 'var(--green)' }}>{fmtMoney(cashInTills)}</b></div>
        <div><span>Книга</span><b>{fmtMoney(cashBook?.balance ?? 0)}</b></div>
        <div>
          <span>Прибыль</span>
          <b style={{ color: (profit?.summary.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmtMoney(profit?.summary.profit ?? 0)}
          </b>
        </div>
        <div>
          <span>Сигналы</span>
          <b style={{ color: (alerts?.count ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>{alerts?.count ?? 0}</b>
        </div>
      </div>

      <div className="k-fin-toolbar">
        <div className="k-subtabs k-fin-periods">
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
        <div className="k-fin-actions">
          <button
            type="button"
            className="k-btn k-btn-g"
            disabled={!canEditOffline}
            title={canEditOffline ? 'Вклад' : OFFLINE_BLOCK_MESSAGE}
            onClick={() => { setMsg(''); setDepType('deposit'); setDepOpen(true) }}
          >
            +
          </button>
          <button
            type="button"
            className="k-btn k-btn-s"
            disabled={!canEditOffline}
            title={canEditOffline ? 'Расход' : OFFLINE_BLOCK_MESSAGE}
            onClick={() => { setMsg(''); setExpOpen(true) }}
          >
            −
          </button>
          <button type="button" className="k-btn k-btn-s" disabled={refreshing} title="Обновить" onClick={() => void refresh()}>
            {refreshing ? '…' : '↻'}
          </button>
          <button
            type="button"
            className={`k-btn k-btn-s k-fin-flt-btn${filtersOpen || filterCount ? ' is-on' : ''}`}
            title="Фильтры"
            onClick={() => setFiltersOpen(v => !v)}
          >
            ⚙{filterCount ? ` ${filterCount}` : ''}
          </button>
        </div>
      </div>

      {period === 'custom' && (
        <div className="k-fin-dates">
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

      <div className={`k-fin-filters${filtersOpen ? ' is-open' : ''}`}>
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
        <select className="k-sel" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} title="Тип" aria-label="Тип">
          <option value="">Тип · все</option>
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

      <div className="k-subtabs k-fin-tabs">
        {FINANCE_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`k-subtab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="k-fin-tab-ic">{t.icon}</span>
            <span>{t.label}</span>
            {t.id === 'alerts' && (alerts?.count ?? 0) > 0 ? (
              <span className="k-fin-tab-n">{alerts?.count}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tabMeta && <div className="k-fin-hint">{tabMeta.hint}</div>}

      {(apiError || truthError) && (
        <div className="k-fin-err">{truthError || apiError}</div>
      )}

      {tab === 'alerts' && (
        <div className="k-fin-panel">
          {!alerts?.alerts?.length ? (
            <div className="k-empty">Нет расхождений — всё в норме</div>
          ) : (
            <div className="k-fin-list">
              {alerts.alerts.map(a => (
                <div key={a.id} className="k-fin-row">
                  <div className="k-fin-row-txt">
                    <b style={{ color: a.severity === 'high' ? 'var(--red)' : 'var(--gold)' }}>{a.title}</b>
                    <small>
                      {a.atIso ? fmtDateTime(a.atIso) : '—'}
                      {a.message ? ` · ${a.message}` : ''}
                    </small>
                  </div>
                  <b className="k-fin-amt" style={{ color: diffColor(a.amount) }}>{fmtMoney(a.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'till' && (
        <>
          <div className="k-fin-submeta">
            <div><span>Смен</span><b>{vs?.summary.shifts ?? 0}</b></div>
            <div><span>Алерты</span><b style={{ color: 'var(--red)' }}>{vs?.summary.withAlert ?? 0}</b></div>
            <div><span>Недостачи</span><b style={{ color: 'var(--red)' }}>{vs?.summary.shortCount ?? 0}</b></div>
            <div><span>Излишки</span><b style={{ color: 'var(--green)' }}>{vs?.summary.overCount ?? 0}</b></div>
          </div>
          <div className="k-fin-panel">
            {!vs?.rows?.length ? (
              <div className="k-empty">Нет закрытых смен за период</div>
            ) : (
              <div className="k-fin-list">
                {vs.rows.map(r => (
                  <div key={r.shiftId} className={`k-fin-row${r.alert ? ' is-warn' : ''}`}>
                    <div className="k-fin-row-txt">
                      <b>{r.day || '—'} · {r.cashierName || '—'}</b>
                      <small>
                        {posLabel(r.posId)} · ожид. {fmtMoney(r.expectedCash)} · факт {fmtMoney(r.actualCash)}
                      </small>
                    </div>
                    <b className="k-fin-amt" style={{ color: diffColor(r.cashDiff) }}>
                      {r.cashDiff > 0 ? '+' : ''}{fmtMoney(r.cashDiff)}
                      {r.alert ? ' ⚠' : ''}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'cashbook' && (
        <>
          <div className="k-fin-submeta">
            <div><span>Приход</span><b style={{ color: 'var(--green)' }}>{fmtMoney(cashBook?.summary.inflow ?? 0)}</b></div>
            <div><span>Расход</span><b style={{ color: 'var(--red)' }}>{fmtMoney(cashBook?.summary.outflow ?? 0)}</b></div>
            <div><span>Баланс</span><b>{fmtMoney(cashBook?.balance ?? 0)}</b></div>
            <div><span>Записей</span><b>{cashBook?.summary.count ?? 0}</b></div>
          </div>
          <div className="k-fin-split">
            <div className="k-fin-panel">
              <div className="k-fin-panel-h">По дням</div>
              {!cashBook?.days?.length ? <div className="k-empty">Нет движений</div> : (
                <div className="k-fin-list">
                  {cashBook.days.slice(0, 60).map(d => (
                    <div key={d.day} className="k-fin-row">
                      <div className="k-fin-row-txt">
                        <b>{d.day}</b>
                        <small>
                          +{fmtMoney(d.inflow)} / −{fmtMoney(d.outflow)}
                        </small>
                      </div>
                      <b className="k-fin-amt" style={{ color: diffColor(d.net) }}>{fmtMoney(d.net)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="k-fin-panel">
              <div className="k-fin-panel-h">Движения</div>
              {!cashBook?.entries?.length ? <div className="k-empty">Пусто</div> : (
                <div className="k-fin-list">
                  {cashBook.entries.slice(0, 200).map(e => (
                    <div key={e.id} className="k-fin-row">
                      <div className="k-fin-row-txt">
                        <b>{ledgerTypeLabel(e.type)}</b>
                        <small>
                          {fmtDateTime(e.createdAtIso)}
                          {e.reason || e.note || e.cashierName ? ` · ${e.reason || e.note || e.cashierName}` : ''}
                        </small>
                      </div>
                      <div className="k-fin-amt-col">
                        <b style={{ color: (e.signedAmount || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {(e.signedAmount || 0) >= 0 ? '+' : ''}{fmtMoney(e.signedAmount)}
                        </b>
                        <small>ост. {fmtMoney(e.balanceAfter ?? 0)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'journal' && (
        <div className="k-fin-panel">
          {!journal.length ? (
            <div className="k-empty">Нет записей за период</div>
          ) : (
            <div className="k-fin-list">
              {journal.map(r => (
                <div key={r.id} className="k-fin-row">
                  <div className="k-fin-row-txt">
                    <b>{ledgerTypeLabel(r.type)}</b>
                    <small>
                      {fmtDateTime(r.createdAtIso)} · {r.cashierName || r.cashierId || '—'}
                      {r.reason || r.note ? ` · ${r.reason || r.note}` : ''}
                    </small>
                  </div>
                  <b
                    className="k-fin-amt"
                    style={{ color: r.direction === 'out' ? 'var(--red)' : r.direction === 'in' ? 'var(--green)' : 'var(--muted)' }}
                  >
                    {r.direction === 'info'
                      ? fmtMoney(r.signedAmount || r.amount)
                      : `${r.direction === 'out' ? '−' : '+'}${fmtMoney(r.amount)}`}
                  </b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'profit' && (
        <>
          <div className="k-fin-submeta">
            <div><span>Выручка</span><b style={{ color: 'var(--green)' }}>{fmtMoney(profit?.summary.revenue ?? 0)}</b></div>
            <div><span>Себест.</span><b>{fmtMoney(profit?.summary.cogs ?? 0)}</b></div>
            <div>
              <span>Прибыль</span>
              <b style={{ color: (profit?.summary.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(profit?.summary.profit ?? 0)}
              </b>
            </div>
            <div><span>Наценка</span><b>{profit?.summary.marginPct ?? 0}%</b></div>
          </div>
          <div className="k-fin-panel">
            {!profit?.products?.length ? <div className="k-empty">Нет данных</div> : (
              <div className="k-fin-list">
                {profit.products.map(p => (
                  <div key={p.productId} className="k-fin-row">
                    <div className="k-fin-row-txt">
                      <b>{p.productName}</b>
                      <small>×{p.qty} · выр. {fmtMoney(p.revenue)} · себ. {fmtMoney(p.cogs)}</small>
                    </div>
                    <b className="k-fin-amt" style={{ color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(p.profit)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'expenses' && (
        <>
          <div className="k-fin-submeta k-fin-submeta-2">
            <div><span>Расходы</span><b style={{ color: 'var(--red)' }}>{fmtMoney(expenseTotal)}</b></div>
            <div><span>Записей</span><b>{periodExpenses.length}</b></div>
          </div>
          <div className="k-fin-panel">
            {!periodExpenses.length ? (
              <div className="k-empty">Расходов нет — нажмите −</div>
            ) : (
              <div className="k-fin-list">
                {periodExpenses.map(e => (
                  <div key={e.id} className="k-fin-row">
                    <div className="k-fin-row-txt">
                      <b>{e.category}</b>
                      <small>
                        {fmtDateTime(e.createdAtIso)}
                        {e.note ? ` · ${e.note}` : ''}
                        {e.createdBy ? ` · ${e.createdBy}` : ''}
                      </small>
                    </div>
                    <div className="k-fin-amt-col">
                      <b style={{ color: 'var(--red)' }}>{fmtMoney(e.amount)}</b>
                      <button
                        type="button"
                        className="k-btn k-btn-s k-fin-del"
                        disabled={!canEditOffline}
                        title={canEditOffline ? 'Удалить' : OFFLINE_BLOCK_MESSAGE}
                        onClick={() => void removeExpense(e.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'deposits' && (
        <>
          <div className="k-fin-submeta">
            <div><span>Вклады</span><b style={{ color: 'var(--green)' }}>{fmtMoney(depositsAll)}</b></div>
            <div><span>Снятия</span><b style={{ color: 'var(--red)' }}>{fmtMoney(withdrawsAll)}</b></div>
            <div><span>Капитал</span><b style={{ color: capitalNet >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(capitalNet)}</b></div>
            <div><span>Период</span><b style={{ fontSize: 12 }}>{fmtMoney(deposits)} / {fmtMoney(withdraws)}</b></div>
          </div>
          <div className="k-fin-panel">
            <div className="k-fin-panel-h">
              <span>Вклады и снятия</span>
              <div className="k-fin-panel-acts">
                <button type="button" className="k-btn k-btn-g" onClick={() => { setMsg(''); setDepType('deposit'); setDepOpen(true) }}>+ Вклад</button>
                <button type="button" className="k-btn k-btn-s" onClick={() => { setMsg(''); setDepType('withdraw'); setDepOpen(true) }}>− Снятие</button>
              </div>
            </div>
            {!financeMoves.length ? (
              <div className="k-empty">Пока нет вкладов</div>
            ) : (
              <div className="k-fin-list">
                {financeMoves.map(m => (
                  <div key={m.id} className="k-fin-row">
                    <div className="k-fin-row-txt">
                      <b style={{ color: m.type === 'deposit' ? 'var(--green)' : 'var(--red)' }}>
                        {m.type === 'deposit' ? 'Вклад' : 'Снятие'}
                      </b>
                      <small>
                        {fmtDateTime(m.createdAtIso)}
                        {m.note ? ` · ${m.note}` : ''}
                      </small>
                    </div>
                    <div className="k-fin-amt-col">
                      <b>{fmtMoney(m.amount)}</b>
                      <button type="button" className="k-btn k-btn-s k-fin-del" onClick={() => void removeMove(m.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'debts' && (
        <>
          <div className="k-fin-submeta">
            <div><span>Клиенты</span><b style={{ color: 'var(--gold)' }}>{fmtMoney(clientDebt)}</b></div>
            <div><span>Поставщики</span><b>{fmtMoney(supplierDebt)}</b></div>
            <div><span>Выдано</span><b>{fmtMoney(creditOut)}</b></div>
          </div>
          <div className="k-fin-split">
            <div className="k-fin-panel">
              <div className="k-fin-panel-h">Клиенты должны</div>
              {!clientDebtors.length ? <div className="k-empty">Нет долгов</div> : (
                <div className="k-fin-list">
                  {clientDebtors.slice(0, 30).map(c => (
                    <div key={c.id} className="k-fin-row">
                      <div className="k-fin-row-txt"><b>{c.name}</b></div>
                      <b className="k-fin-amt" style={{ color: 'var(--gold)' }}>{fmtMoney(c.debt)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="k-fin-panel">
              <div className="k-fin-panel-h">Мы должны</div>
              {!suppliers.filter(s => (Number(s.payableAmount) || 0) > 0).length ? (
                <div className="k-empty">Нет долга</div>
              ) : (
                <div className="k-fin-list">
                  {[...suppliers]
                    .filter(s => (Number(s.payableAmount) || 0) > 0)
                    .sort((a, b) => (Number(b.payableAmount) || 0) - (Number(a.payableAmount) || 0))
                    .map(s => (
                      <div key={s.id} className="k-fin-row">
                        <div className="k-fin-row-txt"><b>{s.name}</b></div>
                        <b className="k-fin-amt">{fmtMoney(s.payableAmount)}</b>
                      </div>
                    ))}
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
