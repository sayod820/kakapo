'use client'
import { create } from 'zustand'
import { emitCrmSync } from './clientProfileSync'
import { USE_API } from './config'
import { api } from './api'
import { useClientStore } from './clientStore'
import { phonesMatch, type AdminClient, type ClientLevel } from './clientCrm'
import { onBonusCredited } from './pushService'
import {
  DEFAULT_ADMIN_CARDS,
  normalizeCard,
  type AdminCard,
  type CardStatus,
} from './cardCrm'

const CARDS_KEY = 'kakapo-cards'

function loadCards(): AdminCard[] {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_CARDS
  try {
    const raw = localStorage.getItem(CARDS_KEY)
    if (!raw) return DEFAULT_ADMIN_CARDS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ADMIN_CARDS
    return parsed.map(c => normalizeCard(c))
  } catch {
    return DEFAULT_ADMIN_CARDS
  }
}

function saveCards(list: AdminCard[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(list))
    emitCrmSync()
  } catch { /* quota */ }
}

function mergeCardLists(primary: AdminCard[], secondary: AdminCard[]): AdminCard[] {
  const byNum = new Map<string, AdminCard>()
  for (const c of secondary) byNum.set(c.num, normalizeCard(c))
  for (const c of primary) {
    const prev = byNum.get(c.num)
    byNum.set(c.num, normalizeCard(prev ? { ...prev, ...c, num: c.num } : c))
  }
  return Array.from(byNum.values())
}

function pushLoyaltyToClient(card: AdminCard) {
  const clients = useClientStore.getState().clients
  const client = card.clientId
    ? clients.find(c => c.id === card.clientId)
    : clients.find(c => c.card === card.num || (card.phone && phonesMatch(c.phone, card.phone)))
  if (!client) return
  const prevBonus = client.bonus || 0
  useClientStore.getState().updateClient(client.id, {
    card: card.status === 'unlinked' ? '' : card.num,
    level: (card.level || client.level) as ClientLevel,
    bonus: card.bonus,
    debt: card.debt,
    debtLimit: card.debtLimit,
    vip: !!card.vip,
    debtEnabled: !!card.debtEnabled,
    blocked: card.status === 'blocked',
    loyaltyPeriod: card.loyaltyPeriod,
  })
  if (card.bonus > prevBonus) {
    onBonusCredited(client.phone, card.bonus - prevBonus, card.num)
  }
}

function clearClientCard(num: string) {
  const clients = useClientStore.getState().clients
  const client = clients.find(c => c.card === num)
  if (client) useClientStore.getState().updateClient(client.id, { card: '' })
}

interface CardStore {
  cards: AdminCard[]
  hydrated: boolean
  hydrate: () => void
  reload: () => void
  setCards: (list: AdminCard[]) => void
  updateCard: (num: string, patch: Partial<AdminCard>) => void
  updateCardLoyalty: (num: string, patch: Partial<AdminCard>) => void
  syncIdentityFromClient: (client: AdminClient) => void
  assignToClient: (num: string, client: AdminClient) => void
  linkCard: (num: string, data: {
    phone: string
    clientName: string
    clientId?: string
    level: ClientLevel
    debtLimit: number
    bonus: number
    debt: number
    vip?: boolean
    debtEnabled?: boolean
  }) => void
  unlinkCard: (num: string) => void
  toggleBlock: (num: string) => void
  generateCards: (count: number) => Promise<AdminCard[]>
  fetchFromApi: () => Promise<void>
}

export const useCardStore = create<CardStore>((set, get) => ({
  cards: DEFAULT_ADMIN_CARDS,
  hydrated: false,
  hydrate: () => {
    set({ cards: loadCards(), hydrated: true })
  },
  reload: () => {
    set({ cards: loadCards() })
  },
  setCards: list => {
    const cards = list.map(c => normalizeCard(c))
    saveCards(cards)
    set({ cards })
  },
  updateCard: (num, patch) => set(s => {
    const cards = s.cards.map(c => (c.num === num ? normalizeCard({ ...c, ...patch, num }) : c))
    saveCards(cards)
    if (USE_API) api.updateCard(num, patch).catch(console.error)
    return { cards }
  }),
  updateCardLoyalty: (num, patch) => set(s => {
    const cards = s.cards.map(c => (c.num === num ? normalizeCard({ ...c, ...patch, num }) : c))
    saveCards(cards)
    const updated = cards.find(c => c.num === num)
    if (updated) pushLoyaltyToClient(updated)
    if (USE_API) api.updateCard(num, patch).catch(console.error)
    return { cards }
  }),
  syncIdentityFromClient: client => {
    if (!client.card) return
    get().updateCard(client.card, {
      client: client.name,
      phone: client.phone,
      clientId: client.id,
      status: client.blocked ? 'blocked' : 'active',
    })
  },
  assignToClient: (num, client) => {
    get().updateCardLoyalty(num, {
      client: client.name,
      phone: client.phone,
      clientId: client.id,
      status: 'active' as CardStatus,
      level: client.level,
      bonus: client.bonus,
      debt: client.debt,
      debtLimit: client.debtLimit,
      vip: !!client.vip,
      debtEnabled: !!client.debtEnabled,
    })
    useClientStore.getState().updateClient(client.id, { card: num })
  },
  linkCard: (num, data) => {
    if (data.clientId) {
      const client = useClientStore.getState().clients.find(c => c.id === data.clientId)
      if (client?.card && client.card !== num) {
        get().unlinkCard(client.card)
      }
    }
    const other = get().cards.find(c => c.num !== num && c.phone && phonesMatch(c.phone, data.phone))
    if (other && other.status === 'active') {
      get().unlinkCard(other.num)
    }
    get().updateCardLoyalty(num, {
      client: data.clientName,
      phone: data.phone.trim(),
      clientId: data.clientId,
      status: 'active' as CardStatus,
      level: data.level,
      debtLimit: data.debtLimit,
      bonus: data.bonus,
      debt: data.debt,
      vip: !!data.vip,
      debtEnabled: !!data.debtEnabled,
    })
    if (data.clientId) {
      useClientStore.getState().updateClient(data.clientId, {
        card: num,
        level: data.level,
        debtLimit: data.debtLimit,
        bonus: data.bonus,
        debt: data.debt,
        vip: !!data.vip,
        debtEnabled: !!data.debtEnabled,
      })
    }
  },
  unlinkCard: num => {
    clearClientCard(num)
    set(s => {
      const cards = s.cards.map(c => (c.num === num ? normalizeCard({
        num,
        client: '',
        phone: '',
        status: 'unlinked',
        level: '',
        bonus: 0,
        debt: 0,
        debtLimit: 0,
        vip: false,
        debtEnabled: false,
      }) : c))
      saveCards(cards)
      return { cards }
    })
    if (USE_API) api.updateCard(num, { unlink: true }).catch(console.error)
  },
  toggleBlock: num => {
    const card = get().cards.find(c => c.num === num)
    if (!card) return
    const next: CardStatus = card.status === 'blocked' ? (card.phone ? 'active' : 'unlinked') : 'blocked'
    get().updateCardLoyalty(num, { status: next })
  },
  generateCards: async count => {
    const n = Math.min(500, Math.max(1, count))

    const createLocal = (): AdminCard[] => {
      const cards = get().cards
      const nums = cards.map(c => parseInt(c.num.replace(/\D/g, ''), 10)).filter(x => !Number.isNaN(x))
      let next = (nums.length ? Math.max(...nums) : 0) + 1
      const created: AdminCard[] = []
      for (let i = 0; i < n; i++) {
        created.push(normalizeCard({
          num: `КАКАПО-${String(next).padStart(4, '0')}`,
          client: '',
          phone: '',
          status: 'unlinked',
          level: '',
          bonus: 0,
          debtLimit: 0,
          debt: 0,
          issued: new Date().toISOString().slice(0, 10),
        }))
        next += 1
      }
      const merged = [...cards, ...created]
      saveCards(merged)
      set({ cards: merged })
      if (USE_API) {
        for (const row of created) {
          api.updateCard(row.num, row).catch(console.error)
        }
      }
      return created
    }

    if (USE_API) {
      try {
        const res = await api.generateCards(n)
        const created = (res?.cards || []).map(c => normalizeCard(c))
        if (created.length) {
          const merged = mergeCardLists(get().cards, created)
          saveCards(merged)
          set({ cards: merged })
          return created
        }
      } catch (e) {
        console.error('API generateCards failed, using local fallback', e)
      }
    }
    return createLocal()
  },
  fetchFromApi: async () => {
    const local = loadCards()
    if (!USE_API) {
      set({ cards: local, hydrated: true })
      return
    }
    try {
      const apiList = await api.getCards()
      const remote = apiList.length ? apiList.map(c => normalizeCard(c)) : DEFAULT_ADMIN_CARDS
      const cards = mergeCardLists(local, remote)
      saveCards(cards)
      set({ cards, hydrated: true })
    } catch (e) {
      console.error(e)
      set({ cards: local, hydrated: true })
    }
  },
}))

export function useCards() {
  return useCardStore(s => s.cards)
}

export async function syncCardsFromApi() {
  await useCardStore.getState().fetchFromApi()
}

export function hydrateCardStore() {
  useCardStore.getState().hydrate()
}
