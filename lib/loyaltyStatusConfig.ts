'use client'

import { USE_API } from './config'

import type { ClientLevel } from './clientCrm'

export type LoyaltyTierId = ClientLevel | 'vip'

export type LoyaltyTierConfig = {
  id: LoyaltyTierId
  label: string
  emoji: string
  minSpent: number
  /** Процент бонусов (кэшбэк) за покупки */
  bonusPercent: number
  /** Лимит VIP-долга по умолчанию для уровня, ЅМ (0 — нет) */
  defaultDebtLimit: number
  color: string
  cashback: string
  perk: string
  border: string
  glow: string
  accent: string
  topGlow: string
  bgGradient: string
  rail: string
}

export type LoyaltyStatusConfig = {
  basic: LoyaltyTierConfig
  tiers: LoyaltyTierConfig[]
  vip: LoyaltyTierConfig
  /** Бонусы при регистрации нового клиента */
  welcomeBonus: number
  vipRules: {
    minOrders: number
    minReviews: number
    minSpent: number
  }
  bronzeMinSpent: number
}

const STORAGE_KEY = 'kakapo-loyalty-status-config'
export const LOYALTY_STATUS_CONFIG_EVENT = 'kakapo-loyalty-status-config'

/** В API-режиме конфиг только в памяти — источник /settings/loyalty */
let memoryLoyaltyConfig: LoyaltyStatusConfig | null = null

export const DEFAULT_LOYALTY_STATUS_CONFIG: LoyaltyStatusConfig = {
  bronzeMinSpent: 500,
  welcomeBonus: 10,
  basic: {
    id: 'basic',
    label: 'Базовый',
    emoji: '👤',
    minSpent: 0,
    bonusPercent: 0,
    defaultDebtLimit: 0,
    color: '#8FB897',
    cashback: '—',
    perk: 'Привилегий пока нет',
    border: 'rgba(143,184,151,.24)',
    glow: 'rgba(143,184,151,.14)',
    accent: '#8FB897',
    topGlow: 'rgba(143,184,151,.07)',
    bgGradient: 'linear-gradient(145deg,#0a0e0b 0%,#060a07 40%,#0d120f 100%)',
    rail: 'linear-gradient(90deg,#3D6645,#8FB897)',
  },
  tiers: [
    {
      id: 'bronze',
      label: 'Бронза',
      emoji: '🥉',
      minSpent: 500,
      bonusPercent: 1,
      defaultDebtLimit: 0,
      color: '#CD7F32',
      cashback: '1%',
      perk: 'Бонусы за покупки',
      border: 'rgba(205,127,50,.42)',
      glow: 'rgba(205,127,50,.35)',
      accent: '#CD7F32',
      topGlow: 'rgba(205,127,50,.11)',
      bgGradient: 'linear-gradient(145deg,#1a1008 0%,#0d0804 40%,#2a1810 100%)',
      rail: 'linear-gradient(90deg,#8B5A2B,#CD7F32)',
    },
    {
      id: 'silver',
      label: 'Серебро',
      emoji: '🥈',
      minSpent: 1000,
      bonusPercent: 2,
      defaultDebtLimit: 0,
      color: '#C0C0C0',
      cashback: '2%',
      perk: 'Доп. скидки',
      border: 'rgba(192,192,192,.38)',
      glow: 'rgba(220,220,230,.28)',
      accent: '#D4D4DC',
      topGlow: 'rgba(220,220,230,.09)',
      bgGradient: 'linear-gradient(145deg,#141820 0%,#0a0d12 40%,#1e2430 100%)',
      rail: 'linear-gradient(90deg,#888,#E0E0E8)',
    },
    {
      id: 'gold',
      label: 'Золото',
      emoji: '🥇',
      minSpent: 2000,
      bonusPercent: 3,
      defaultDebtLimit: 2000,
      color: '#FFB800',
      cashback: '3%',
      perk: 'Приоритет сборки',
      border: 'rgba(255,184,0,.48)',
      glow: 'rgba(255,184,0,.38)',
      accent: '#FFB800',
      topGlow: 'rgba(255,184,0,.1)',
      bgGradient: 'linear-gradient(145deg,#1f1600 0%,#120d00 40%,#2e2200 100%)',
      rail: 'linear-gradient(90deg,#B8860B,#FFD700)',
    },
    {
      id: 'platinum',
      label: 'Platinum',
      emoji: '💎',
      minSpent: 3000,
      bonusPercent: 5,
      defaultDebtLimit: 2000,
      color: '#3B8EF0',
      cashback: '5%',
      perk: 'Кредитный лимит',
      border: 'rgba(59,142,240,.48)',
      glow: 'rgba(59,142,240,.38)',
      accent: '#3B8EF0',
      topGlow: 'rgba(59,142,240,.1)',
      bgGradient: 'linear-gradient(145deg,#0a1428 0%,#060e1a 40%,#0f2040 100%)',
      rail: 'linear-gradient(90deg,#2563EB,#60A5FA)',
    },
  ],
  vip: {
    id: 'vip',
    label: 'VIP Elite',
    emoji: '👑',
    minSpent: 3000,
    bonusPercent: 5,
    defaultDebtLimit: 5000,
    color: '#FFD700',
    cashback: '5%',
    perk: 'Все привилегии',
    border: 'rgba(255,184,0,.65)',
    glow: 'rgba(255,184,0,.55)',
    accent: '#FFD700',
    topGlow: 'rgba(255,184,0,.12)',
    bgGradient: 'linear-gradient(145deg,#1a1000 0%,#0a0600 30%,#2a1a00 70%,#1a1000 100%)',
    rail: 'linear-gradient(90deg,#E89E00,#FFE566,#E89E00)',
  },
  vipRules: {
    minOrders: 30,
    minReviews: 5,
    minSpent: 3000,
  },
}

function parseBonusPercent(cashback: string | undefined, fallback = 0): number {
  const m = String(cashback || '').match(/([\d.]+)/)
  return m ? Math.max(0, parseFloat(m[1]) || 0) : fallback
}

function cashbackLabel(percent: number): string {
  return percent > 0 ? `${percent}%` : '—'
}

function mergeTier(base: LoyaltyTierConfig, patch?: Partial<LoyaltyTierConfig>): LoyaltyTierConfig {
  if (!patch) return base
  const merged = { ...base, ...patch, id: base.id }
  const bonusPercent = patch.bonusPercent != null
    ? Math.max(0, Number(patch.bonusPercent) || 0)
    : (merged.bonusPercent != null ? merged.bonusPercent : parseBonusPercent(merged.cashback, base.bonusPercent))
  merged.bonusPercent = bonusPercent
  merged.cashback = patch.cashback != null && patch.bonusPercent == null
    ? merged.cashback
    : cashbackLabel(bonusPercent)
  merged.defaultDebtLimit = Math.max(0, Number(merged.defaultDebtLimit) || 0)
  return merged
}

function normalizeConfig(raw: Partial<LoyaltyStatusConfig> | null | undefined): LoyaltyStatusConfig {
  const d = DEFAULT_LOYALTY_STATUS_CONFIG
  if (!raw) return d
  const bronzeTierMin = raw.tiers?.find(t => t.id === 'bronze')?.minSpent
  const bronzeMinSpent = Number(raw.bronzeMinSpent) >= 0
    ? Number(raw.bronzeMinSpent)
    : (bronzeTierMin != null ? Number(bronzeTierMin) : d.bronzeMinSpent)
  return {
    bronzeMinSpent,
    welcomeBonus: Number(raw.welcomeBonus) >= 0 ? Number(raw.welcomeBonus) : d.welcomeBonus,
    basic: mergeTier(d.basic, raw.basic),
    vip: mergeTier(d.vip, raw.vip),
    vipRules: {
      minOrders: Number(raw.vipRules?.minOrders) || d.vipRules.minOrders,
      minReviews: Number(raw.vipRules?.minReviews) || d.vipRules.minReviews,
      minSpent: Number(raw.vipRules?.minSpent) || d.vipRules.minSpent,
    },
    tiers: d.tiers.map((t, i) => {
      const patch = raw.tiers?.[i] && raw.tiers[i].id === t.id ? raw.tiers[i] : raw.tiers?.find(x => x.id === t.id)
      const merged = mergeTier(t, patch)
      if (t.id === 'bronze') merged.minSpent = bronzeMinSpent
      return merged
    }),
  }
}

export type ApiLoyaltySettings = {
  welcomeBonus?: number
  bronzeMinSpent?: number
  tierMinSpent?: { bronze?: number; silver?: number; gold?: number; platinum?: number }
  basic?: { bonusPercent?: number }
  bronze?: { bonusPercent?: number }
  silver?: { bonusPercent?: number }
  gold?: { bonusPercent?: number; defaultDebtLimit?: number }
  platinum?: { bonusPercent?: number; defaultDebtLimit?: number }
  vip?: { bonusPercent?: number; defaultDebtLimit?: number }
  vipRules?: { minOrders?: number; minReviews?: number; minSpent?: number }
}

/** Настройки с сервера → формат админки/магазина. */
export function apiLoyaltyToStatusConfig(
  api: ApiLoyaltySettings,
  base: LoyaltyStatusConfig = DEFAULT_LOYALTY_STATUS_CONFIG,
): LoyaltyStatusConfig {
  const t = api.tierMinSpent || {}
  const bronzeMin = Number(api.bronzeMinSpent) || Number(t.bronze) || base.bronzeMinSpent
  const tierPatch = (
    minSpent: number,
    bonusPercent?: number,
    defaultDebtLimit?: number,
  ): Partial<LoyaltyTierConfig> => {
    const patch: Partial<LoyaltyTierConfig> = { minSpent }
    if (bonusPercent != null) patch.bonusPercent = Number(bonusPercent)
    if (defaultDebtLimit != null) patch.defaultDebtLimit = Math.max(0, Number(defaultDebtLimit) || 0)
    return patch
  }
  return normalizeConfig({
    welcomeBonus: api.welcomeBonus ?? base.welcomeBonus,
    bronzeMinSpent: bronzeMin,
    vipRules: api.vipRules ? { ...base.vipRules, ...api.vipRules } : base.vipRules,
    basic: { bonusPercent: api.basic?.bonusPercent ?? base.basic.bonusPercent },
    vip: {
      bonusPercent: api.vip?.bonusPercent ?? base.vip.bonusPercent,
      ...(api.vip?.defaultDebtLimit != null
        ? { defaultDebtLimit: Math.max(0, Number(api.vip.defaultDebtLimit) || 0) }
        : {}),
    },
    tiers: base.tiers.map(tier => {
      if (tier.id === 'bronze') return { ...tier, ...tierPatch(bronzeMin, api.bronze?.bonusPercent) }
      if (tier.id === 'silver') return { ...tier, ...tierPatch(Number(t.silver) || tier.minSpent, api.silver?.bonusPercent) }
      if (tier.id === 'gold') {
        return { ...tier, ...tierPatch(Number(t.gold) || tier.minSpent, api.gold?.bonusPercent, api.gold?.defaultDebtLimit) }
      }
      if (tier.id === 'platinum') {
        return { ...tier, ...tierPatch(Number(t.platinum) || tier.minSpent, api.platinum?.bonusPercent, api.platinum?.defaultDebtLimit) }
      }
      return tier
    }),
  })
}

/** Настройки админки → payload для API сервера. */
export function statusConfigToApiPayload(cfg: LoyaltyStatusConfig): ApiLoyaltySettings {
  const next = normalizeConfig(cfg)
  const bronze = next.tiers.find(t => t.id === 'bronze')
  const silver = next.tiers.find(t => t.id === 'silver')
  const gold = next.tiers.find(t => t.id === 'gold')
  const platinum = next.tiers.find(t => t.id === 'platinum')
  return {
    welcomeBonus: next.welcomeBonus,
    bronzeMinSpent: next.bronzeMinSpent,
    tierMinSpent: {
      bronze: next.bronzeMinSpent,
      silver: silver?.minSpent ?? 1000,
      gold: gold?.minSpent ?? 2000,
      platinum: platinum?.minSpent ?? 3000,
    },
    basic: { bonusPercent: next.basic.bonusPercent },
    bronze: { bonusPercent: bronze?.bonusPercent ?? 0 },
    silver: { bonusPercent: silver?.bonusPercent ?? 0 },
    gold: { bonusPercent: gold?.bonusPercent ?? 0, defaultDebtLimit: gold?.defaultDebtLimit ?? 0 },
    platinum: { bonusPercent: platinum?.bonusPercent ?? 0, defaultDebtLimit: platinum?.defaultDebtLimit ?? 0 },
    vip: { bonusPercent: next.vip.bonusPercent, defaultDebtLimit: next.vip.defaultDebtLimit ?? 0 },
    vipRules: { ...next.vipRules },
  }
}

function applyLoyaltyConfigLocally(next: LoyaltyStatusConfig) {
  if (typeof window === 'undefined') return next
  if (USE_API) {
    memoryLoyaltyConfig = next
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  window.dispatchEvent(new CustomEvent(LOYALTY_STATUS_CONFIG_EVENT, { detail: next }))
  void import('./clientLoyalty').then(m => m.refreshLoyaltyTiersFromConfig()).catch(() => {})
  return next
}

/** Загрузить актуальные % и пороги с сервера (магазин + админка). */
export async function syncLoyaltyStatusConfigFromApi(): Promise<LoyaltyStatusConfig> {
  if (typeof window === 'undefined') return DEFAULT_LOYALTY_STATUS_CONFIG
  const { USE_API } = await import('./config')
  if (!USE_API) return loadLoyaltyStatusConfig()
  try {
    const { api } = await import('./api')
    const remote = await api.getLoyalty() as ApiLoyaltySettings
    const merged = apiLoyaltyToStatusConfig(remote, DEFAULT_LOYALTY_STATUS_CONFIG)
    return applyLoyaltyConfigLocally(merged)
  } catch {
    return memoryLoyaltyConfig || DEFAULT_LOYALTY_STATUS_CONFIG
  }
}

export function loadLoyaltyStatusConfig(): LoyaltyStatusConfig {
  if (typeof window === 'undefined') return DEFAULT_LOYALTY_STATUS_CONFIG
  if (USE_API) return memoryLoyaltyConfig || DEFAULT_LOYALTY_STATUS_CONFIG
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LOYALTY_STATUS_CONFIG
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_LOYALTY_STATUS_CONFIG
  }
}

export function saveLoyaltyStatusConfig(config: LoyaltyStatusConfig) {
  const next = normalizeConfig(config)
  applyLoyaltyConfigLocally(next)
  if (typeof window !== 'undefined') {
    import('./config').then(({ USE_API }) => {
      if (!USE_API) return
      import('./api').then(({ api }) => {
        api.updateLoyalty(statusConfigToApiPayload(next)).catch(() => {})
      })
    })
  }
  return next
}

export function resetLoyaltyStatusConfig() {
  const d = DEFAULT_LOYALTY_STATUS_CONFIG
  applyLoyaltyConfigLocally(d)
  if (typeof window !== 'undefined') {
    import('./config').then(({ USE_API }) => {
      if (!USE_API) return
      import('./api').then(({ api }) => {
        api.updateLoyalty(statusConfigToApiPayload(d)).catch(() => {})
      })
    })
  }
  return d
}

export function subscribeLoyaltyStatusConfig(cb: (cfg: LoyaltyStatusConfig) => void) {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => cb((e as CustomEvent<LoyaltyStatusConfig>).detail || loadLoyaltyStatusConfig())
  window.addEventListener(LOYALTY_STATUS_CONFIG_EVENT, handler)
  return () => window.removeEventListener(LOYALTY_STATUS_CONFIG_EVENT, handler)
}

export function tierThresholdsFromConfig(cfg: LoyaltyStatusConfig = DEFAULT_LOYALTY_STATUS_CONFIG) {
  return {
    bronze: cfg.bronzeMinSpent,
    silver: cfg.tiers.find(t => t.id === 'silver')?.minSpent ?? 1000,
    gold: cfg.tiers.find(t => t.id === 'gold')?.minSpent ?? 2000,
    platinum: cfg.tiers.find(t => t.id === 'platinum')?.minSpent ?? 3000,
  }
}

export function getRegistrationWelcomeBonus(cfg = loadLoyaltyStatusConfig()): number {
  return Math.max(0, Number(cfg.welcomeBonus) || 0)
}

export function getLoyaltyTierById(id: LoyaltyTierId, cfg = loadLoyaltyStatusConfig()): LoyaltyTierConfig | undefined {
  if (id === 'basic') return cfg.basic
  if (id === 'vip') return cfg.vip
  return cfg.tiers.find(t => t.id === id)
}

export function loyaltyTierOptions(cfg = loadLoyaltyStatusConfig()): { id: ClientLevel; label: string }[] {
  return [cfg.basic, ...cfg.tiers].map(t => ({ id: t.id as ClientLevel, label: t.label }))
}

export function tierPresentationMap(cfg = loadLoyaltyStatusConfig()) {
  const map: Record<string, { bg: string; border: string; glow: string; accent: string; rail: string }> = {}
  const all = [cfg.basic, ...cfg.tiers, cfg.vip]
  for (const t of all) {
    map[t.id] = { bg: t.bgGradient, border: t.border, glow: t.glow, accent: t.accent, rail: t.rail }
  }
  return map
}

export function tierTopGlowMap(cfg = loadLoyaltyStatusConfig()) {
  const map: Record<string, string> = {}
  for (const t of [cfg.basic, ...cfg.tiers, cfg.vip]) map[t.id] = t.topGlow
  return map
}
