'use client'
import { useClientStore } from './clientStore'
import { useCardStore } from './cardStore'
import {
  phonesMatch,
  type AdminClient,
  type ClientLevel,
  type ClientProfileForm,
  emptyClientProfileForm,
  clientProfileFromClient,
} from './clientCrm'
import { type AdminCard, type CardLoyaltyForm, emptyCardLoyaltyForm, cardLoyaltyFromCard, cardHasDebtSection } from './cardCrm'
import { recordStoreDebtCharge, recordStoreDebtRepayment } from './clientVipCredit'

export type { ClientProfileForm, CardLoyaltyForm }
export { emptyClientProfileForm, emptyCardLoyaltyForm, clientProfileFromClient, cardLoyaltyFromCard }

export function lookupClientByPhone(phone: string, clients?: AdminClient[]): AdminClient | undefined {
  const list = clients ?? useClientStore.getState().clients
  const p = phone.trim()
  if (!p) return undefined
  return list.find(c => phonesMatch(c.phone, p))
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
      level: 'bronze',
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
export function saveCardLoyalty(
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
  }

  const prevDebt = Math.max(0, Number(card.debt) || 0)

  if (!client) {
    client = clientStore.addClient({
      name: 'Клиент',
      phone,
      email: '',
      addr: '',
      card: card.num,
      blocked: false,
      note: '',
      ...loyalty,
    })
  }

  const clientName = client.name || 'Клиент'

  if (mode === 'link') {
    cardStore.linkCard(card.num, {
      phone,
      clientName,
      clientId: client.id,
      ...loyalty,
    })
  } else {
    cardStore.updateCardLoyalty(card.num, {
      phone,
      client: clientName,
      clientId: client.id,
      status: 'active' as const,
      ...loyalty,
    })
    clientStore.updateClient(client.id, {
      card: card.num,
      name: clientName,
      phone,
      ...loyalty,
    })
    if (loyalty.debt < prevDebt - 0.001) {
      recordStoreDebtRepayment(phone, prevDebt - loyalty.debt)
    } else if (loyalty.debt > prevDebt + 0.001) {
      recordStoreDebtCharge(phone, loyalty.debt - prevDebt)
    }
  }
}

/** Создать 1 новую карту и сразу привязать к клиенту */
export async function createAndLinkCard(form: CardLoyaltyForm): Promise<AdminCard> {
  const cardStore = useCardStore.getState()
  const created = await cardStore.generateCards(1)
  const card = created[0]
  if (!card) throw new Error('Не удалось создать карту. Попробуйте ещё раз.')
  saveCardLoyalty(card, form, 'link')
  return useCardStore.getState().cards.find(c => c.num === card.num) || card
}

export function clientNoteForCard(card: AdminCard, clients: AdminClient[]): string {
  const client = card.clientId
    ? clients.find(c => c.id === card.clientId)
    : clients.find(c => c.card === card.num || (card.phone && phonesMatch(c.phone, card.phone)))
  return client?.note || ''
}
