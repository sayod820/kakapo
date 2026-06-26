'use client'
import { useClientStore, markClientLoyaltySaved, syncClientsFromApi } from './clientStore'
import { useCardStore } from './cardStore'
import {
  phonesMatch,
  pickClientDisplayName,
  normalizeClient,
  withLoyaltyNote,
  maxClientLevel,
  loyaltyStatsFromOrders,
  type AdminClient,
  type ClientLevel,
  type ClientProfileForm,
  emptyClientProfileForm,
  clientProfileFromClient,
} from './clientCrm'
import { type AdminCard, type CardLoyaltyForm, emptyCardLoyaltyForm, cardLoyaltyFromCard, cardNumsMatch, canonicalCardNum, resolveDebtEnabled } from './cardCrm'
import { recordStoreDebtCharge, recordStoreDebtRepayment } from './clientVipCredit'
import { emitCrmSync, findMergedClientByPhone, fetchCrmStoreUser, crmStoreUsersEqual, mergeCrmIntoStoreUser } from './clientProfileSync'
import { resetClientNotificationsForAccount } from './clientNotifications'
import { currentLoyaltyPeriod, isLoyaltyPeriodCurrent } from './loyaltyPeriod'
import { hydrateCardStore, markCardLoyaltySaved } from './cardStore'
import type { ManualLoyaltySnapshot } from './loyaltySaveGuard'
import { USE_API } from './config'
import { api } from './api'
import { unmarkPhoneDeleted } from './clientTombstones'
import { getRegistrationWelcomeBonus, getTierDefaultDebtLimit, type LoyaltyStatusConfig } from './loyaltyStatusConfig'
import { endOfLoyaltyPeriodIso, earnedLevelForPeriod, qualifiesAutoVip, resolveLevelLockFromTerm, inferLevelAssignMode, isAutoLevelActive, resolveMergedLoyaltyLevel } from './loyaltyAdminLock'
import type { Order } from './types'

export type { ClientProfileForm, CardLoyaltyForm }
export { emptyClientProfileForm, emptyCardLoyaltyForm, clientProfileFromClient, cardLoyaltyFromCard }

/** Уровень по доставленным заказам текущего месяца (для авто-режима). */
export function earnedAutoLevelForClient(
  phone: string,
  client?: Pick<AdminClient, 'id' | 'phone' | 'accountGeneration'> | null,
  orders?: Order[],
): ClientLevel {
  const list = orders ?? []
  const { spent, orderCount } = loyaltyStatsFromOrders(list, phone, currentLoyaltyPeriod(), client)
  return earnedLevelForPeriod(spent, orderCount)
}

export async function syncCardDebtLimitsFromLoyaltyConfig(cfg?: LoyaltyStatusConfig) {
  const { loadLoyaltyStatusConfig } = await import('./loyaltyStatusConfig')
  const config = cfg || loadLoyaltyStatusConfig()
  const cardStore = useCardStore.getState()
  const clientStore = useClientStore.getState()
  if (!cardStore.hydrated) cardStore.hydrate()
  if (!clientStore.hydrated) clientStore.hydrate()

  for (const card of cardStore.cards) {
    if (card.status !== 'active') continue
    const client = card.clientId ? clientStore.clients.find(c => c.id === card.clientId) : undefined
    const merged = cardLoyaltyFromCard(card, client)
    const tierLimit = getTierDefaultDebtLimit(merged.level, merged.vip, config)
    const eligible = merged.vip || merged.debtEnabled || merged.level === 'gold' || merged.level === 'platinum'
    if (!eligible || tierLimit <= 0) continue
    if (Number(card.debtLimit) === tierLimit) continue

    if (USE_API) {
      try {
        await api.updateCard(card.num, { debtLimit: tierLimit })
      } catch {
        // ignore per-card failures
      }
    } else {
      cardStore.updateCardLoyalty(card.num, { debtLimit: tierLimit })
    }
  }
  emitCrmSync()
}

function isCardMissingOnServer(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /карт[аы].*не найден|not found|404/i.test(msg)
}

function isMissingApiRoute(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /404|cannot post|нет этого api|not found/i.test(msg)
}

/** Если клиент сейчас в приложении — сразу подтянуть уровень/VIP из CRM после сохранения в админке */
async function syncActiveStoreSessionFromPhone(phone: string) {
  if (typeof window === 'undefined') return
  const { loadStoreUser, saveStoreUser, isClientSessionActive } = await import('./clientSession')
  if (!isClientSessionActive()) return
  const stored = loadStoreUser()
  if (!stored || !phonesMatch(stored.phone, phone)) return
  const next = await fetchCrmStoreUser(phone, stored.card)
  if (!next) return
  const merged = mergeCrmIntoStoreUser(stored, next)
  if (!crmStoreUsersEqual(stored, merged)) {
    saveStoreUser(merged)
    emitCrmSync()
  }
}

function isClientAlreadyExists(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /409|уже зарегистрирован|already registered/i.test(msg)
}

/** Сохранить лояльность на сервер; карта должна быть записана вместе с клиентом */
async function persistLoyaltyToApi(
  apiCardNum: string,
  cardPatch: Record<string, unknown>,
  clientId: string,
  clientPatch: Record<string, unknown>,
): Promise<{ cardSaved: boolean; clientSaved: boolean; cardNum: string; savedCard?: AdminCard; savedClient?: AdminClient }> {
  let cardSaved = false
  let cardNum = apiCardNum.trim()
  let savedCard: AdminCard | undefined
  let savedClient: AdminClient | undefined

  const trySaveCard = async (num: string) => {
    try {
      const saved = await api.updateCard(num, cardPatch)
      return saved
    } catch (e) {
      if (!isCardMissingOnServer(e)) throw e
      await api.ensureCard({ num, clientId, ...cardPatch })
      return api.updateCard(num, cardPatch)
    }
  }

  try {
    const saved = await trySaveCard(cardNum)
    cardSaved = true
    savedCard = saved
    cardNum = String(saved?.num || cardNum)
  } catch (e) {
    if (!isMissingApiRoute(e)) throw e
  }

  let clientSaved = false
  try {
    savedClient = await api.updateClient(clientId, clientPatch)
    clientSaved = true
  } catch (e) {
    throw e
  }

  if (!cardSaved) {
    throw new Error('Не удалось сохранить карту на сервере. Обновите страницу и повторите.')
  }

  return { cardSaved, clientSaved, cardNum, savedCard, savedClient }
}

function apiLevelMatches(expected: ClientLevel, raw?: string | ''): boolean {
  const lvl = !raw || raw === '' ? 'basic' : raw
  return lvl === expected
}

export function lookupClientByPhone(phone: string, clients?: AdminClient[]): AdminClient | undefined {
  const list = clients ?? useClientStore.getState().clients
  const p = phone.trim()
  if (!p) return undefined
  return list.find(c => phonesMatch(c.phone, p))
}

export function newClientRegistrationDefaults(): Pick<
  AdminClient,
  'level' | 'vip' | 'debtEnabled' | 'loyaltyPeriod' | 'orders' | 'spent' | 'debt' | 'debtLimit'
> {
  return {
    level: 'basic',
    vip: false,
    debtEnabled: false,
    loyaltyPeriod: currentLoyaltyPeriod(),
    orders: 0,
    spent: 0,
    debt: 0,
    debtLimit: 0,
  }
}

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
    ...newClientRegistrationDefaults(),
    bonus: Math.max(Number(current.bonus) || 0, getRegistrationWelcomeBonus()),
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

  const registration = newClientRegistrationDefaults()
  const welcomeBonus = getRegistrationWelcomeBonus()
  const local = useClientStore.getState().addClient(
    { ...data, ...registration, bonus: welcomeBonus },
    { skipApi: true },
  )

  let client = local
  if (USE_API) {
    try {
      const { bonus: _drop, ...forApi } = { ...local, ...registration }
      const remote = await api.createClient(forApi)
      const merged = normalizeClient({
        ...local,
        ...remote,
        ...registration,
        id: remote.id || local.id,
        name: local.name,
        phone: local.phone,
        email: local.email,
        addr: local.addr,
        bonus: Number(remote.bonus) || welcomeBonus,
      })
      useClientStore.getState().updateClient(local.id, { ...merged, id: merged.id }, { skipApi: true })
      if (merged.id !== local.id) {
        useClientStore.getState().setClients(
          useClientStore.getState().clients.map(c => (c.id === local.id ? merged : c)),
        )
      }
      await api.updateClient(merged.id, {
        level: 'basic',
        vip: false,
        debtEnabled: false,
        loyaltyPeriod: registration.loyaltyPeriod,
      })
      client = useClientStore.getState().clients.find(c => c.id === merged.id || phonesMatch(c.phone, merged.phone)) || merged
      if (client.card) {
        await useCardStore.getState().fetchFromApi()
      }
      await resetClientNotificationsForAccount(client.phone)
    } catch (e) {
      useClientStore.getState().setClients(
        useClientStore.getState().clients.filter(c => c.id !== local.id),
      )
      if (isClientAlreadyExists(e)) {
        await syncClientsFromApi()
        hydrateCardStore()
        const existing = await findMergedClientByPhone(data.phone)
        if (existing) {
          unmarkPhoneDeleted(data.phone)
          if (!existing.card) {
            return provisionLoyaltyCardForClient(existing)
          }
          emitCrmSync()
          return existing
        }
      }
      throw e
    }
  }

  if (!client.card) {
    client = await provisionLoyaltyCardForClient(client)
  }

  emitCrmSync()
  return client
}

export function loyaltySummaryForClient(client: AdminClient, cards: AdminCard[]) {
  const card = client.card ? cards.find(c => cardNumsMatch(c.num, client.card)) : undefined
  return {
    card: client.card || '',
    level: resolveMergedLoyaltyLevel(card, client),
    bonus: card?.bonus ?? client.bonus,
    debt: card?.debt ?? client.debt,
    debtLimit: card?.debtLimit ?? client.debtLimit,
    vip: !!(card?.vip ?? client.vip),
    debtEnabled: resolveDebtEnabled(card, client),
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
  let cardNum = card.num

  let client = form.clientId
    ? clientStore.clients.find(c => c.id === form.clientId)
    : lookupClientByPhone(form.phone, clientStore.clients)

  const phone = (form.phone || client?.phone || '').trim()
  if (!phone) throw new Error('Выберите клиента или укажите телефон')

  const prevLevel = resolveMergedLoyaltyLevel(card, client)
  const prevVip = !!(card.vip ?? client?.vip)

  const assignMode = form.levelAssignMode ?? inferLevelAssignMode(card, client)
  let resolvedLevel = form.level
  if (assignMode === 'auto') {
    const { useOrders } = await import('./store')
    resolvedLevel = earnedAutoLevelForClient(phone, client, useOrders.getState().orders)
  }

  const statusChanged = !!form.vip !== prevVip || resolvedLevel !== prevLevel
  const tierLimit = getTierDefaultDebtLimit(resolvedLevel, !!form.vip)
  const debtEligible = !!form.vip || !!form.debtEnabled || resolvedLevel === 'gold' || resolvedLevel === 'platinum'
  const formLimit = Math.max(0, Number(form.debtLimit) || 0)
  const resolvedDebtLimit = formLimit > 0
    ? formLimit
    : (debtEligible && tierLimit > 0 ? tierLimit : 0)

  const lockFields = resolveLevelLockFromTerm(assignMode, resolvedLevel, form.levelTermDays ?? 0)

  const loyalty = {
    level: resolvedLevel,
    debtLimit: resolvedDebtLimit,
    bonus: Math.max(0, Number(form.bonus) || 0),
    debt: Math.max(0, Number(form.debt) || 0),
    vip: !!form.vip,
    debtEnabled: !!form.debtEnabled,
    loyaltyPeriod: currentLoyaltyPeriod(),
    levelAssignMode: lockFields.levelAssignMode,
    // null — явно сбросить на сервере устаревшие сроки (иначе ручной уровень «отваливается»)
    levelValidUntil: lockFields.levelValidUntil ?? null,
    levelLockedPeriod: lockFields.levelLockedPeriod ?? null,
    vipUntil: !form.vip
      ? undefined
      : form.vipUntil === null
        ? undefined
        : (form.vipUntil || endOfLoyaltyPeriodIso()),
    ...(statusChanged ? { bonusEligibleFrom: new Date().toISOString() } : {}),
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
  const loyaltyNote = withLoyaltyNote(client.note || card.note, !!form.vip, !!form.debtEnabled)
  const cardPatch = {
    phone,
    client: clientName,
    clientId: client.id,
    status: 'active' as const,
    note: loyaltyNote,
    allowBonusDecrease: true,
    ...loyalty,
  }

  const cardKey = canonicalCardNum(cardNum)
  const clientPatch = {
    card: cardKey,
    name: clientName,
    phone,
    note: loyaltyNote,
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

  markCardLoyaltySaved(cardKey, {
    cardNum: cardKey,
    clientId: client.id,
    level: resolvedLevel,
    levelAssignMode: lockFields.levelAssignMode,
    levelValidUntil: lockFields.levelValidUntil ?? null,
    levelLockedPeriod: lockFields.levelLockedPeriod ?? null,
    vip: !!form.vip,
    debtEnabled: !!form.debtEnabled,
    debtLimit: resolvedDebtLimit,
    bonus: loyalty.bonus,
    debt: loyalty.debt,
  })
  markClientLoyaltySaved(client.id)

  if (USE_API) {
    try {
      const result = await persistLoyaltyToApi(cardNum.trim(), cardPatch, client.id, {
        card: cardKey,
        name: clientName,
        phone,
        note: loyaltyNote,
        ...loyalty,
      })
      const saved = result.savedCard
      if (lockFields.levelAssignMode === 'manual' && saved) {
        const apiMode = saved.levelAssignMode
        const apiLevel = (saved.level || 'basic') as ClientLevel
        if (apiMode !== 'manual' || !apiLevelMatches(resolvedLevel, saved.level)) {
          throw new Error(
            `Сервер не сохранил ручной уровень «${resolvedLevel}» (на сервере: ${apiLevel || 'basic'}, режим: ${apiMode || 'авто'}). Задеплойте обновление: git pull && bash deploy/hetzner/deploy.sh`,
          )
        }
      }
      if (result.cardNum) {
        const nextKey = canonicalCardNum(result.cardNum)
        if (nextKey !== cardKey) {
          markCardLoyaltySaved(nextKey, {
            cardNum: nextKey,
            clientId: client.id,
            level: resolvedLevel,
            levelAssignMode: lockFields.levelAssignMode,
            levelValidUntil: lockFields.levelValidUntil ?? null,
            levelLockedPeriod: lockFields.levelLockedPeriod ?? null,
            vip: !!form.vip,
            debtEnabled: !!form.debtEnabled,
            debtLimit: resolvedDebtLimit,
            bonus: loyalty.bonus,
            debt: loyalty.debt,
          })
        }
        cardNum = result.cardNum
      }
    } catch (e) {
      console.error('saveCardLoyalty API failed', e)
      throw e instanceof Error ? e : new Error('Не удалось сохранить на сервер. Проверьте подключение и повторите.')
    }
  }

  emitCrmSync()
  void syncActiveStoreSessionFromPhone(phone)
}

/** Сброс статуса и VIP в начале нового месяца */
export function syncMonthlyLoyaltyReset(phone: string, cardNum?: string, orders?: Order[]): boolean {
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

  const oldPeriod = storedPeriod
  const period = currentLoyaltyPeriod()
  const assignMode = inferLevelAssignMode(card || {}, client)
  const levelValidUntil = card?.levelValidUntil || client?.levelValidUntil
  const untilExpired = !!(levelValidUntil && Date.now() > new Date(levelValidUntil).getTime())
  const manualLockMonth = !!(card?.levelLockedPeriod === oldPeriod || client?.levelLockedPeriod === oldPeriod)
  const account = client || undefined
  const { spent, orderCount } = orders?.length
    ? loyaltyStatsFromOrders(orders, phone, oldPeriod, account)
    : { spent: client?.spent || 0, orderCount: client?.orders || 0 }

  const curLevel = resolveMergedLoyaltyLevel(card || undefined, client || undefined)
  const stillManualLocked = assignMode === 'manual'
    && !untilExpired
    && !manualLockMonth
    && (levelValidUntil || card?.levelLockedPeriod || client?.levelLockedPeriod)

  let nextLevel: ClientLevel = 'basic'
  if (assignMode === 'manual' && stillManualLocked) {
    nextLevel = curLevel
  } else if (assignMode === 'manual' && (manualLockMonth || untilExpired)) {
    nextLevel = earnedLevelForPeriod(spent, orderCount)
  } else if (assignMode === 'auto') {
    nextLevel = 'basic'
  } else if (manualLockMonth) {
    nextLevel = earnedLevelForPeriod(spent, orderCount)
  }

  let nextVip = !!(card?.vip ?? client?.vip)
  const vipUntil = card?.vipUntil || client?.vipUntil
  if (vipUntil && Date.now() > new Date(vipUntil).getTime()) {
    nextVip = qualifiesAutoVip(spent, orderCount, 0)
  }

  const clearManualLock = manualLockMonth || untilExpired
  const patch = {
    level: nextLevel,
    loyaltyPeriod: period,
    levelLockedPeriod: clearManualLock ? undefined : (card?.levelLockedPeriod || client?.levelLockedPeriod),
    levelValidUntil: untilExpired ? undefined : levelValidUntil,
    levelAssignMode: (clearManualLock && assignMode === 'manual') ? 'auto' as const : assignMode,
    vip: nextVip,
    vipUntil: nextVip && vipUntil && Date.now() <= new Date(vipUntil).getTime() ? vipUntil : undefined,
  }

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
    const keepLevel = maxClientLevel(level, (card.level || 'basic') as ClientLevel)
    cardStore.updateCardLoyalty(card.num, { level: keepLevel, loyaltyPeriod: period })
  }
  if (client) {
    const keepLevel = maxClientLevel(level, (client.level || 'basic') as ClientLevel)
    clientStore.updateClient(client.id, {
      level: keepLevel,
      loyaltyPeriod: period,
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
