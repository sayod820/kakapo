'use client'

import { useCallback, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { fmtDateTime, fmtMoney } from './warehouse/warehouseShared'
import {
  REPORT_PERIODS,
  filterByCreatedAt,
  inPeriod,
  isSaleFullyReturned,
  periodRange,
  round2,
  type ReportPeriod,
  ymdLocal,
} from './reportsHelpers'

const EXPENSE_CATS = ['Аренда', 'Зарплата', 'Коммунальные', 'Транспорт', 'Реклама', 'Хозтовары', 'Прочее']

type FinanceTab = 'money' | 'expenses' | 'deposits' | 'debts'

export default function FinanceModule() {
  const sales = usePosStore(s => s.sales)
  const shifts = usePosStore(s => s.shifts)
  const receipts = usePosStore(s => s.receipts)
  const expenses = usePosStore(s => s.expenses)
  const financeMoves = usePosStore(s => s.financeMoves)
  const suppliers = usePosStore(s => s.suppliers)
  const apiReady = usePosStore(s => s.apiReady)
  const apiError = usePosStore(s => s.apiError)
  const clients = useClientStore(s => s.clients)

  const [period, setPeriod] = useState<ReportPeriod>('30d')
  const [customFrom, setCustomFrom] = useState(ymdLocal(new Date(Date.now() - 6 * 864e5)))
  const [customTo, setCustomTo] = useState(ymdLocal())
  const [tab, setTab] = useState<FinanceTab>('money')
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

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

  const periodSales = useMemo(
    () => sales.filter(s => inPeriod(s.createdAtIso, from, to) && !isSaleFullyReturned(s)),
    [sales, from, to],
  )
  const periodExpenses = useMemo(() => filterByCreatedAt(expenses, from, to), [expenses, from, to])
  const periodReceipts = useMemo(() => filterByCreatedAt(receipts, from, to), [receipts, from, to])
  const periodMoves = useMemo(
    () => financeMoves.filter(m => inPeriod(m.createdAtIso, from, to)),
    [financeMoves, from, to],
  )

  const cashIn = useMemo(
    () => round2(periodSales.reduce((s, x) => s + (Number(x.paidCash) || 0), 0)),
    [periodSales],
  )
  const cardIn = useMemo(
    () => round2(periodSales.reduce((s, x) => s + (Number(x.paidCard) || 0), 0)),
    [periodSales],
  )
  const creditOut = useMemo(
    () => round2(periodSales.reduce((s, x) => s + (Number(x.debtAdded) || 0), 0)),
    [periodSales],
  )
  const revenue = useMemo(
    () => round2(periodSales.reduce((s, x) => s + (Number(x.total) || 0), 0)),
    [periodSales],
  )
  const expenseTotal = useMemo(
    () => round2(periodExpenses.reduce((s, x) => s + (Number(x.amount) || 0), 0)),
    [periodExpenses],
  )
  const paidPurchases = useMemo(
    () => round2(periodReceipts.reduce((s, x) => s + (Number(x.paidNow) || 0), 0)),
    [periodReceipts],
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

  /** Наличные в открытых кассах сейчас */
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

  const moneyInPeriod = useMemo(
    () => round2(cashIn + cardIn + deposits),
    [cashIn, cardIn, deposits],
  )
  const moneyOutPeriod = useMemo(
    () => round2(expenseTotal + paidPurchases + withdraws),
    [expenseTotal, paidPurchases, withdraws],
  )
  const netPeriod = useMemo(() => round2(moneyInPeriod - moneyOutPeriod), [moneyInPeriod, moneyOutPeriod])

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

  const capitalNet = useMemo(() => round2(depositsAll - withdrawsAll), [depositsAll, withdrawsAll])

  const movementRows = useMemo(() => {
    type Row = { id: string; at: string; kind: string; title: string; amount: number; sign: 1 | -1 }
    const rows: Row[] = []
    for (const s of periodSales) {
      const cash = Number(s.paidCash) || 0
      const card = Number(s.paidCard) || 0
      if (cash > 0) {
        rows.push({
          id: `sale-c-${s.id}`,
          at: s.createdAtIso,
          kind: 'Продажа',
          title: `Наличные · ${s.cashierName || 'касса'}`,
          amount: cash,
          sign: 1,
        })
      }
      if (card > 0) {
        rows.push({
          id: `sale-k-${s.id}`,
          at: s.createdAtIso,
          kind: 'Продажа',
          title: `Карта · ${s.cashierName || 'касса'}`,
          amount: card,
          sign: 1,
        })
      }
    }
    for (const e of periodExpenses) {
      rows.push({
        id: `exp-${e.id}`,
        at: e.createdAtIso,
        kind: 'Расход',
        title: e.category + (e.note ? ` · ${e.note}` : ''),
        amount: Number(e.amount) || 0,
        sign: -1,
      })
    }
    for (const r of periodReceipts) {
      const paid = Number(r.paidNow) || 0
      if (paid > 0) {
        rows.push({
          id: `rec-${r.id}`,
          at: r.createdAtIso,
          kind: 'Закупка',
          title: `Оплата поставщику · ${r.supplierName || '—'}`,
          amount: paid,
          sign: -1,
        })
      }
    }
    for (const m of periodMoves) {
      rows.push({
        id: `fin-${m.id}`,
        at: m.createdAtIso,
        kind: m.type === 'deposit' ? 'Вклад' : 'Снятие',
        title: m.note || (m.type === 'deposit' ? 'Вложение в магазин' : 'Снятие из кассы'),
        amount: Number(m.amount) || 0,
        sign: m.type === 'deposit' ? 1 : -1,
      })
    }
    return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, [periodSales, periodExpenses, periodReceipts, periodMoves])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([syncPosFromApi(), syncClientsFromApi()])
    } finally {
      setRefreshing(false)
    }
  }, [])

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

  if (!apiReady) {
    return (
      <div>
        <div className="k-page-h">
          <div>
            <h1>💰 Финансы</h1>
            <div className="sub">Деньги магазина</div>
          </div>
        </div>
        <div className="k-card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>
      </div>
    )
  }

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>💰 Финансы</h1>
          <div className="sub">Суммы в кассе, расходы, вклады и долги — без таблиц отчётов</div>
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

      {apiError && (
        <div className="k-alert" style={{ marginBottom: 14, background: '#2a1420', color: '#FF8A8A', border: '1px solid #5a2030' }}>
          {apiError}
        </div>
      )}

      <div className="k-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: period === 'custom' ? 12 : 0 }}>
          {REPORT_PERIODS.filter(p => p.id !== 'all' || true).map(p => (
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 420 }}>
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
      </div>

      <div className="k-subtabs">
        {([
          { id: 'money' as const, label: 'Деньги', icon: '💵' },
          { id: 'expenses' as const, label: 'Расходы', icon: '🧾' },
          { id: 'deposits' as const, label: 'Вклады', icon: '🏦' },
          { id: 'debts' as const, label: 'Долги', icon: '💳' },
        ]).map(t => (
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

      {tab === 'money' && (
        <>
          <div className="k-kpis" style={{ marginBottom: 16 }}>
            <div className="k-kpi k-statcard">
              <div className="kl">В кассах сейчас</div>
              <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(cashInTills)}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontWeight: 700 }}>
                {openTillCount ? `${openTillCount} открытых смен` : 'Нет открытых смен'}
              </div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Пришло за период</div>
              <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(moneyInPeriod)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Ушло за период</div>
              <div className="kv" style={{ color: 'var(--red)' }}>{fmtMoney(moneyOutPeriod)}</div>
            </div>
            <div className="k-kpi k-statcard">
              <div className="kl">Итог периода</div>
              <div className="kv" style={{ color: netPeriod >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(netPeriod)}</div>
            </div>
            <div className="k-kpi k-statcard"><div className="kl">Наличные с продаж</div><div className="kv">{fmtMoney(cashIn)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Карта</div><div className="kv">{fmtMoney(cardIn)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Выручка</div><div className="kv">{fmtMoney(revenue)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">В долг выдано</div><div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(creditOut)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Расходы</div><div className="kv">{fmtMoney(expenseTotal)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Оплаты закупа</div><div className="kv">{fmtMoney(paidPurchases)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Вклады</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(deposits)}</div></div>
            <div className="k-kpi k-statcard"><div className="kl">Снятия</div><div className="kv" style={{ color: 'var(--red)' }}>{fmtMoney(withdraws)}</div></div>
          </div>

          <div className="k-card" style={{ padding: 14, marginBottom: 14, fontSize: 13, color: 'var(--muted)', fontWeight: 700, lineHeight: 1.5 }}>
            <b style={{ color: 'var(--text)' }}>Как считаем</b>
            <div>«В кассах сейчас» = старт смены + нал с продаж − расходы смены (по открытым кассам).</div>
            <div>«Пришло» = нал + карта + вклады. «Ушло» = расходы + оплата закупа + снятия.</div>
            <div>Детальные чеки и товары — в разделе <b style={{ color: 'var(--text)' }}>Отчёты</b>.</div>
          </div>

          <div className="k-card" style={{ overflow: 'hidden' }}>
            <div className="k-card-h"><b>Движение денег</b></div>
            {!movementRows.length ? (
              <div className="k-empty">Нет движений за период</div>
            ) : (
              <div className="k-tbl-scroll">
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Тип</th>
                      <th>Описание</th>
                      <th>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementRows.slice(0, 150).map(r => (
                      <tr key={r.id}>
                        <td>{fmtDateTime(r.at)}</td>
                        <td>{r.kind}</td>
                        <td>{r.title}</td>
                        <td style={{ fontWeight: 900, color: r.sign > 0 ? 'var(--green)' : 'var(--red)' }}>
                          {r.sign > 0 ? '+' : '−'}{fmtMoney(r.amount)}
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
