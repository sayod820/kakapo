'use client'

import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
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
import type { ClientLevel, AdminClient } from '@/lib/clientCrm'
import type { AdminCard } from '@/lib/cardCrm'
import { mergeCardsWithClients, cardMatchesSearch, cardNumsMatch } from '@/lib/cardCrm'
import { saveCardLoyalty, cardLoyaltyFromCard, syncCardDebtLimitsFromLoyaltyConfig } from '@/lib/clientCardSync'
import { formatAdminLevelExpiry, formatAdminVipExpiry, inferVipTermDays, VIP_PERMANENT_DAYS, vipUntilForTermDays, type LevelAssignMode, inferLevelDuration, addDurationToNow, isoToDatetimeLocal, datetimeLocalToIso } from '@/lib/loyaltyAdminLock'
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

type RowDraft = {
  level: ClientLevel
  levelAssignMode: LevelAssignMode
  levelPermanent: boolean
  levelDays: number
  levelHours: number
  levelMinutes: number
  levelCalendar: string
  vip: boolean
  debtEnabled: boolean
  vipDays: number
}

type AssignRow = RowDraft & {
  card: AdminCard
  saving: boolean
  saved: boolean
  err: string
}

const VIP_TERM_OPTIONS = [
  { days: VIP_PERMANENT_DAYS, label: 'Постоянно' },
  { days: 0, label: 'До конца месяца' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
]

function durationFromCalendar(calendar: string): Pick<RowDraft, 'levelDays' | 'levelHours' | 'levelMinutes'> {
  const iso = datetimeLocalToIso(calendar)
  if (!iso) return { levelDays: 0, levelHours: 0, levelMinutes: 0 }
  const parts = inferLevelDuration('auto', 'bronze', iso)
  return { levelDays: parts.days, levelHours: parts.hours, levelMinutes: parts.minutes }
}

function calendarFromDuration(days: number, hours: number, minutes: number): string {
  return isoToDatetimeLocal(addDurationToNow(days, hours, minutes))
}

function resolveUntilFromDraft(draft: RowDraft): { levelValidUntil?: string | null; levelPermanent?: boolean } {
  if (draft.levelPermanent) return { levelPermanent: true, levelValidUntil: null }
  if (draft.levelCalendar) {
    return { levelValidUntil: datetimeLocalToIso(draft.levelCalendar), levelPermanent: false }
  }
  if (draft.levelDays || draft.levelHours || draft.levelMinutes) {
    return {
      levelValidUntil: addDurationToNow(draft.levelDays, draft.levelHours, draft.levelMinutes),
      levelPermanent: false,
    }
  }
  return { levelPermanent: false, levelValidUntil: undefined }
}

function draftFromCard(card: AdminCard, client?: AdminClient, meta?: Partial<RowDraft>): RowDraft {
  const form = cardLoyaltyFromCard(card, client)
  const levelValidUntil = card.levelValidUntil || client?.levelValidUntil
  const duration = inferLevelDuration(
    form.levelAssignMode ?? 'auto',
    form.level,
    levelValidUntil,
    card.levelLockedPeriod || client?.levelLockedPeriod,
  )
  const calendar = levelValidUntil ? isoToDatetimeLocal(levelValidUntil) : ''
  return {
    level: meta?.level ?? form.level,
    levelAssignMode: meta?.levelAssignMode ?? form.levelAssignMode ?? 'auto',
    levelPermanent: meta?.levelPermanent ?? duration.permanent,
    levelDays: meta?.levelDays ?? duration.days,
    levelHours: meta?.levelHours ?? duration.hours,
    levelMinutes: meta?.levelMinutes ?? duration.minutes,
    levelCalendar: meta?.levelCalendar ?? calendar,
    vip: meta?.vip ?? form.vip,
    debtEnabled: meta?.debtEnabled ?? form.debtEnabled,
    vipDays: meta?.vipDays ?? inferVipTermDays(form.vip, card.vipUntil || client?.vipUntil),
  }
}

function ModeBtn({
  active,
  label,
  color,
  onClick,
  disabled,
}: {
  active: boolean
  label: string
  color: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ab"
      style={{
        padding: '7px 12px',
        fontSize: 11,
        fontWeight: 800,
        borderRadius: 10,
        border: active ? `1.5px solid ${color}` : '1px solid #162B1A',
        background: active ? `${color}18` : '#0A140C',
        color: active ? color : '#8FB897',
        cursor: disabled ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function LevelDurationPicker({
  permanent,
  days,
  hours,
  minutes,
  calendar,
  disabled,
  onPermanent,
  onDays,
  onHours,
  onMinutes,
  onCalendar,
}: {
  permanent: boolean
  days: number
  hours: number
  minutes: number
  calendar: string
  disabled?: boolean
  onPermanent: (v: boolean) => void
  onDays: (v: number) => void
  onHours: (v: number) => void
  onMinutes: (v: number) => void
  onCalendar: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#8FB897', cursor: disabled ? 'default' : 'pointer' }}>
        <input
          type="checkbox"
          checked={permanent}
          disabled={disabled}
          onChange={e => onPermanent(e.target.checked)}
        />
        Постоянно (без срока)
      </label>
      {!permanent && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>
          <NI lbl="Дней" val={String(days)} set={v => onDays(Math.max(0, parseInt(v, 10) || 0))} type="number" />
          <NI lbl="Часов" val={String(hours)} set={v => onHours(Math.max(0, Math.min(23, parseInt(v, 10) || 0)))} type="number" />
          <NI lbl="Минут" val={String(minutes)} set={v => onMinutes(Math.max(0, Math.min(59, parseInt(v, 10) || 0)))} type="number" />
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Календарь</div>
            <input
              className="ai"
              type="datetime-local"
              value={calendar}
              disabled={disabled}
              onChange={e => onCalendar(e.target.value)}
              style={{ fontSize: 11, padding: '8px 10px' }}
            />
          </div>
        </div>
      )}
    </div>
  )
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
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [assignRows, setAssignRows] = useState<Record<string, {
    saving?: boolean
    saved?: boolean
    err?: string
  } & Partial<RowDraft>>>({})
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
    const meta = assignRows[card.num]
    const draft = draftFromCard(card, client, meta)
    return {
      card,
      ...draft,
      saving: !!meta?.saving,
      saved: !!meta?.saved,
      err: meta?.err || '',
    }
  }

  const patchLocal = (num: string, patch: Partial<RowDraft>) => {
    setAssignRows(p => {
      const card = activeCards.find(c => cardNumsMatch(c.num, num))
      if (!card) return p
      const client = card.clientId ? clients.find(c => c.id === card.clientId) : undefined
      const prev = draftFromCard(card, client, p[num])
      return { ...p, [num]: { ...p[num], ...prev, ...patch } }
    })
  }

  const openModePanel = (num: string, mode: LevelAssignMode) => {
    setExpandedCard(num)
    patchLocal(num, { levelAssignMode: mode })
  }

  const updateDuration = (num: string, patch: Partial<Pick<RowDraft, 'levelDays' | 'levelHours' | 'levelMinutes' | 'levelCalendar' | 'levelPermanent'>>) => {
    setAssignRows(p => {
      const card = activeCards.find(c => cardNumsMatch(c.num, num))
      if (!card) return p
      const client = card.clientId ? clients.find(c => c.id === card.clientId) : undefined
      const prev = draftFromCard(card, client, p[num])
      let next = { ...prev, ...patch }
      if (patch.levelDays !== undefined || patch.levelHours !== undefined || patch.levelMinutes !== undefined) {
        const cal = calendarFromDuration(next.levelDays, next.levelHours, next.levelMinutes)
        next = { ...next, levelCalendar: cal, levelPermanent: false }
      }
      if (patch.levelCalendar !== undefined && patch.levelCalendar) {
        const parts = durationFromCalendar(patch.levelCalendar)
        next = { ...next, ...parts, levelPermanent: false }
      }
      if (patch.levelPermanent) {
        next = { ...next, levelPermanent: true, levelCalendar: '', levelDays: 0, levelHours: 0, levelMinutes: 0 }
      }
      return { ...p, [num]: { ...p[num], ...next } }
    })
  }

  const saveRow = async (num: string) => {
    const card = activeCards.find(c => cardNumsMatch(c.num, num))
    if (!card) return
    const client = card.clientId ? clients.find(c => c.id === card.clientId) : undefined
    const draft = getRow(card)
    const untilFields = resolveUntilFromDraft(draft)
    setAssignRows(p => ({ ...p, [num]: { ...p[num], saving: true, saved: false, err: '' } }))
    try {
      const base = cardLoyaltyFromCard(card, client)
      await saveCardLoyalty(card, {
        ...base,
        level: draft.level,
        levelAssignMode: draft.levelAssignMode,
        ...untilFields,
        vip: draft.vip,
        debtEnabled: draft.debtEnabled,
        vipUntil: draft.vip ? vipUntilForTermDays(draft.vipDays) : undefined,
      }, 'edit')
      setAssignRows(p => ({ ...p, [num]: { ...p[num], saving: false, saved: true, err: '' } }))
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
          ...p[num],
          saving: false,
          saved: false,
          err: e instanceof Error ? e.message : 'Ошибка сохранения',
        },
      }))
    }
  }

  const applyVipOrDebt = async (
    num: string,
    patch: Partial<Pick<RowDraft, 'vip' | 'debtEnabled' | 'vipDays'>>,
  ) => {
    patchLocal(num, patch)
    const card = activeCards.find(c => cardNumsMatch(c.num, num))
    if (!card) return
    const draft = { ...getRow(card), ...patch }
    const untilFields = resolveUntilFromDraft(draft)
    setAssignRows(p => ({ ...p, [num]: { ...p[num], ...patch, saving: true, saved: false, err: '' } }))
    try {
      const client = card.clientId ? clients.find(c => c.id === card.clientId) : undefined
      const base = cardLoyaltyFromCard(card, client)
      await saveCardLoyalty(card, {
        ...base,
        level: draft.level,
        levelAssignMode: draft.levelAssignMode,
        ...untilFields,
        vip: draft.vip,
        debtEnabled: draft.debtEnabled,
        vipUntil: draft.vip ? vipUntilForTermDays(draft.vipDays) : undefined,
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
          ...p[num],
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 10 }}>
            <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(31,215,96,.06)', border: '1px solid rgba(31,215,96,.2)' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#1FD760', marginBottom: 4 }}>🔄 Автоматически</div>
              <div style={{ fontSize: 10, color: '#8FB897', lineHeight: 1.45 }}>Уровень растёт по заказам за месяц. Выберите срок — после него уровень пересчитается по тратам.</div>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,184,0,.06)', border: '1px solid rgba(255,184,0,.2)' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#FFB800', marginBottom: 4 }}>✋ Ручной</div>
              <div style={{ fontSize: 10, color: '#8FB897', lineHeight: 1.45 }}>Назначаете уровень сами. Закрепляется на выбранный срок, затем — по заработанному уровню.</div>
            </div>
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
                <th>Режим</th>
                <th>Текущий статус</th>
                <th>VIP</th>
                <th>Раздел долга</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredCards.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#3D6645' }}>
                    Нет активных карт с клиентами
                  </td>
                </tr>
              ) : filteredCards.map(card => {
                const st = getRow(card)
                const lockRecord = {
                  levelAssignMode: st.levelAssignMode,
                  levelValidUntil: card.levelValidUntil,
                  levelLockedPeriod: card.levelLockedPeriod,
                  level: st.level,
                }
                const levelExpiry = formatAdminLevelExpiry(lockRecord)
                const vipExpiry = formatAdminVipExpiry({ ...card, vip: st.vip })
                const isAuto = st.levelAssignMode === 'auto'
                const panelOpen = expandedCard === card.num
                return (
                  <Fragment key={card.num}>
                    <tr>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{card.client || '—'}</div>
                        <div style={{ fontSize: 11, color: '#FFB800', marginTop: 2 }}>{card.num}</div>
                        <div style={{ fontSize: 10, color: '#3D6645' }}>{card.phone || '—'}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <ModeBtn
                            active={isAuto}
                            label="🔄 Автоматически"
                            color="#1FD760"
                            disabled={st.saving}
                            onClick={() => openModePanel(card.num, 'auto')}
                          />
                          <ModeBtn
                            active={!isAuto}
                            label="✋ Ручной"
                            color="#FFB800"
                            disabled={st.saving}
                            onClick={() => openModePanel(card.num, 'manual')}
                          />
                        </div>
                      </td>
                      <td style={{ fontSize: 11, color: '#8FB897', lineHeight: 1.5, minWidth: 120 }}>
                        <div>{isAuto ? '📈 по заказам' : `${st.level}`}</div>
                        <div style={{ marginTop: 4, fontSize: 10 }}>{levelExpiry}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                          <Tog on={st.vip} set={() => !st.saving && applyVipOrDebt(card.num, { vip: !st.vip, vipDays: st.vip ? st.vipDays : VIP_PERMANENT_DAYS })} />
                          {st.vip && (
                            <>
                              <select
                                className="ai"
                                value={String(st.vipDays)}
                                onChange={e => applyVipOrDebt(card.num, { vip: true, vipDays: Number(e.target.value) })}
                                disabled={st.saving}
                                style={{ fontSize: 10, padding: '4px 6px', minWidth: 120 }}
                              >
                                {VIP_TERM_OPTIONS.map(o => (
                                  <option key={o.days} value={o.days}>{o.label}</option>
                                ))}
                              </select>
                              <div style={{ fontSize: 9, color: '#8FB897' }}>{vipExpiry}</div>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <Tog on={st.debtEnabled} set={() => !st.saving && applyVipOrDebt(card.num, { debtEnabled: !st.debtEnabled })} />
                      </td>
                      <td style={{ fontSize: 11, fontWeight: 700, minWidth: 72 }}>
                        {st.saving ? <span style={{ color: '#FFB800' }}>Сохраняем…</span>
                          : st.saved ? <span style={{ color: '#1FD760' }}>✓ Сохранено</span>
                            : st.err ? <span style={{ color: '#FF4545' }}>{st.err}</span>
                              : null}
                      </td>
                    </tr>
                    {panelOpen && (
                      <tr key={`${card.num}-panel`}>
                        <td colSpan={6} style={{ padding: '0 14px 14px', background: '#080F0A' }}>
                          <div style={{
                            borderRadius: 14,
                            border: `1px solid ${isAuto ? 'rgba(31,215,96,.25)' : 'rgba(255,184,0,.25)'}`,
                            background: isAuto ? 'rgba(31,215,96,.04)' : 'rgba(255,184,0,.04)',
                            padding: '14px 16px',
                          }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: isAuto ? '#1FD760' : '#FFB800', marginBottom: 10 }}>
                              {isAuto ? '🔄 Настройки: автоматически' : '✋ Настройки: ручной'}
                            </div>

                            {isAuto ? (
                              <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 12, lineHeight: 1.5 }}>
                                Уровень повышается по доставленным заказам за месяц. Укажите срок действия авто-режима.
                              </div>
                            ) : (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6, fontWeight: 700 }}>Уровень</div>
                                <select
                                  className="ai"
                                  value={st.level}
                                  onChange={e => patchLocal(card.num, { level: e.target.value as ClientLevel, levelAssignMode: 'manual' })}
                                  disabled={st.saving}
                                  style={{ fontSize: 12, padding: '6px 8px', minWidth: 160, maxWidth: 220 }}
                                >
                                  {levelOptions.map(o => (
                                    <option key={o.id} value={o.id}>{o.emoji} {o.label}</option>
                                  ))}
                                </select>
                                {st.level === 'basic' && (
                                  <div style={{ fontSize: 10, color: '#8FB897', marginTop: 6 }}>Базовый — без срока, постоянно</div>
                                )}
                              </div>
                            )}

                            {!( !isAuto && st.level === 'basic') && (
                              <div style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 8, fontWeight: 700 }}>Срок действия</div>
                                <LevelDurationPicker
                                  permanent={st.levelPermanent}
                                  days={st.levelDays}
                                  hours={st.levelHours}
                                  minutes={st.levelMinutes}
                                  calendar={st.levelCalendar}
                                  disabled={st.saving}
                                  onPermanent={v => updateDuration(card.num, { levelPermanent: v })}
                                  onDays={v => updateDuration(card.num, { levelDays: v })}
                                  onHours={v => updateDuration(card.num, { levelHours: v })}
                                  onMinutes={v => updateDuration(card.num, { levelMinutes: v })}
                                  onCalendar={v => updateDuration(card.num, { levelCalendar: v })}
                                />
                              </div>
                            )}

                            <button
                              type="button"
                              className="ab abp"
                              disabled={st.saving}
                              onClick={() => saveRow(card.num)}
                              style={{ padding: '8px 18px', fontSize: 12, fontWeight: 800 }}
                            >
                              {st.saving ? 'Сохраняем…' : 'Сохранить настройки'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
