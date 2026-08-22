'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { USE_API } from '@/lib/config'
import type { MoneyLedgerEntry } from '@/lib/types'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { softSyncFinance, softSyncPosAfterSale, softSyncWarehouse, usePosStore } from '@/lib/posStore'
import { guardMutation, useCanMutate, OFFLINE_BLOCK_MESSAGE } from '@/lib/offlineGuard'
import { isTradeLocalFirst } from '@/lib/offlineV2'
import { expenseCreateSafe, expenseDeleteSafe, financeMoveDeleteSafe, financeMoveSafe, vaultCardToCashSafe, vaultCashToCardSafe } from '@/lib/offlinePosOps'
import { useOfflineSync } from '@/lib/offlineSync'
import {
  buildLocalFinanceTruth,
  cacheFinanceTruth,
} from '@/lib/financeTruthCache'
import { fmtDateTime, fmtMoney } from './warehouse/warehouseShared'
import { useBackClose } from '@/lib/hardwareBack'
import {
  REPORT_PERIODS,
  downloadCsv,
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
import { resolveOpenShift, shiftExpectedCashLocal } from '@/lib/offlinePosOps'

const EXPENSE_CATS = ['Аренда', 'Зарплата', 'Коммунальные', 'Транспорт', 'Реклама', 'Хозтовары', 'Прочее']

type FinanceTab =
  | 'box'
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
  { id: 'box', label: 'Ящик', icon: '🗃️', hint: 'Продажа идёт в смену. В основной — только после закрытия.' },
]

export default function FinanceModule() {
  const canMutate = useCanMutate()
  const canEditOffline = canMutate || isTradeLocalFirst()
  const sales = usePosStore(s => s.sales)
  const shifts = usePosStore(s => s.shifts)
  const expenses = usePosStore(s => s.expenses)
  const financeMoves = usePosStore(s => s.financeMoves)
  const suppliers = usePosStore(s => s.suppliers)
  const cashiers = usePosStore(s => s.cashiers)
  const posPoints = usePosStore(s => s.posPoints)
  const receipts = usePosStore(s => s.receipts)
  const cashVault = usePosStore(s => s.cashVault)
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
  const savingRef = useRef(false)
  const [msg, setMsg] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [expOpen, setExpOpen] = useState(false)
  const [expCat, setExpCat] = useState('Прочее')
  const [expAmount, setExpAmount] = useState('')
  const [expNote, setExpNote] = useState('')

  const [depOpen, setDepOpen] = useState(false)
  const [depType, setDepType] = useState<'deposit' | 'withdraw'>('deposit')
  const [depAmount, setDepAmount] = useState('')
  const [depNote, setDepNote] = useState('')
  const [depShiftId, setDepShiftId] = useState('')

  const [delMoveId, setDelMoveId] = useState<string | null>(null)
  const [delExpId, setDelExpId] = useState<string | null>(null)
  const [convOpen, setConvOpen] = useState(false)
  const [convDir, setConvDir] = useState<'card_to_cash' | 'cash_to_card'>('card_to_cash')
  const [convAmount, setConvAmount] = useState('')
  const [convNote, setConvNote] = useState('')

  const openShifts = useMemo(() => shifts.filter(s => s.status === 'open'), [shifts])

  useBackClose(expOpen, () => { if (!busy) setExpOpen(false) })
  useBackClose(depOpen, () => { if (!busy) setDepOpen(false) })
  useBackClose(convOpen, () => { if (!busy) setConvOpen(false) })
  useBackClose(filtersOpen, () => setFiltersOpen(false))
  useBackClose(!!delMoveId, () => setDelMoveId(null))
  useBackClose(!!delExpId, () => setDelExpId(null))

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
  const capitalNet = useMemo(() => round2(deposits - withdraws), [deposits, withdraws])
  const capitalNetAll = useMemo(() => round2(depositsAll - withdrawsAll), [depositsAll, withdrawsAll])

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

  /** Одна цифра: только локальный стор. Серверный truth больше не подменяет книгу. */
  const truth = useMemo(
    () => buildLocalFinanceTruth({
      shifts,
      financeMoves,
      expenses,
      sales,
      receipts,
      cashVault,
      posPoints,
      fromMs: from,
      toMs: to,
      posId: posFilter || undefined,
      cashierId: cashierFilter || undefined,
      type: typeFilter || undefined,
    }),
    [shifts, financeMoves, expenses, sales, receipts, cashVault, posPoints, from, to, posFilter, cashierFilter, typeFilter],
  )

  useEffect(() => {
    void cacheFinanceTruth(apiQuery, truth)
  }, [apiQuery, truth])

  const refresh = useCallback(() => {
    setRefreshing(true)
    void (async () => {
      try {
        const { isOnline } = await import('@/lib/offline')
        const online = isOnline() && useOfflineSync.getState().online
        if (online) {
          await Promise.allSettled([
            softSyncPosAfterSale(),
            softSyncWarehouse(),
            softSyncFinance(),
            syncClientsFromApi(),
          ])
        }
      } finally {
        setRefreshing(false)
      }
    })()
  }, [])

  async function afterFinanceMutation(_offline: boolean) {
    void useOfflineSync.getState().syncNow()
  }

  async function submitExpense() {
    if (savingRef.current || busy) return
    if (!isTradeLocalFirst() && !guardMutation(setMsg)) return
    savingRef.current = true
    setBusy(true)
    setMsg('')
    try {
      const amount = Number(expAmount)
      if (!(amount > 0)) throw new Error('Укажите сумму расхода')
      if (!USE_API && !isTradeLocalFirst()) throw new Error('Нужен API')
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
      savingRef.current = false
      setBusy(false)
    }
  }

  async function submitDeposit() {
    if (savingRef.current || busy) return
    if (!isTradeLocalFirst() && !guardMutation(setMsg)) return
    savingRef.current = true
    setBusy(true)
    setMsg('')
    try {
      const amount = Number(depAmount)
      if (!(amount > 0)) throw new Error('Укажите сумму')
      if (!USE_API && !isTradeLocalFirst()) throw new Error('Нужен API')
      const open = depShiftId
        ? shifts.find(s => s.id === depShiftId && s.status === 'open')
        : resolveOpenShift()
      if (!open && openShifts.length > 0) throw new Error('Выберите открытую смену')
      if (!open) throw new Error('Нет открытой смены — откройте смену на кассе')
      if (depType === 'withdraw') {
        const expected = shiftExpectedCashLocal(open)
        if (amount > expected + 0.009) {
          throw new Error(`В кассе недостаточно (доступно ${expected.toFixed(2)} сом)`)
        }
      }
      const res = await financeMoveSafe({
        type: depType,
        amount,
        note: depNote.trim() || undefined,
        shiftId: open.id,
        posId: open.posId,
        cashierId: open.cashierId,
        cashierName: open.cashierName,
      })
      await afterFinanceMutation(!!res.offline)
      setDepOpen(false)
      setDepAmount('')
      setDepNote('')
      setDepShiftId('')
      if (res.offline) setMsg('Движение сохранено · отправится при связи')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  async function submitConvert() {
    if (savingRef.current || busy) return
    if (!isTradeLocalFirst() && !guardMutation(setMsg)) return
    savingRef.current = true
    setBusy(true)
    setMsg('')
    try {
      const amount = Number(convAmount)
      if (!(amount > 0)) throw new Error('Укажите сумму')
      const toCash = convDir === 'card_to_cash'
      const max = round2(toCash ? (cashBox?.totalCard ?? 0) : (cashBox?.totalCash ?? 0))
      if (amount > max + 0.009) {
        throw new Error(toCash ? `На карте только ${max.toFixed(2)} сом` : `Наличных только ${max.toFixed(2)} сом`)
      }
      const res = toCash
        ? await vaultCardToCashSafe({ amount, note: convNote.trim() || undefined })
        : await vaultCashToCardSafe({ amount, note: convNote.trim() || undefined })
      await afterFinanceMutation(!!res.offline)
      setConvOpen(false)
      setConvAmount('')
      setConvNote('')
      if (res.offline) setMsg('Перевод сохранён · отправится при связи')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  function removeMove(id: string) {
    if (!isTradeLocalFirst() && !guardMutation()) return
    setDelMoveId(id)
  }

  function removeExpense(id: string) {
    if (!isTradeLocalFirst() && !guardMutation()) return
    setDelExpId(id)
  }

  async function confirmRemoveMove() {
    const id = delMoveId
    if (!id || savingRef.current) return
    savingRef.current = true
    setDelMoveId(null)
    setMsg('')
    try {
      const res = await financeMoveDeleteSafe(id)
      await afterFinanceMutation(!!res.offline)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить')
    } finally {
      savingRef.current = false
    }
  }

  async function confirmRemoveExpense() {
    const id = delExpId
    if (!id || savingRef.current) return
    savingRef.current = true
    setDelExpId(null)
    setMsg('')
    try {
      const res = await expenseDeleteSafe(id)
      await afterFinanceMutation(!!res.offline)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить расход')
    } finally {
      savingRef.current = false
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

  // Не блокируем раздел «Загрузка…» — рисуем локальные данные сразу
  // (apiReady приходит из hydrate; сеть догоняет в фоне)

  const alerts = truth?.alerts
  const vs = truth?.expectedVsActual
  const cashBook = truth?.cashBook
  const profit = truth?.profit
  const cashBox = truth?.cashBox
  const mainCash = cashBox?.main.cash ?? 0
  const mainCard = cashBox?.main.card ?? 0
  const mainTotal = round2(mainCash + mainCard)
  const liveCash = round2((cashBox?.points || []).reduce((a, p) => a + (Number(p.cashNow) || 0), 0))
  const liveCard = round2((cashBox?.points || []).reduce((a, p) => a + (Number(p.cardNow) || 0), 0))
  const shopTotal = round2(mainTotal + liveCash + liveCard)
  const journal: MoneyLedgerEntry[] = truth?.journal || []
  const tabMeta = FINANCE_TABS.find(t => t.id === tab)
  const filterCount = (tab === 'box' ? [posFilter] : [posFilter, cashierFilter, typeFilter]).filter(Boolean).length

  function exportCsv() {
    const stamp = ymdLocal()
    if (tab === 'box') {
      downloadCsv(`kakapo-finance-box-${stamp}.csv`,
        ['Где', 'Нал', 'Карта', 'Статус'],
        [
          ['Основной', mainCash, mainCard, 'после закрытия смен'],
          ['На точках сейчас', liveCash, liveCard, 'открытые смены'],
          ['В магазине всего', round2((cashBox?.totalCash ?? 0) + (cashBox?.totalCard ?? 0)), '', ''],
          ...(cashBox?.points || []).map(p => [
            p.posName,
            p.cashNow,
            p.cardNow,
            p.open ? `открыта · ${p.cashierName || ''}` : 'нет смены',
          ]),
        ])
      return
    }
    if (tab === 'cashbook') {
      downloadCsv(`kakapo-finance-cashbook-${stamp}.csv`,
        ['Дата', 'Тип', 'Сумма', 'Остаток', 'Комментарий'],
        (cashBook?.entries || []).map(e => [
          e.createdAtIso || '',
          ledgerTypeLabel(e.type),
          e.signedAmount ?? e.amount,
          e.balanceAfter ?? '',
          e.reason || e.note || '',
        ]))
      return
    }
    if (tab === 'journal') {
      downloadCsv(`kakapo-finance-journal-${stamp}.csv`,
        ['Дата', 'Тип', 'Направление', 'Сумма', 'Кассир', 'Комментарий'],
        journal.map(r => [
          r.createdAtIso || '',
          ledgerTypeLabel(r.type),
          r.direction,
          r.signedAmount ?? r.amount,
          r.cashierName || r.cashierId || '',
          r.reason || r.note || '',
        ]))
      return
    }
    if (tab === 'till') {
      downloadCsv(`kakapo-finance-till-${stamp}.csv`,
        ['День', 'Кассир', 'Точка', 'Ожид.', 'Факт', 'Разница'],
        (vs?.rows || []).map(r => [
          r.day || '',
          r.cashierName || '',
          posLabel(r.posId),
          r.expectedCash,
          r.actualCash,
          r.cashDiff,
        ]))
      return
    }
    if (tab === 'profit') {
      downloadCsv(`kakapo-finance-profit-${stamp}.csv`,
        ['Товар', 'Кол-во', 'Выручка', 'Себест.', 'Прибыль'],
        (profit?.products || []).map(p => [p.productName, p.qty, p.revenue, p.cogs, p.profit]))
      return
    }
    if (tab === 'expenses') {
      downloadCsv(`kakapo-finance-expenses-${stamp}.csv`,
        ['Дата', 'Категория', 'Сумма', 'Заметка', 'Кто'],
        periodExpenses.map(e => [e.createdAtIso || '', e.category, e.amount, e.note || '', e.createdBy || '']))
      return
    }
    if (tab === 'deposits') {
      downloadCsv(`kakapo-finance-deposits-${stamp}.csv`,
        ['Дата', 'Тип', 'Сумма', 'Заметка'],
        periodMoves.map(m => [m.createdAtIso || '', m.type === 'deposit' ? 'Вклад' : 'Снятие', m.amount, m.note || '']))
      return
    }
    if (tab === 'alerts') {
      downloadCsv(`kakapo-finance-alerts-${stamp}.csv`,
        ['Дата', 'Сигнал', 'Сумма', 'Текст'],
        (alerts?.alerts || []).map(a => [a.atIso || '', a.title, a.amount, a.message || '']))
      return
    }
    if (tab === 'debts') {
      downloadCsv(`kakapo-finance-debts-${stamp}.csv`,
        ['Кто', 'Тип', 'Сумма'],
        [
          ...clientDebtors.map(c => [c.name, 'Клиент', Number(c.debt) || 0] as (string | number)[]),
          ...suppliers.filter(s => (Number(s.payableAmount) || 0) > 0)
            .map(s => [s.name, 'Поставщик', Number(s.payableAmount) || 0] as (string | number)[]),
        ])
    }
  }

  function printFinance() {
    const root = document.querySelector('.k-finance-mod')
    if (!root || typeof window === 'undefined') return
    const w = window.open('', '_blank', 'noopener,noreferrer')
    if (!w) {
      setMsg('Разрешите всплывающие окна для печати')
      return
    }
    const title = `Финансы · ${tabMeta?.label || tab}`
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  body{font:13px/1.45 system-ui,-apple-system,sans-serif;color:#111;padding:16px;margin:0}
  h2{margin:0 0 12px;font-size:18px}
  .k-btn,.k-fin-toolbar,.k-fin-actions,.k-fin-filters,.k-fin-dates,.k-fin-fab,.k-fin-fab-stack,
  .k-subtabs,.k-fin-periods,.k-fin-flt-btn,.k-fin-tabs{display:none!important}
  .k-fin-list{display:block}
  .k-fin-row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #eee}
  .k-fin-submeta,.k-fin-kpis,.k-fin-meta{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:0 0 10px}
  .k-fin-submeta>div,.k-kpi{border:1px solid #ddd;padding:8px;border-radius:6px}
  .k-empty{padding:12px;color:#666}
  .k-fin-del{display:none!important}
</style></head><body><h2>${title}</h2>${root.innerHTML}</body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div className="k-finance-mod">
      <div className="k-kpis k-fin-kpis k-hide-mob">
        <div className="k-kpi k-statcard">
          <div className="kl">Смены сейчас</div>
          <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(cashInTills)}</div>
          <div className="k-fin-kpi-sub">{openTillCount ? `${openTillCount} открытых · не основной` : 'Нет смен'}</div>
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
        <div><span>Смены</span><b style={{ color: 'var(--green)' }}>{fmtMoney(cashInTills)}</b></div>
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

      <div className={`k-fin-toolbar${tab === 'box' ? ' k-fin-toolbar-box' : ''}`}>
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
          <button type="button" className="k-btn k-btn-s" disabled={refreshing} title="Обновить" onClick={() => void refresh()}>
            {refreshing ? '…' : '↻'}
          </button>
          <button type="button" className="k-btn k-btn-s k-fin-csv" title="CSV" onClick={exportCsv}>CSV</button>
          <button type="button" className="k-btn k-btn-s k-fin-print" title="Печать" onClick={printFinance}>🖨</button>
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

      <div className={`k-fin-filters${tab === 'box' ? ' k-fin-filters-box' : ''}${filtersOpen ? ' is-open' : ''}`}>
        <select className="k-sel" value={posFilter} onChange={e => setPosFilter(e.target.value)} title="Точка" aria-label="Точка">
          <option value="">Точка · все</option>
          {posPoints.filter(p => p.active !== false).map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {tab !== 'box' && (
        <select className="k-sel" value={cashierFilter} onChange={e => setCashierFilter(e.target.value)} title="Кассир" aria-label="Кассир">
          <option value="">Кассир · все</option>
          {cashiers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        )}
        {tab !== 'box' && (
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
        )}
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
      {tabMeta && <div className={`k-fin-hint${tab === 'box' ? ' k-hide-mob' : ''}`}>{tabMeta.hint}</div>}

      {tab === 'box' && (
        <>
          <div className="k-fin-box-hero">
            <div className="kl">Основной ящик</div>
            <div className="kv">{fmtMoney(mainTotal)}</div>
            <div className="k-fin-kpi-sub">сюда падает только после закрытия смены</div>
          </div>
          <div className="k-fin-box-totals">
            <div className="k-fin-box-card k-fin-box-card-cash">
              <div className="kl">Нал в основном</div>
              <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(mainCash)}</div>
            </div>
            <div className="k-fin-box-card k-fin-box-card-card">
              <div className="kl">Карта в основном</div>
              <div className="kv">{fmtMoney(mainCard)}</div>
            </div>
          </div>
          <div className="k-fin-box-move-row">
            <button
              type="button"
              className="k-btn k-btn-g k-fin-box-move"
              disabled={!canEditOffline || (cashBox?.totalCard ?? 0) < 0.01}
              title={canEditOffline ? 'Перевести с карты в нал' : OFFLINE_BLOCK_MESSAGE}
              onClick={() => {
                setMsg('')
                setConvDir('card_to_cash')
                setConvAmount(String(mainCard || cashBox?.totalCard || ''))
                setConvOpen(true)
              }}
            >
              Карта → нал
            </button>
            <button
              type="button"
              className="k-btn k-fin-box-move"
              disabled={!canEditOffline || (cashBox?.totalCash ?? 0) < 0.01}
              title={canEditOffline ? 'Перевести с нал на карту' : OFFLINE_BLOCK_MESSAGE}
              onClick={() => {
                setMsg('')
                setConvDir('cash_to_card')
                setConvAmount(String(mainCash || cashBox?.totalCash || ''))
                setConvOpen(true)
              }}
            >
              Нал → карта
            </button>
          </div>

          <div className="k-fin-panel k-fin-box-main">
            <div className="k-fin-panel-h">Сейчас на точках</div>
            <div className="k-fin-submeta k-fin-submeta-2">
              <div><span>Нал в сменах</span><b style={{ color: 'var(--green)' }}>{fmtMoney(liveCash)}</b></div>
              <div><span>Карта в сменах</span><b>{fmtMoney(liveCard)}</b></div>
            </div>
            <div className="k-fin-hint" style={{ marginBottom: 8 }}>
              Продал на кассе — пишется сюда. Закрыл смену — уходит в основной.
            </div>
            {!cashBox?.points?.length ? (
              <div className="k-empty">Нет точек кассы</div>
            ) : (
              <div className="k-fin-box-points">
                {cashBox.points.map(p => (
                  <div key={p.posId} className={`k-fin-box-point${p.open ? ' is-open' : ''}`}>
                    <div className="k-fin-box-point-h">
                      <b>{p.posName}</b>
                      <span className={p.open ? 'is-on' : ''}>
                        {p.open ? `Смена · ${p.cashierName || 'кассир'}` : 'Нет смены'}
                      </span>
                    </div>
                    <div className="k-fin-box-point-nums">
                      <div><span>Нал</span><b style={{ color: 'var(--green)' }}>{fmtMoney(p.cashNow)}</b></div>
                      <div><span>Карта</span><b>{fmtMoney(p.cardNow)}</b></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="k-fin-panel">
            <div className="k-fin-panel-h">В магазине всего</div>
            <div className="k-fin-submeta k-fin-submeta-2">
              <div><span>Основной + точки</span><b>{fmtMoney(shopTotal)}</b></div>
              <div><span>Нал / карта</span><b>{fmtMoney(cashBox?.totalCash ?? 0)} · {fmtMoney(cashBox?.totalCard ?? 0)}</b></div>
            </div>
          </div>

          <div className="k-fin-panel">
            <div className="k-fin-panel-h">Последние сдачи в основной</div>
            {!cashBox?.transfers?.length ? (
              <div className="k-empty">Пока нет закрытых смен с сдачей</div>
            ) : (
              <div className="k-fin-list">
                {cashBox.transfers.slice(0, 30).map(t => (
                  <div key={t.id} className="k-fin-row">
                    <div className="k-fin-row-txt">
                      <b>{t.cashierName || 'Кассир'} · {posLabel(t.posId)}</b>
                      <small>
                        {fmtDateTime(t.closedAtIso)}
                        {' · '}нал {fmtMoney(t.cashAmount)} · карта {fmtMoney(t.cardAmount)}
                      </small>
                    </div>
                    <b className="k-fin-amt" style={{ color: 'var(--green)' }}>
                      {fmtMoney(round2((Number(t.cashAmount) || 0) + (Number(t.cardAmount) || 0)))}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
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
                        {posLabel(r.posId)} · нал {fmtMoney(r.expectedCash)}→{fmtMoney(r.actualCash)}
                        {(r as { expectedCard?: number; actualCard?: number }).expectedCard != null
                          ? ` · карта ${fmtMoney((r as { expectedCard?: number }).expectedCard)}→${fmtMoney((r as { actualCard?: number }).actualCard)}`
                          : ''}
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
            <div><span>Вклады</span><b style={{ color: 'var(--green)' }}>{fmtMoney(deposits)}</b></div>
            <div><span>Снятия</span><b style={{ color: 'var(--red)' }}>{fmtMoney(withdraws)}</b></div>
            <div><span>За период</span><b style={{ color: capitalNet >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(capitalNet)}</b></div>
            <div><span>Всего</span><b style={{ color: capitalNetAll >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(capitalNetAll)}</b></div>
          </div>
          <div className="k-fin-panel">
            <div className="k-fin-panel-h">
              <span>Вклады и снятия</span>
            </div>
            {!periodMoves.length ? (
              <div className="k-empty">Нет движений за период</div>
            ) : (
              <div className="k-fin-list">
                {periodMoves.map(m => (
                  <div key={m.id} className="k-fin-row">
                    <div className="k-fin-row-txt">
                      <b style={{ color: m.type === 'deposit' ? 'var(--green)' : 'var(--red)' }}>
                        {m.type === 'deposit' ? 'Вклад' : 'Снятие'}
                      </b>
                      <small>
                        {fmtDateTime(m.createdAtIso)}
                        {m.note ? ` · ${m.note}` : ''}
                        {m.posId ? ` · ${posLabel(m.posId)}` : ''}
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

      {tab === 'expenses' && (
        <button
          type="button"
          className="k-fin-fab k-fin-fab-exp"
          disabled={!canEditOffline}
          title={canEditOffline ? 'Новый расход' : OFFLINE_BLOCK_MESSAGE}
          aria-label="Новый расход"
          onClick={() => { setMsg(''); setExpOpen(true) }}
        >
          −
        </button>
      )}

      {tab === 'deposits' && (
        <div className="k-fin-fab-stack">
          <button
            type="button"
            className="k-fin-fab k-fin-fab-wd"
            disabled={!canEditOffline}
            title={canEditOffline ? 'Снятие' : OFFLINE_BLOCK_MESSAGE}
            aria-label="Снятие из кассы"
            onClick={() => { setMsg(''); setDepType('withdraw'); setDepOpen(true) }}
          >
            −
          </button>
          <button
            type="button"
            className="k-fin-fab k-fin-fab-dep"
            disabled={!canEditOffline}
            title={canEditOffline ? 'Вклад' : OFFLINE_BLOCK_MESSAGE}
            aria-label="Вклад в кассу"
            onClick={() => { setMsg(''); setDepType('deposit'); setDepOpen(true) }}
          >
            +
          </button>
        </div>
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
              {openShifts.length > 1 && (
                <div className="k-field">
                  <label>Смена / касса</label>
                  <select
                    className="k-sel"
                    value={depShiftId || openShifts[0]?.id || ''}
                    onChange={e => setDepShiftId(e.target.value)}
                  >
                    {openShifts.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.cashierName || 'Кассир'} · {posLabel(s.posId)} · {fmtMoney(shiftExpectedCashLocal(s))} в кассе
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {openShifts.length === 1 && (
                <div className="k-field">
                  <label>Касса</label>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {openShifts[0].cashierName || 'Кассир'} · {posLabel(openShifts[0].posId)} · в кассе {fmtMoney(shiftExpectedCashLocal(openShifts[0]))}
                  </div>
                </div>
              )}
              {openShifts.length === 0 && (
                <div className="k-alert" style={{ marginBottom: 12, background: '#2a1420', color: '#FF8A8A' }}>
                  Нет открытой смены — откройте смену на кассе
                </div>
              )}
              <div className="k-field">
                <label>Сумма</label>
                <input className="k-inp" value={depAmount} onChange={e => setDepAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus />
              </div>
              <div className="k-field">
                <label>Заметка</label>
                <input className="k-inp" value={depNote} onChange={e => setDepNote(e.target.value)} placeholder="Откуда / зачем…" />
              </div>
              {msg && <div className="k-alert" style={{ marginBottom: 12, background: '#2a1420', color: '#FF8A8A' }}>{msg}</div>}
              <button type="button" className="k-btn k-btn-g" style={{ width: '100%' }} disabled={busy || openShifts.length === 0} onClick={() => void submitDeposit()}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {convOpen && (
        <div className="k-modal-bg" onClick={() => !busy && setConvOpen(false)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>{convDir === 'card_to_cash' ? 'Карта → нал' : 'Нал → карта'}</b>
              <button type="button" onClick={() => setConvOpen(false)}>×</button>
            </div>
            <div className="k-modal-b k-fin-conv-body">
              <div className="k-field">
                <label>{convDir === 'card_to_cash' ? 'С карты доступно' : 'Наличных доступно'}</label>
                <div style={{ fontSize: 15, fontWeight: 800 }}>
                  {fmtMoney(convDir === 'card_to_cash' ? (cashBox?.totalCard ?? 0) : (cashBox?.totalCash ?? 0))}
                </div>
              </div>
              <div className="k-field">
                <label>Сумма</label>
                <input
                  className="k-inp"
                  value={convAmount}
                  onChange={e => setConvAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
              <div className="k-field">
                <label>Заметка</label>
                <input
                  className="k-inp"
                  value={convNote}
                  onChange={e => setConvNote(e.target.value)}
                  placeholder={convDir === 'card_to_cash' ? 'Сняли с терминала…' : 'Положили на карту…'}
                />
              </div>
              {msg && <div className="k-alert" style={{ marginBottom: 12, background: '#2a1420', color: '#FF8A8A' }}>{msg}</div>}
              <button
                type="button"
                className="k-btn k-btn-g"
                style={{ width: '100%' }}
                disabled={busy || (convDir === 'card_to_cash' ? (cashBox?.totalCard ?? 0) : (cashBox?.totalCash ?? 0)) < 0.01}
                onClick={() => void submitConvert()}
              >
                {busy ? 'Сохраняем…' : convDir === 'card_to_cash' ? 'Перевести в нал' : 'Перевести на карту'}
              </button>
            </div>
          </div>
        </div>
      )}

      {delMoveId && (
        <div className="k-modal-bg" onClick={() => setDelMoveId(null)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>Удалить вклад?</b>
              <button type="button" onClick={() => setDelMoveId(null)}>×</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <p style={{ margin: '0 0 14px', color: 'var(--muted)' }}>Запись уйдёт из кассы. Если уже на сервере — удалится и там.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="k-btn" style={{ flex: 1 }} onClick={() => setDelMoveId(null)}>Отмена</button>
                <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} onClick={() => void confirmRemoveMove()}>Удалить</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {delExpId && (
        <div className="k-modal-bg" onClick={() => setDelExpId(null)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>Удалить расход?</b>
              <button type="button" onClick={() => setDelExpId(null)}>×</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <p style={{ margin: '0 0 14px', color: 'var(--muted)' }}>Расход исчезнет из списка и из кассы смены.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="k-btn" style={{ flex: 1 }} onClick={() => setDelExpId(null)}>Отмена</button>
                <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} onClick={() => void confirmRemoveExpense()}>Удалить</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
