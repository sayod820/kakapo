'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  loadLoyaltyStatusConfig,
  saveLoyaltyStatusConfig,
  resetLoyaltyStatusConfig,
  subscribeLoyaltyStatusConfig,
  syncLoyaltyStatusConfigFromApi,
  type LoyaltyStatusConfig,
  type LoyaltyTierConfig,
  type LoyaltyTierId,
} from '@/lib/loyaltyStatusConfig'
import { USE_API } from '@/lib/config'
import { refreshLoyaltyTiersFromConfig } from '@/lib/clientLoyalty'
import type { ClientLevel } from '@/lib/clientCrm'
import type { AdminCard } from '@/lib/cardCrm'
import { mergeCardsWithClients, cardMatchesSearch, cardNumsMatch } from '@/lib/cardCrm'
import { saveCardLoyalty, cardLoyaltyFromCard, syncCardDebtLimitsFromLoyaltyConfig } from '@/lib/clientCardSync'
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
        <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 4 }}>
          Кэшбэк: <span style={{ color: tier.color, fontWeight: 700 }}>{tier.bonusPercent > 0 ? `${tier.bonusPercent}%` : '—'}</span>
          {tier.defaultDebtLimit > 0 && (
            <span style={{ marginLeft: 8, color: '#3B8EF0' }}>· долг до {tier.defaultDebtLimit.toLocaleString()} ЅМ</span>
          )}
        </div>
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
  const showDebtLimit = tier.id === 'gold' || tier.id === 'platinum' || tier.id === 'vip'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
      <NI lbl="Название уровня" val={tier.label} set={v => onChange({ label: v })} />
      <NI
        lbl="Кэшбэк, %"
        val={String(tier.bonusPercent ?? 0)}
        set={v => onChange({ bonusPercent: Math.max(0, parseFloat(v) || 0) })}
        ph="2"
        type="number"
      />
      {showMinSpent && (
        <NI
          lbl="Мин. траты для уровня, ЅМ"
          val={String(tier.minSpent)}
          set={v => onChange({ minSpent: Math.max(0, parseFloat(v) || 0) })}
          type="number"
        />
      )}
      {showDebtLimit && (
        <NI
          lbl="Лимит VIP-долга, ЅМ"
          val={String(tier.defaultDebtLimit ?? 0)}
          set={v => onChange({ defaultDebtLimit: v === '' ? 0 : Math.max(0, Number(v) || 0) })}
          ph="0 — без долга"
          type="number"
        />
      )}
      <div style={{ gridColumn: '1 / -1' }}>
        <NI lbl="Привилегия (текст для клиента)" val={tier.perk} set={v => onChange({ perk: v })} ph="Бонусы за покупки" />
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
  const [showProgram, setShowProgram] = useState(false)
  const [assignRows, setAssignRows] = useState<Record<string, {
    saving?: boolean
    saved?: boolean
    err?: string
    level?: ClientLevel
    vip?: boolean
    debtEnabled?: boolean
  }>>({})
  const draftDirtyRef = useRef(false)

  useEffect(() => subscribeLoyaltyStatusConfig(cfg => {
    if (draftDirtyRef.current) return
    setDraft(cfg)
  }), [])

  useEffect(() => {
    if (!USE_API) return
    void syncLoyaltyStatusConfigFromApi().then(cfg => {
      refreshLoyaltyTiersFromConfig()
      if (!draftDirtyRef.current) setDraft(cfg)
    })
  }, [])

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
    draftDirtyRef.current = true
    setDraft(prev => {
      let next: LoyaltyStatusConfig
      if (id === 'basic') next = { ...prev, basic: { ...prev.basic, ...patch, id: 'basic' } }
      else if (id === 'vip') next = { ...prev, vip: { ...prev.vip, ...patch, id: 'vip' } }
      else {
        next = {
          ...prev,
          tiers: prev.tiers.map(t => (t.id === id ? { ...t, ...patch, id: t.id } : t)),
        }
      }
      if (id === 'bronze' && patch.minSpent != null) {
        next = { ...next, bronzeMinSpent: patch.minSpent }
      }
      return next
    })
    setSaved(false)
  }

  const saveConfig = async () => {
    try {
      const next = saveLoyaltyStatusConfig(draft)
      refreshLoyaltyTiersFromConfig()
      await syncCardDebtLimitsFromLoyaltyConfig(next)
      draftDirtyRef.current = false
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
    draftDirtyRef.current = false
    setDraft(d)
    refreshLoyaltyTiersFromConfig()
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const getRow = (card: AdminCard): AssignRow => {
    const client = card.clientId ? clients.find(c => c.id === card.clientId) : undefined
    const form = cardLoyaltyFromCard(card, client)
    const meta = assignRows[card.num]
    return {
      card,
      level: meta?.level ?? form.level,
      vip: meta?.vip ?? form.vip,
      debtEnabled: meta?.debtEnabled ?? form.debtEnabled,
      saving: !!meta?.saving,
      saved: !!meta?.saved,
      err: meta?.err || '',
    }
  }

  const applyStatus = async (num: string, patch: Partial<Pick<AssignRow, 'level' | 'vip' | 'debtEnabled'>>) => {
    const card = activeCards.find(c => cardNumsMatch(c.num, num))
    if (!card) return
    const client = card.clientId ? clients.find(c => c.id === card.clientId) : undefined
    const prev = getRow(card)
    const next: AssignRow = { ...prev, ...patch, saving: true, saved: false, err: '' }
    setAssignRows(p => ({ ...p, [num]: { ...p[num], ...patch, saving: true, saved: false, err: '' } }))
    try {
      const base = cardLoyaltyFromCard(card, client)
      await saveCardLoyalty(card, {
        ...base,
        level: next.level,
        vip: next.vip,
        debtEnabled: next.debtEnabled,
      }, 'edit')
      setAssignRows(p => ({ ...p, [num]: { saving: false, saved: true, err: '' } }))
      window.setTimeout(() => {
        setAssignRows(p => {
          const row = p[num]
          if (!row?.saved) return p
          const { [num]: _, ...rest } = p
          return rest
        })
      }, 2000)
    } catch (e) {
      setAssignRows(p => ({
        ...p,
        [num]: {
          saving: false,
          saved: false,
          err: e instanceof Error ? e.message : 'Ошибка сохранения',
        },
      }))
    }
  }

  const levelOptions = [draft.basic, ...draft.tiers]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Программа лояльности — свёрнута по умолчанию */}
      <div className="ac" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setShowProgram(v => !v)}
          className="ab"
          style={{
            width: '100%',
            padding: '14px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            textAlign: 'left',
          }}
        >
          <div>
            <div className="ub" style={{ fontSize: 14, fontWeight: 900 }}>⚙️ Программа лояльности</div>
            <div style={{ fontSize: 11, color: '#8FB897', marginTop: 3 }}>Бонусы, пороги уровней и условия VIP</div>
          </div>
          <span style={{ fontSize: 12, color: '#8FB897' }}>{showProgram ? '▲ Свернуть' : '▼ Настроить'}</span>
        </button>

        {showProgram && (
          <div style={{ padding: '0 18px 18px', borderTop: '1px solid #162B1A' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', margin: '14px 0' }}>
              <button type="button" onClick={resetConfig} className="ab" style={{ padding: '8px 14px', fontSize: 11, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}>
                Сбросить
              </button>
              <button type="button" onClick={saveConfig} className="ab abp" style={{ padding: '8px 18px', fontSize: 12, fontWeight: 800 }}>
                {saved ? '✓ Сохранено' : 'Сохранить программу'}
              </button>
            </div>

            {configErr && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', marginBottom: 14 }}>
                ⚠ {configErr}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              <NI lbl="Бонус при регистрации ⭐" val={String(draft.welcomeBonus)} set={v => { draftDirtyRef.current = true; setDraft(p => ({ ...p, welcomeBonus: Math.max(0, parseInt(v, 10) || 0) })); setSaved(false) }} type="number" />
              <NI lbl="Порог Бронзы, ЅМ" val={String(draft.bronzeMinSpent)} set={v => { draftDirtyRef.current = true; setDraft(p => ({ ...p, bronzeMinSpent: Math.max(0, parseFloat(v) || 0) })); setSaved(false) }} type="number" />
              <NI lbl="VIP: мин. заказов" val={String(draft.vipRules.minOrders)} set={v => { draftDirtyRef.current = true; setDraft(p => ({ ...p, vipRules: { ...p.vipRules, minOrders: Math.max(0, parseInt(v, 10) || 0) } })); setSaved(false) }} type="number" />
              <NI lbl="VIP: мин. отзывов" val={String(draft.vipRules.minReviews)} set={v => { draftDirtyRef.current = true; setDraft(p => ({ ...p, vipRules: { ...p.vipRules, minReviews: Math.max(0, parseInt(v, 10) || 0) } })); setSaved(false) }} type="number" />
              <NI lbl="VIP: мин. траты, ЅМ" val={String(draft.vipRules.minSpent)} set={v => { draftDirtyRef.current = true; setDraft(p => ({ ...p, vipRules: { ...p.vipRules, minSpent: Math.max(0, parseFloat(v) || 0) } })); setSaved(false) }} type="number" />
            </div>

            <div style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>Уровни</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
              {allTiers.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTier(t.id)}
                  className="ab"
                  style={{
                    padding: 0, overflow: 'hidden', textAlign: 'left',
                    border: selectedTier === t.id ? `2px solid ${t.color}` : '1px solid #162B1A',
                    borderRadius: 14, background: 'transparent',
                  }}
                >
                  <TierPreviewCard tier={t} />
                </button>
              ))}
            </div>

            <div style={{ background: '#0A140C', border: '1px solid #162B1A', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#1FD760', marginBottom: 10 }}>
                {editingTier.emoji} {editingTier.label}
              </div>
              {selectedTier === 'basic' && (
                <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(59,142,240,.08)', border: '1px solid rgba(59,142,240,.18)' }}>
                  При регистрации клиент получает <strong style={{ color: '#FFB800' }}>{draft.welcomeBonus} ⭐</strong> — настраивается выше в «Бонус при регистрации».
                </div>
              )}
              <TierEditor tier={editingTier} onChange={patch => patchTier(selectedTier, patch)} />
            </div>
          </div>
        )}
      </div>

      {/* Назначение клиентам */}
      <div className="ac">
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #162B1A' }}>
          <div className="ub" style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>👥 Статусы клиентов</div>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 10 }}>
            Уровень, VIP и раздел долга сохраняются сразу. Сумму долга меняйте в «Долги VIP».
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
                const st = getRow(card)
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
