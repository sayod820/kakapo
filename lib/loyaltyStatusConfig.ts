'use client'

import { USE_API } from './config'

import type { ClientLevel } from './clientCrm'
import { qualifiesForDebtSection } from './clientCrm'

export type LoyaltyTierId = ClientLevel | 'vip'

/** Порог наличных в магазине → % бонусов (настраивается в админке «Статус карты») */
export type CashDepositTier = {
  /** Минимальная сумма наличных (сом) для этого порога */
  minAmount: number
  /** Процент бонусов от суммы */
  bonusPercent: number
  /** Подпись в админке (необязательно) */
  label?: string
}

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
  /** Пороги бонусов за наличные в магазине (Торговля → Клиенты) */
  cashDepositTiers: CashDepositTier[]
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
  cashDepositTiers: [
    { minAmount: 100, bonusPercent: 1, label: 'от 100 сом' },
    { minAmount: 500, bonusPercent: 3, label: 'от 500 сом' },
    { minAmount: 1000, bonusPercent: 5, label: 'от 1000 сом' },
    { minAmount: 5000, bonusPercent: 10, label: 'от 5000 сом' },
  ],
  basic: {
    id: 'basic',
    label: 'Базовый',
    emoji: '👤',
    minSpent: 0,
    bonusPercent: 0,
    defaultDebtLimit: 0,
    color: '#1B5E3B',
    cashback: '—',
    perk: 'Привилегий пока нет',
    border: 'rgba(27,94,59,.22)',
    glow: 'rgba(11,61,44,.12)',
    accent: '#0B3D2C',
    topGlow: 'rgba(11,61,44,.10)',
    bgGradient: 'linear-gradient(145deg,#E8F2EA 0%,#F4F8F5 55%,#E2EEE5 100%)',
    rail: 'linear-gradient(90deg,#0B3D2C,#1B5E3B)',
  },
  tiers: [
    {
      id: 'bronze',
      label: 'Бронза',
      emoji: '🥉',
      minSpent: 500,
      bonusPercent: 1,
      defaultDebtLimit: 0,
      color: '#6B4423',
      cashback: '1%',
      perk: 'Бонусы за покупки',
      border: 'rgba(107,68,35,.35)',
      glow: 'rgba(61,36,22,.16)',
      accent: '#6B4423',
      topGlow: 'rgba(61,36,22,.12)',
      bgGradient: 'linear-gradient(145deg,#6B4423 0%,#5A381C 50%,#4A2C16 100%)',
      rail: 'linear-gradient(90deg,#3D2416,#8B5A2B)',
    },
    {
      id: 'silver',
      label: 'Серебро',
      emoji: '🥈',
      minSpent: 1000,
      bonusPercent: 2,
      defaultDebtLimit: 0,
      color: '#4A5560',
      cashback: '2%',
      perk: 'Доп. скидки',
      border: 'rgba(74,85,96,.28)',
      glow: 'rgba(122,135,148,.14)',
      accent: '#5A6A78',
      topGlow: 'rgba(122,135,148,.10)',
      bgGradient: 'linear-gradient(145deg,#EEF2F5 0%,#E4EAF0 55%,#DCE3EA 100%)',
      rail: 'linear-gradient(90deg,#7A8794,#A8B4BF)',
    },
    {
      id: 'gold',
      label: 'Золото',
      emoji: '🥇',
      minSpent: 2000,
      bonusPercent: 3,
      defaultDebtLimit: 0,
      color: '#8B6914',
      cashback: '3%',
      perk: 'Приоритет сборки',
      border: 'rgba(139,105,20,.30)',
      glow: 'rgba(138,115,85,.14)',
      accent: '#8B6914',
      topGlow: 'rgba(138,115,85,.10)',
      bgGradient: 'linear-gradient(145deg,#F7EEDC 0%,#F0E4C8 55%,#E8D9B4 100%)',
      rail: 'linear-gradient(90deg,#8A7355,#C4A574)',
    },
    {
      id: 'platinum',
      label: 'Platinum',
      emoji: '💎',
      minSpent: 3000,
      bonusPercent: 5,
      defaultDebtLimit: 0,
      color: '#163842',
      cashback: '5%',
      perk: 'Максимальный кэшбэк',
      border: 'rgba(22,56,66,.35)',
      glow: 'rgba(22,56,66,.16)',
      accent: '#1A4550',
      topGlow: 'rgba(22,56,66,.12)',
      bgGradient: 'linear-gradient(145deg,#1A4550 0%,#163842 55%,#122F38 100%)',
      rail: 'linear-gradient(90deg,#163842,#2A6A78)',
    },
  ],
  vip: {
    id: 'vip',
    label: 'VIP Elite',
    emoji: '👑',
    minSpent: 3000,
    bonusPercent: 5,
    defaultDebtLimit: 5000,
    color: '#0B3D2C',
    cashback: '5%',
    perk: 'Все привилегии',
    border: 'rgba(11,61,44,.35)',
    glow: 'rgba(11,61,44,.18)',
    accent: '#0B3D2C',
    topGlow: 'rgba(11,61,44,.12)',
    bgGradient: 'linear-gradient(145deg,#0F3D2E 0%,#0B3D2C 45%,#082E22 100%)',
    rail: 'linear-gradient(90deg,#0B3D2C,#1B5E3B)',
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
  merged.defaultDebtLimit = merged.id === 'gold' || merged.id === 'platinum'
    ? 0
    : Math.max(0, Number(merged.defaultDebtLimit) || 0)
  return merged
}

function normalizeCashDepositTiers(raw?: CashDepositTier[] | null): CashDepositTier[] {
  const d = DEFAULT_LOYALTY_STATUS_CONFIG.cashDepositTiers
  if (!Array.isArray(raw) || !raw.length) return d
  const normalized = raw
    .map(t => ({
      minAmount: Math.max(0, Number(t.minAmount) || 0),
      bonusPercent: Math.max(0, Number(t.bonusPercent) || 0),
      label: (t.label || '').trim() || undefined,
    }))
    .sort((a, b) => a.minAmount - b.minAmount)
  return normalized.length ? normalized : d
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
    cashDepositTiers: normalizeCashDepositTiers(raw.cashDepositTiers),
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
  cashDepositTiers?: CashDepositTier[]
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
    cashDepositTiers: api.cashDepositTiers ?? base.cashDepositTiers,
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
        return { ...tier, ...tierPatch(Number(t.gold) || tier.minSpent, api.gold?.bonusPercent), defaultDebtLimit: 0 }
      }
      if (tier.id === 'platinum') {
        return { ...tier, ...tierPatch(Number(t.platinum) || tier.minSpent, api.platinum?.bonusPercent), defaultDebtLimit: 0 }
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
    cashDepositTiers: next.cashDepositTiers,
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
    gold: { bonusPercent: gold?.bonusPercent ?? 0 },
    platinum: { bonusPercent: platinum?.bonusPercent ?? 0 },
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

export function cashDepositTierLabel(tier: CashDepositTier): string {
  return tier.label || `от ${tier.minAmount.toLocaleString('ru-RU')} сом`
}

/** Активный порог бонуса для суммы наличных (наибольший minAmount ≤ cash). */
export function cashDepositTierForAmount(cashAmount: number, cfg = loadLoyaltyStatusConfig()): CashDepositTier | null {
  const cash = Math.max(0, Number(cashAmount) || 0)
  if (cash <= 0) return null
  const tiers = normalizeCashDepositTiers(cfg.cashDepositTiers)
  let matched: CashDepositTier | null = null
  for (const tier of tiers) {
    if (cash >= tier.minAmount) matched = tier
    else break
  }
  return matched
}

/** Бонусы ⭐ за внесённые наличные по порогам из админки. */
export function calcCashDepositBonus(cashAmount: number, cfg = loadLoyaltyStatusConfig()): number {
  const tier = cashDepositTierForAmount(cashAmount, cfg)
  if (!tier) return 0
  const cash = Math.max(0, Number(cashAmount) || 0)
  return Math.round(cash * tier.bonusPercent) / 100
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

/** В API-режиме конфиг с сервера уже загружен (не подставлять DEFAULT 5000 до sync). */
export function isLoyaltyConfigReady(): boolean {
  if (!USE_API) return true
  return memoryLoyaltyConfig != null
}

/** Лимит долга по умолчанию для уровня из программы лояльности. */
export function getTierDefaultDebtLimit(
  level: ClientLevel | 'new' | undefined,
  isVip: boolean,
  cfg = loadLoyaltyStatusConfig(),
): number {
  if (isVip) return Math.max(0, Number(cfg.vip.defaultDebtLimit) || 0)
  return 0
}

/** Эффективный лимит: сначала сохранённый на карте, иначе из программы (после загрузки с API). */
export function resolveEffectiveDebtLimit(
  user: {
    level?: ClientLevel | 'new'
    vip?: boolean
    debtLimit?: number
    debtEnabled?: boolean
    levelAssignMode?: 'auto' | 'manual'
  },
  cfg = loadLoyaltyStatusConfig(),
): number {
  const stored = Math.max(0, Number(user.debtLimit) || 0)
  const debtOn = user.levelAssignMode === 'manual'
    ? !!user.debtEnabled
    : (qualifiesForDebtSection(user.level, user.vip) || !!user.debtEnabled)
  if (!debtOn) return stored
  if (stored > 0) return stored
  if (USE_API && !isLoyaltyConfigReady()) return 0
  return getTierDefaultDebtLimit(user.level, !!user.vip, cfg)
}
