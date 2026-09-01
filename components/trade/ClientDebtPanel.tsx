'use client'

import type { ReactNode } from 'react'
import { CLIENT_LEVEL_COLORS, type ClientLevel } from '@/lib/clientCrm'
import { CARD_STATUS_LABELS, type AdminCard } from '@/lib/cardCrm'
import type {
  ClientDebtCashView,
  ClientDebtCreditSale,
  ClientDebtPanelData,
  ClientDebtPayGroup,
} from '@/lib/buildClientDebtPanel'
import { fmtMoney } from './warehouse/warehouseShared'
import { CLIENT_DEBT_PANEL_CSS } from './clientDebtPanelCss'

export type ClientDebtTab = 'pos' | 'pay' | 'cash' | 'history'

function fmtBonus(value: number) {
  const n = Number(value) || 0
  return n.toFixed(2)
}

function levelLabel(level: ClientLevel): string {
  const map: Record<string, string> = {
    basic: 'Базовый', bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина',
  }
  return map[level] || level
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

export default function ClientDebtPanel({
  name,
  phone,
  cardNum,
  card,
  level,
  debtCreditBlocked,
  overLimit,
  cardDebt,
  debtLimit,
  availableDebt,
  repaidTotal,
  bonus,
  panel,
  tab,
  onTabChange,
  histMsg,
  msgOk,
  onBack,
  onRepayAll,
  onIssueCash,
  onOpenSale,
  onRepayCash,
  onPayGroup,
  cashTabExtra,
}: {
  name: string
  phone?: string
  cardNum?: string
  card?: AdminCard
  level: ClientLevel
  debtCreditBlocked?: boolean
  overLimit?: boolean
  cardDebt: number
  debtLimit: number
  availableDebt: number
  repaidTotal: number
  bonus: number
  panel: ClientDebtPanelData
  tab: ClientDebtTab
  onTabChange: (t: ClientDebtTab) => void
  histMsg?: string
  msgOk?: boolean
  onBack?: () => void
  onRepayAll: () => void
  onIssueCash: () => void
  onOpenSale: (saleId: string) => void
  onRepayCash: (row: ClientDebtCashView) => void
  onPayGroup: (g: ClientDebtPayGroup) => void
  cashTabExtra?: ReactNode
}) {
  const cardSt = card ? CARD_STATUS_LABELS[card.status] : null

  function renderSale(s: ClientDebtCreditSale) {
    const statusLabel = s.status === 'paid' ? 'Погашен' : s.status === 'partial' ? 'Частично' : 'Должен'
    const statusColor = s.status === 'paid' ? 'var(--green)' : s.status === 'partial' ? 'var(--gold)' : 'var(--red)'
    const whenShort = s.when.replace(/,\s*/, ' · ').replace(/\.(\d{2}),/, '.$1')
    const noteText = String(s.note || '').trim()
    return (
      <button
        key={s.id}
        type="button"
        className="cashier-debt-check"
        onClick={() => onOpenSale(s.id)}
      >
        <span className="cashier-debt-check-id">
          <span className="cashier-debt-check-title">
            <b>{s.label}</b>
            <em>{whenShort}</em>
          </span>
          {noteText ? <em className="cashier-debt-check-note" title={noteText}>💬 {noteText}</em> : null}
        </span>
        <span className="cashier-debt-check-nums">
          <span title="Было"><i>было</i><b>{fmtMoney(s.debtAdded)}</b></span>
          <span title="Оплатил"><i>опл.</i><b style={{ color: 'var(--green)' }}>{fmtMoney(s.paid)}</b></span>
          <span title="Осталось"><i>ост.</i><b style={{ color: statusColor }}>{s.status === 'paid' ? '—' : fmtMoney(s.remain)}</b></span>
        </span>
        <span className="cashier-debt-check-st" style={{ color: statusColor }}>{statusLabel} ›</span>
      </button>
    )
  }

  return (
    <div className="client-debt-panel">
      <style>{CLIENT_DEBT_PANEL_CSS}</style>

      <div className="cashier-debts-head" style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flex: 1 }}>
          {onBack ? (
            <button type="button" className="k-btn k-btn-s" style={{ flexShrink: 0 }} onClick={onBack}>←</button>
          ) : null}
          <div className="cashier-debts-av">{initials(name)}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15 }}>{name}</b>
              {cardDebt > 0 ? (
                <span className="k-badge" style={{ background: 'var(--badge-debt-bg)', color: 'var(--gold)' }}>В долгу</span>
              ) : (
                <span className="k-badge" style={{ background: 'var(--badge-debt-ok)', color: 'var(--green)' }}>Без долга</span>
              )}
              {overLimit ? (
                <span className="k-badge" style={{ background: 'var(--badge-warn-bg)', color: 'var(--red)' }}>⚠ Лимит</span>
              ) : null}
              {debtCreditBlocked ? (
                <span className="k-badge" style={{ background: 'var(--badge-warn-bg)', color: 'var(--red)' }}>Долг закрыт</span>
              ) : null}
              <span className="k-badge" style={{
                fontSize: 10,
                background: `${CLIENT_LEVEL_COLORS[level] || 'var(--muted)'}22`,
                color: CLIENT_LEVEL_COLORS[level] || 'var(--muted)',
              }}>
                {levelLabel(level)}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
              {phone ? <span>{phone}</span> : <span>без телефона</span>}
              {cardNum ? (
                <span>
                  {' · '}{cardNum}
                  {cardSt ? <> · <span style={{ color: cardSt.c }}>{cardSt.l}</span></> : null}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '6px 8px 0', flexShrink: 0 }}>
        <div className="cashier-debts-hero">
          <div className="cashier-debts-hero-main">
            <div className="kl">Сейчас должен</div>
            <div className="kv" style={{ color: cardDebt > 0 ? 'var(--red)' : 'var(--green)' }}>
              {cardDebt > 0 ? fmtMoney(cardDebt) : '0.00'}
              <span className="cashier-debts-hero-cur"> сом</span>
            </div>
            <div className="kh">
              {debtLimit > 0
                ? `Можно ещё взять ${fmtMoney(availableDebt)} · лимит ${fmtMoney(debtLimit)}`
                : 'Лимит не задан'}
            </div>
          </div>
          <div className="cashier-debts-hero-side">
            <div>
              <span className="kl">Уже оплатил</span>
              <b style={{ color: 'var(--green)' }}>{fmtMoney(repaidTotal)}</b>
            </div>
            <div>
              <span className="kl">Бонусы</span>
              <b style={{ color: 'var(--gold)' }}>{fmtBonus(bonus)}</b>
            </div>
            <div>
              <span className="kl">Чеки к оплате</span>
              <b style={{ color: 'var(--blue)' }}>{panel.openChecks}</b>
            </div>
          </div>
        </div>

        {(panel.posRemain > 0.005 || panel.cashOnCard > 0.005) && (
          <div className="cashier-debts-split">
            <span>Из них по чекам <b style={{ color: 'var(--blue)' }}>{fmtMoney(panel.posRemain)}</b></span>
            {panel.cashOnCard > 0.005 && (
              <span>наличными <b style={{ color: 'var(--gold)' }}>{fmtMoney(panel.cashOnCard)}</b></span>
            )}
          </div>
        )}

        {histMsg ? (
          <div style={{
            marginBottom: 8, padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: msgOk ? 'rgba(20,178,79,.12)' : 'var(--alert-error-bg)',
            color: msgOk ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${msgOk ? 'rgba(20,178,79,.25)' : 'var(--alert-error-border)'}`,
          }}>
            {histMsg}
          </div>
        ) : null}

        <div className="cashier-debts-subtabs" role="tablist">
          {([
            ['pos', `Чеки (${panel.openChecks})`],
            ['pay', `Оплаты (${panel.payGroups.length})`],
            ['cash', `Нал. (${panel.openCash})`],
            ['history', 'Лента'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`cashier-debts-subtab ${tab === id ? 'on' : ''}`}
              onClick={() => onTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="cashier-debts-body">
        {tab === 'pos' && (() => {
          const openRows = panel.creditSales.filter(s => s.remain > 0.001)
          if (!openRows.length) return <div className="hist-empty">Нет чеков к оплате</div>
          return (
            <>
              <div className="cashier-debt-sec">Ещё должен · {fmtMoney(panel.posRemain)}</div>
              <div className="cashier-debt-checks">
                {openRows.map(renderSale)}
              </div>
            </>
          )
        })()}

        {tab === 'pay' && (
          <>
            <div className="cashier-debt-hint">
              Одна оплата — одна строка. Нажмите: какие чеки и нал. выдачи закрыты.
            </div>
            {!panel.payGroups.length ? (
              <div className="hist-empty">Пока нет оплат</div>
            ) : (
              <div className="cashier-debt-pays">
                {panel.payGroups.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    className="cashier-debt-pay"
                    onClick={() => onPayGroup(g)}
                  >
                    <span className="cashier-debt-pay-main">
                      <b>{g.isReturn ? 'Возврат' : 'Оплата'} {fmtMoney(g.amount)}</b>
                      <em>
                        {g.isReturn ? `по ${g.coverHint}` : g.coverHint}
                        {g.methodHint ? ` · ${g.methodHint}` : ''}
                        {!g.isReturn && (g.cashCount || 0) > 0 ? ' · внутри нал.' : ''}
                      </em>
                      <i>{g.when}</i>
                    </span>
                    <span className="cashier-debt-pay-amt">−{fmtMoney(g.amount)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'cash' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <div className="cashier-debt-hint" style={{ margin: 0 }}>
                Только незакрытые выдачи. Погашенные — во вкладке «Оплаты».
              </div>
              <button type="button" className="cashier-debts-subtab" onClick={onIssueCash}>+ Выдать</button>
            </div>
            {cashTabExtra}
            {(() => {
              const openRows = panel.cashView.filter(c => c.remain > 0.001)
              if (!openRows.length) return <div className="hist-empty">Нет наличных к оплате</div>
              const openCashSum = openRows.reduce((s, c) => s + c.remain, 0)
              return (
                <>
                  <div className="cashier-debt-sec">Ещё должен · {fmtMoney(openCashSum)}</div>
                  <div className="cashier-debt-checks">
                    {openRows.map(c => {
                    const statusLabel = c.status === 'partial' ? 'Частично' : 'Должен'
                    const statusColor = c.status === 'partial' ? 'var(--gold)' : 'var(--red)'
                    const whenShort = c.when.replace(/,\s*/, ' · ')
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className="cashier-debt-check"
                        onClick={() => onRepayCash(c)}
                      >
                        <span className="cashier-debt-check-id">
                          <span className="cashier-debt-check-title">
                            <b>{c.isResidual ? 'На карте' : c.label}</b>
                            <em>{whenShort}</em>
                          </span>
                        </span>
                        <span className="cashier-debt-check-nums">
                          <span title="Было"><i>было</i><b>{fmtMoney(c.debtAdded)}</b></span>
                          <span title="Оплатил"><i>опл.</i><b style={{ color: 'var(--green)' }}>{fmtMoney(c.paid)}</b></span>
                          <span title="Осталось"><i>ост.</i><b style={{ color: statusColor }}>{fmtMoney(c.remain)}</b></span>
                        </span>
                        <span className="cashier-debt-check-st" style={{ color: statusColor }}>{statusLabel} ›</span>
                      </button>
                    )
                  })}
                  </div>
                </>
              )
            })()}
          </>
        )}

        {tab === 'history' && (
          !panel.feed.length ? (
            <div className="hist-empty">Пока нет движений</div>
          ) : (
            <div className="cashier-debts-table-wrap">
              <div className="cashier-debt-hint">Подробная лента. Главная цифра долга — сверху «Сейчас должен».</div>
              <table className="cashier-debts-table">
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Описание</th>
                    <th style={{ textAlign: 'right' }}>Сумма</th>
                    <th style={{ textAlign: 'right' }}>Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.feed.map(row => {
                    const clickable = row.kind === 'pos' && row.saleId
                    return (
                      <tr
                        key={row.key}
                        onClick={() => clickable && onOpenSale(row.saleId!)}
                        style={{ cursor: clickable ? 'pointer' : undefined }}
                      >
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 11 }}>{row.when}</td>
                        <td style={{ fontSize: 12 }}>{row.desc}</td>
                        <td style={{
                          textAlign: 'right', fontWeight: 900, whiteSpace: 'nowrap',
                          color: row.amount < 0 ? 'var(--green)' : 'var(--gold)',
                        }}>
                          {row.amount < 0 ? '−' : '+'}{fmtMoney(Math.abs(row.amount))}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtMoney(row.balance)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <div className="cashier-debts-actions">
        <button
          type="button"
          className="k-btn k-btn-g"
          disabled={!(cardDebt > 0)}
          onClick={onRepayAll}
        >
          ✓ Погасить {cardDebt > 0 ? fmtMoney(cardDebt) : 'долг'}
        </button>
        <button type="button" className="k-btn k-btn-s" onClick={onIssueCash}>
          Выдать наличные
        </button>
      </div>
    </div>
  )
}
