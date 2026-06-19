'use client'
import { useClientStore } from './clientStore'
import { useCardStore } from './cardStore'
import {
  phonesMatch,
  pickClientDisplayName,
  normalizeClient,
  type AdminClient,
  type ClientLevel,
  type ClientProfileForm,
  emptyClientProfileForm,
  clientProfileFromClient,
} from './clientCrm'
import { type AdminCard, type CardLoyaltyForm, emptyCardLoyaltyForm, cardLoyaltyFromCard, cardHasDebtSection, cardNumsMatch, canonicalCardNum } from './cardCrm'
import { recordStoreDebtCharge, recordStoreDebtRepayment } from './clientVipCredit'
import { emitCrmSync } from './clientProfileSync'
import { currentLoyaltyPeriod, isLoyaltyPeriodCurrent } from './loyaltyPeriod'
import { hydrateCardStore } from './cardStore'
import { USE_API } from './config'
import { api } from './api'
import { unmarkPhoneDeleted } from './clientTombstones'

export type { ClientProfileForm, CardLoyaltyForm }
export { emptyClientProfileForm, emptyCardLoyaltyForm, clientProfileFromClient, cardLoyaltyFromCard }

export function lookupClientByPhone(phone: string, clients?: AdminClient[]): AdminClient | undefined {
  const list = clients ?? useClientStore.getState().clients
  const p = phone.trim()
  if (!p) return undefined
  return list.find(c => phonesMatch(c.phone, p))
}

const REGISTRATION_WELCOME_BONUS = 100

/** Создать карту КАКАПО и привязать к клиенту (регистрация / если карты ещё нет) */
export async function provisionLoyaltyCardForClient(client: AdminClient): Promise<AdminClient> {
  hydrateCardStore()
  const clientStore = useClientStore.getState()
  const cardStore = useCardStore.getState()

  let current = clientStore.clients.find(c => c.id === client.id) || normalizeClient(client)
  if (current.card) {
    const linked = cardStore.cards.find(c => c.num === current.card && c.status !== 'unlinked')
    if (linked) return current
  }

  const created = await cardStore.generateCards(1)
  const card = created[0]
  if (!card) throw new Error('Не удалось создать карту лояльности')

  const enriched = normalizeClient({
    ...current,
    level: (current.level || 'basic') as ClientLevel,
    bonus: Math.max(Number(current.bonus) || 0, REGISTRATION_WELCOME_BONUS),
    loyaltyPeriod: current.loyaltyPeriod || currentLoyaltyPeriod(),
  })

  cardStore.assignToClient(card.num, enriched)
  emitCrmSync()
  return clientStore.clients.find(c => c.id === client.id) || enriched
}

/** Регистрация нового клиента: аккаунт + автоматическая карта */
export async function registerClientAccount(
  data: Omit<AdminClient, 'id' | 'orders' | 'spent' | 'createdAt' | 'lastOrderAt'>,
): Promise<AdminClient> {
  unmarkPhoneDeleted(data.phone)
  useClientStore.getState().hydrate()
  hydrateCardStore()

  const local = useClientStore.getState().addClient(data, { skipApi: true })

  let client = local
  if (USE_API) {
    try {
      const remote = await api.createClient(local)
      useClientStore.getState().updateClient(local.id, remote)
      client = useClientStore.getState().clients.find(c => c.id === local.id) || local
      if (client.card) {
        await useCardStore.getState().fetchFromApi()
      }
    } catch (e) {
      console.error(e)
    }
  }

  if (!client.card) {
    client = await provisionLoyaltyCardForClient(client)
  }

  emitCrmSync()
  return client
}

export function loyaltySummaryForClient(client: AdminClient, cards: AdminCard[]) {
  const card = client.card ? cards.find(c => c.num === client.card) : undefined
  return {
    card: client.card || '',
    level: card?.level || client.level,
    bonus: card?.bonus ?? client.bonus,
    debt: card?.debt ?? client.debt,
    debtLimit: card?.debtLimit ?? client.debtLimit,
    vip: !!(card?.vip ?? client.vip),
    debtEnabled: cardHasDebtSection({
      debtEnabled: card?.debtEnabled ?? client.debtEnabled,
      debt: card?.debt ?? client.debt,
      debtLimit: card?.debtLimit ?? client.debtLimit,
    }),
  }
}

/** Сохранить профиль клиента (без полей лояльности) */
export function saveClientProfile(clientId: string | null, form: ClientProfileForm) {
  const name = form.name.trim()
  const phone = form.phone.trim()
  const cardNum = form.card.trim().toUpperCase()
  const clientStore = useClientStore.getState()
  const cardStore = useCardStore.getState()

  const profilePatch = {
    name,
    phone,
    email: form.email.trim(),
    addr: form.addr.trim(),
    note: form.note.trim(),
    blocked: form.blocked,
  }

  if (clientId) {
    const prev = clientStore.clients.find(c => c.id === clientId)
    if (!prev) return

    if (prev.card && prev.card !== cardNum) {
      cardStore.unlinkCard(prev.card)
    }

    clientStore.updateClient(clientId, { ...profilePatch, card: cardNum })

    const client = useClientStore.getState().clients.find(c => c.id === clientId)!
    if (cardNum) {
      if (cardNum !== prev.card) {
        cardStore.assignToClient(cardNum, client)
      } else {
        cardStore.syncIdentityFromClient(client)
      }
      if (form.blocked !== prev.blocked) {
        const card = cardStore.cards.find(c => c.num === cardNum)
        if (card && ((form.blocked && card.status !== 'blocked') || (!form.blocked && card.status === 'blocked'))) {
          cardStore.toggleBlock(cardNum)
        }
      }
    } else if (form.blocked !== prev.blocked) {
      // blocked without card — only on client record
    }
  } else {
    const row = clientStore.addClient({
      ...profilePatch,
      card: '',
      level: 'basic',
      debt: 0,
      bonus: 0,
      debtLimit: 0,
    })
    if (cardNum) {
      cardStore.assignToClient(cardNum, row)
    }
  }
}

/** Сохранить лояльность карты (уровень, бонусы, долг) */
export async function saveCardLoyalty(
  card: AdminCard,
  form: CardLoyaltyForm,
  mode: 'link' | 'edit',
) {
  const cardStore = useCardStore.getState()
  const clientStore = useClientStore.getState()

  let client = form.clientId
    ? clientStore.clients.find(c => c.id === form.clientId)
    : lookupClientByPhone(form.phone, clientStore.clients)

  const phone = (form.phone || client?.phone || '').trim()
  if (!phone) throw new Error('Выберите клиента или укажите телефон')

  const loyalty = {
    level: form.level,
    debtLimit: Math.max(0, Number(form.debtLimit) || 0),
    bonus: Math.max(0, Number(form.bonus) || 0),
    debt: Math.max(0, Number(form.debt) || 0),
    vip: !!form.vip,
    debtEnabled: !!form.debtEnabled,
    loyaltyPeriod: currentLoyaltyPeriod(),
  }

  const prevDebt = Math.max(0, Number(card.debt) || 0)

  if (!client) {
    client = clientStore.addClient({
      name: pickClientDisplayName(card.client),
      phone,
      email: '',
      addr: '',
      card: card.num,
      blocked: false,
      note: '',
      ...loyalty,
    })
  }

  const clientName = pickClientDisplayName(client.name, card.client)
  const cardKey = canonicalCardNum(card.num)
  const cardPatch = {
    phone,
    client: clientName,
    clientId: client.id,
    status: 'active' as const,
    ...loyalty,
  }
  const clientPatch = {
    card: cardKey,
    name: clientName,
    phone,
    ...loyalty,
  }

  if (mode === 'link') {
    clientStore.updateClient(client.id, clientPatch, { skipApi: true })
    cardStore.linkCard(cardKey, {
      phone,
      clientName,
      clientId: client.id,
      ...loyalty,
    })
  } else {
    cardStore.updateCardLoyalty(cardKey, cardPatch, { skipApi: true })
    clientStore.updateClient(client.id, clientPatch, { skipApi: true })
    if (loyalty.debt < prevDebt - 0.001) {
      recordStoreDebtRepayment(phone, prevDebt - loyalty.debt)
    } else if (loyalty.debt > prevDebt + 0.001) {
      recordStoreDebtCharge(phone, loyalty.debt - prevDebt)
    }
  }

  if (USE_API) {
    try {
      const apiCardNum = card.num.trim()
      await Promise.all([
        api.updateCard(apiCardNum, cardPatch),
        api.updateClient(client.id, clientPatch),
      ])
    } catch (e) {
      console.error('saveCardLoyalty API failed', e)
      throw new Error('Не удалось сохранить на сервер. Проверьте подключение и повторите.')
    }
  }
  emitCrmSync()
}

/** Сброс статуса и VIP в начале нового месяца */
export function syncMonthlyLoyaltyReset(phone: string, cardNum?: string): boolean {
  const clientStore = useClientStore.getState()
  const cardStore = useCardStore.getState()
  const client = clientStore.clients.find(c => phonesMatch(c.phone, phone))
  const num = cardNum?.trim().toUpperCase()
  const card = num
    ? cardStore.cards.find(c => cardNumsMatch(c.num, num) && c.status !== 'unlinked')
    : cardStore.cards.find(c => c.status === 'active' && c.phone && phonesMatch(c.phone, phone))

  const storedPeriod = card?.loyaltyPeriod || client?.loyaltyPeriod
  if (!storedPeriod) return false
  if (isLoyaltyPeriodCurrent(storedPeriod)) return false

  const period = currentLoyaltyPeriod()
  const patch = { level: 'basic' as ClientLevel, vip: false, loyaltyPeriod: period }

  if (card) cardStore.updateCardLoyalty(card.num, patch)
  if (client) clientStore.updateClient(client.id, { ...patch, ...(card ? { card: card.num } : {}) })
  emitCrmSync()
  return true
}

/** Автоповышение уровня по доставленным заказам и тратам за текущий месяц */
export function syncAutoLevelToCrm(phone: string, level: ClientLevel, cardNum?: string) {
  const clientStore = useClientStore.getState()
  const cardStore = useCardStore.getState()
  const client = clientStore.clients.find(c => phonesMatch(c.phone, phone))
  const num = cardNum?.trim().toUpperCase()
  const card = num
    ? cardStore.cards.find(c => cardNumsMatch(c.num, num) && c.status !== 'unlinked')
    : cardStore.cards.find(c => c.status === 'active' && c.phone && phonesMatch(c.phone, phone))

  const period = currentLoyaltyPeriod()
  if (card) {
    cardStore.updateCardLoyalty(card.num, { level, loyaltyPeriod: period, vip: !!card.vip })
  }
  if (client) {
    clientStore.updateClient(client.id, {
      level,
      loyaltyPeriod: period,
      vip: !!client.vip,
      ...(card ? { card: card.num } : {}),
    })
  }
  emitCrmSync()
}

/** Создать 1 новую карту и сразу привязать к клиенту */
export async function createAndLinkCard(form: CardLoyaltyForm): Promise<AdminCard> {
  const cardStore = useCardStore.getState()
  const created = await cardStore.generateCards(1)
  const card = created[0]
  if (!card) throw new Error('Не удалось создать карту. Попробуйте ещё раз.')
  await saveCardLoyalty(card, form, 'link')
  return useCardStore.getState().cards.find(c => cardNumsMatch(c.num, card.num)) || card
}

export function clientNoteForCard(card: AdminCard, clients: AdminClient[]): string {
  const client = card.clientId
    ? clients.find(c => c.id === card.clientId)
    : clients.find(c => c.card === card.num || (card.phone && phonesMatch(c.phone, card.phone)))
  return client?.note || ''
}
