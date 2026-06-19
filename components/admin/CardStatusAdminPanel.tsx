'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  loadLoyaltyStatusConfig,
  saveLoyaltyStatusConfig,
  resetLoyaltyStatusConfig,
  subscribeLoyaltyStatusConfig,
  type LoyaltyStatusConfig,
  type LoyaltyTierConfig,
  type LoyaltyTierId,
} from '@/lib/loyaltyStatusConfig'
import { refreshLoyaltyTiersFromConfig } from '@/lib/clientLoyalty'
import type { ClientLevel } from '@/lib/clientCrm'
import type { AdminCard } from '@/lib/cardCrm'
import { mergeCardsWithClients, cardMatchesSearch } from '@/lib/cardCrm'
import { saveCardLoyalty, cardLoyaltyFromCard } from '@/lib/clientCardSync'
import { useCards } from '@/lib/cardStore'
import { useClients } from '@/lib/clientStore'

const Tog = ({ on, set }: { on: boolean; set: () => void }) => (
  <div onClick={set} style={{ width: 44, height: 24, borderRadius: 12, background: on ? '#1FD760' : '#1D3822', position: 'relative', cursor: 'pointer', transition: 'background .2s', flexShrink: 0 }}>
    <div style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left .2s' }} />
  </div>
)

const NI = ({ lbl, val, set, ph = '', type = 'text' }: { lbl: string; val: string; set: (v: string) => void; ph?: string; type?: string }) => (
  <div>
    <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>{lbl}</div>
    <input className="ai" type={type} value={val} onChange={e => set(e.target.value)} placeholder={ph} />
  </div>
)

function TierPreviewCard({ tier }: { tier: LoyaltyTierConfig }) {
  return (
    <div style={{
      borderRadius: 16, overflow: 'hidden', position: 'relative',
      background: tier.bgGradient, border: `1.5px solid ${tier.border}`,
      boxShadow: `0 8px 28px ${tier.glow}`,
      minHeight: 120,
    }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 80, height: 80, borderRadius: '50%', background: `${tier.color}22` }} />
      <div style={{ padding: '14px 16px', position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 10, color: tier.color, fontWeight: 800, letterSpacing: 1.5, marginBottom: 8, opacity: .85 }}>КАКАПО</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>{tier.emoji}</span>
          <span className="ub" style={{ fontSize: 15, fontWeight: 900, color: tier.accent }}>{tier.label}</span>
        </div>
        <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 4 }}>Кэшбэк: <span style={{ color: tier.color, fontWeight: 700 }}>{tier.cashback}</span></div>
        <div style={{ fontSize: 10, color: '#3D6645', lineHeight: 1.4 }}>{tier.perk}</div>
        {tier.id !== 'basic' && tier.id !== 'vip' && (
          <div style={{ fontSize: 10, color: '#3D6645', marginTop: 6 }}>от {tier.minSpent.toLocaleString()} ЅМ</div>
        )}
      </div>
      <div style={{ height: 3, background: tier.rail }} />
    </div>
  )
}

function TierEditor({
  tier,
  onChange,
}: {
  tier: LoyaltyTierConfig
  onChange: (patch: Partial<LoyaltyTierConfig>) => void
}) {
  const showMinSpent = tier.id !== 'basic' && tier.id !== 'vip'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
      <NI lbl="Название" val={tier.label} set={v => onChange({ label: v })} />
      <NI lbl="Эмодзи" val={tier.emoji} set={v => onChange({ emoji: v })} />
      {showMinSpent && <NI lbl="Мин. траты ЅМ" val={String(tier.minSpent)} set={v => onChange({ minSpent: Math.max(0, parseFloat(v) || 0) })} type="number" />}
      <NI lbl="Цвет" val={tier.color} set={v => onChange({ color: v, accent: v })} ph="#CD7F32" />
      <NI lbl="Кэшбэк" val={tier.cashback} set={v => onChange({ cashback: v })} ph="2%" />
      <NI lbl="Привилегия" val={tier.perk} set={v => onChange({ perk: v })} />
      <NI lbl="Рамка (CSS)" val={tier.border} set={v => onChange({ border: v })} />
      <NI lbl="Свечение (CSS)" val={tier.glow} set={v => onChange({ glow: v })} />
      <div style={{ gridColumn: '1 / -1' }}>
        <NI lbl="Фон (gradient)" val={tier.bgGradient} set={v => onChange({ bgGradient: v })} />
      </div>
    </div>
  )
}

type AssignRow = {
  card: AdminCard
  level: ClientLevel
  vip: boolean
  debtEnabled: boolean
  saving: boolean
  saved: boolean
  err: string
}

export default function CardStatusAdminPanel() {
  const stored = useCards()
  const clients = useClients()
  const cards = useMemo(() => mergeCardsWithClients(stored, clients), [stored, clients])

  const [draft, setDraft] = useState<LoyaltyStatusConfig>(() => loadLoyaltyStatusConfig())
  const [selectedTier, setSelectedTier] = useState<LoyaltyTierId>('basic')
  const [saved, setSaved] = useState(false)
  const [configErr, setConfigErr] = useState('')
  const [search, setSearch] = useState('')
  const [assignRows, setAssignRows] = useState<Record<string, AssignRow>>({})

  useEffect(() => subscribeLoyaltyStatusConfig(cfg => setDraft(cfg)), [])

  const activeCards = useMemo(
    () => cards.filter(c => c.status === 'active' && (c.client || c.clientId)),
    [cards],
  )

  const filteredCards = useMemo(
    () => activeCards.filter(c => cardMatchesSearch(c, search)),
    [activeCards, search],
  )

  const allTiers = useMemo(() => [draft.basic, ...draft.tiers, draft.vip], [draft])
  const editingTier = allTiers.find(t => t.id === selectedTier) || draft.basic

  const patchTier = (id: LoyaltyTierId, patch: Partial<LoyaltyTierConfig>) => {
    setDraft(prev => {
      if (id === 'basic') return { ...prev, basic: { ...prev.basic, ...patch, id: 'basic' } }
      if (id === 'vip') return { ...prev, vip: { ...prev.vip, ...patch, id: 'vip' } }
      return {
        ...prev,
        tiers: prev.tiers.map(t => (t.id === id ? { ...t, ...patch, id: t.id } : t)),
      }
    })
    setSaved(false)
  }

  const saveConfig = () => {
    try {
      saveLoyaltyStatusConfig(draft)
      refreshLoyaltyTiersFromConfig()
      setSaved(true)
      setConfigErr('')
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setConfigErr(e instanceof Error ? e.message : 'Ошибка сохранения')
    }
  }

  const resetConfig = () => {
    if (!confirm('Сбросить все настройки статусов к значениям по умолчанию?')) return
    const d = resetLoyaltyStatusConfig()
    setDraft(d)
    refreshLoyaltyTiersFromConfig()
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const getRow = (card: AdminCard): AssignRow => {
    const key = card.num
    const pending = assignRows[key]
    if (pending && (pending.saving || pending.err || pending.saved)) return pending
    const client = card.clientId ? clients.find(c => c.id === card.clientId) : undefined
    const form = cardLoyaltyFromCard(card, client)
    return {
      card,
      level: form.level,
      vip: form.vip,
      debtEnabled: form.debtEnabled,
      saving: false,
      saved: false,
      err: '',
    }
  }

  const applyStatus = async (num: string, patch: Partial<Pick<AssignRow, 'level' | 'vip' | 'debtEnabled'>>) => {
    const card = activeCards.find(c => c.num === num)
    if (!card) return
    const client = card.clientId ? clients.find(c => c.id === card.clientId) : undefined
    const prev = assignRows[num] || getRow(card)
    const next: AssignRow = { ...prev, ...patch, saving: true, saved: false, err: '' }
    setAssignRows(p => ({ ...p, [num]: next }))
    try {
      const base = cardLoyaltyFromCard(card, client)
      await saveCardLoyalty(card, {
        ...base,
        level: next.level,
        vip: next.vip,
        debtEnabled: next.debtEnabled,
      }, 'edit')
      setAssignRows(p => ({ ...p, [num]: { ...next, saving: false, saved: true, err: '' } }))
      window.setTimeout(() => {
        setAssignRows(p => {
          const row = p[num]
          if (!row?.saved) return p
          return { ...p, [num]: { ...row, saved: false } }
        })
      }, 2000)
    } catch (e) {
      setAssignRows(p => ({
        ...p,
        [num]: {
          ...prev,
          saving: false,
          saved: false,
          err: e instanceof Error ? e.message : 'Ошибка сохранения',
        },
      }))
    }
  }

  const levelOptions = [draft.basic, ...draft.tiers]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Программа и правила */}
      <div className="ac" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="ub" style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>⚙️ Программа лояльности</div>
            <div style={{ fontSize: 12, color: '#8FB897', lineHeight: 1.5 }}>
              Пороги, правила VIP и оформление. Статус и привилегии действуют один календарный месяц и сбрасываются 1-го числа.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={resetConfig} className="ab" style={{ padding: '8px 14px', fontSize: 11, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}>
              Сбросить
            </button>
            <button type="button" onClick={saveConfig} className="ab abp" style={{ padding: '8px 18px', fontSize: 12, fontWeight: 800 }}>
              {saved ? '✓ Сохранено' : 'Сохранить программу'}
            </button>
          </div>
        </div>

        {configErr && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', marginBottom: 14 }}>
            ⚠ {configErr}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          <NI lbl="Порог Бронзы ЅМ" val={String(draft.bronzeMinSpent)} set={v => { setDraft(p => ({ ...p, bronzeMinSpent: Math.max(0, parseFloat(v) || 0) })); setSaved(false) }} type="number" />
          <NI lbl="VIP: мин. заказов" val={String(draft.vipRules.minOrders)} set={v => { setDraft(p => ({ ...p, vipRules: { ...p.vipRules, minOrders: Math.max(0, parseInt(v, 10) || 0) } })); setSaved(false) }} type="number" />
          <NI lbl="VIP: мин. отзывов" val={String(draft.vipRules.minReviews)} set={v => { setDraft(p => ({ ...p, vipRules: { ...p.vipRules, minReviews: Math.max(0, parseInt(v, 10) || 0) } })); setSaved(false) }} type="number" />
          <NI lbl="VIP: мин. траты ЅМ" val={String(draft.vipRules.minSpent)} set={v => { setDraft(p => ({ ...p, vipRules: { ...p.vipRules, minSpent: Math.max(0, parseFloat(v) || 0) } })); setSaved(false) }} type="number" />
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>Уровни — нажмите для редактирования</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
          {allTiers.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTier(t.id)}
              className="ab"
              style={{
                padding: 0, overflow: 'hidden', textAlign: 'left',
                border: selectedTier === t.id ? `2px solid ${t.color}` : '1px solid #162B1A',
                borderRadius: 16, background: 'transparent',
              }}
            >
              <TierPreviewCard tier={t} />
            </button>
          ))}
        </div>

        <div style={{ background: '#0A140C', border: '1px solid #162B1A', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1FD760', marginBottom: 12 }}>
            Редактирование: {editingTier.emoji} {editingTier.label}
          </div>
          <TierEditor tier={editingTier} onChange={patch => patchTier(selectedTier, patch)} />
        </div>
      </div>

      {/* Назначение клиентам */}
      <div className="ac">
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #162B1A' }}>
          <div className="ub" style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>👥 Статусы клиентов</div>
          <div style={{ fontSize: 12, color: '#8FB897', marginBottom: 12 }}>
            Уровень, VIP и раздел долга сохраняются автоматически. Бонусы и сумма долга — в карточке карты или «Долги VIP».
          </div>
          <div style={{ position: 'relative', maxWidth: 360 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5 }}>🔍</span>
            <input
              className="ai"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по карте, имени, телефону…"
              style={{ paddingLeft: 38 }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="at">
            <thead>
              <tr>
                <th>Клиент / карта</th>
                <th>Уровень</th>
                <th>VIP</th>
                <th>Раздел долга</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredCards.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 28, color: '#3D6645' }}>
                    Нет активных карт с клиентами
                  </td>
                </tr>
              ) : filteredCards.map(card => {
                const row = getRow(card)
                const st = assignRows[card.num] || row
                return (
                  <tr key={card.num}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{card.client || '—'}</div>
                      <div style={{ fontSize: 11, color: '#FFB800', marginTop: 2 }}>{card.num}</div>
                      <div style={{ fontSize: 10, color: '#3D6645' }}>{card.phone || '—'}</div>
                    </td>
                    <td>
                      <select
                        className="ai"
                        value={st.level}
                        onChange={e => applyStatus(card.num, { level: e.target.value as ClientLevel })}
                        disabled={st.saving}
                        style={{ fontSize: 12, padding: '6px 8px', minWidth: 130 }}
                      >
                        {levelOptions.map(o => (
                          <option key={o.id} value={o.id}>{o.emoji} {o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Tog on={st.vip} set={() => !st.saving && applyStatus(card.num, { vip: !st.vip })} />
                    </td>
                    <td>
                      <Tog on={st.debtEnabled} set={() => !st.saving && applyStatus(card.num, { debtEnabled: !st.debtEnabled })} />
                    </td>
                    <td style={{ fontSize: 11, fontWeight: 700, minWidth: 72 }}>
                      {st.saving ? <span style={{ color: '#FFB800' }}>Сохраняем…</span>
                        : st.saved ? <span style={{ color: '#1FD760' }}>✓ Сохранено</span>
                          : st.err ? <span style={{ color: '#FF4545' }}>{st.err}</span>
                            : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
