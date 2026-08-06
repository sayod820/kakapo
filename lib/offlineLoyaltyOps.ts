// ════════════════════════════════════════════════
// KAKAPO — долг / лояльность офлайн (Offline V2)
// Ручная правка долга в DebtsModule: локально + очередь.
// Выдача новой карты без связи — недоступна.
// ════════════════════════════════════════════════
import { isNetworkError, NetworkError } from './api'
import {
  cardLoyaltyFromCard,
  type AdminCard,
  type CardLoyaltyForm,
} from './cardCrm'
import type { AdminClient } from './clientCrm'
import { provisionLoyaltyCardForClient, saveCardLoyalty } from './clientCardSync'
import { recordStoreDebtCharge, recordStoreDebtRepayment } from './clientVipCredit'
import { useCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { cacheData, newClientRef } from './offline'
import { isOfflineV2Full, shadowMirrorPut } from './offlineV2'
import { useOfflineSync } from './offlineSync'

const FAST_MS = 1600

export interface OfflineResult<T> {
  offline: boolean
  data: T
}

async function raceOp<T>(
  apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  try {
    const data = await Promise.race([
      apiCall(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new NetworkError('Медленная связь — долг сохранён локально')),
          FAST_MS,
        )
      }),
    ])
    return { offline: false, data }
  } catch (e) {
    if (!isNetworkError(e)) throw e
    const data = await localApply()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }
}

function persistClientsAndCards() {
  void cacheData('clients', useClientStore.getState().clients)
  void cacheData('cards', useCardStore.getState().cards)
}

function findCardForClient(client: AdminClient, cards: AdminCard[]): AdminCard | undefined {
  if (client.card) {
    const byNum = cards.find(c => String(c.num).replace(/\s/g, '') === String(client.card).replace(/\s/g, ''))
    if (byNum) return byNum
  }
  return cards.find(c => c.clientId === client.id)
}

/** Сохранить лояльность/долг. При V2=on — без сети (если карта уже есть). */
export async function saveCardLoyaltySafe(
  card: AdminCard,
  form: CardLoyaltyForm,
  mode: 'link' | 'edit',
  opts?: { skipDebtHistory?: boolean },
): Promise<OfflineResult<void>> {
  if (!isOfflineV2Full()) {
    await saveCardLoyalty(card, form, mode, opts)
    return { offline: false, data: undefined }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    const prevDebt = Math.max(0, Number(card.debt) || 0)
    const nextDebt = Math.max(0, Number(form.debt) || 0)
    const phone = (form.phone || card.phone || '').trim()

    const patch = {
      debt: nextDebt,
      debtEnabled: nextDebt > 0.001 ? true : !!form.debtEnabled,
      debtLimit: Math.max(0, Number(form.debtLimit) || 0),
      bonus: Math.max(0, Number(form.bonus) || 0),
      level: form.level,
      vip: !!form.vip,
      allowBonusDecrease: true as const,
    }
    useCardStore.getState().updateCardLoyalty(card.num, patch as any, { skipApi: true })
    if (form.clientId) {
      useClientStore.getState().updateClient(form.clientId, {
        debt: patch.debt,
        debtEnabled: patch.debtEnabled,
        debtLimit: patch.debtLimit,
        bonus: patch.bonus,
        level: form.level,
        vip: !!form.vip,
      }, { skipApi: true })
    }

    if (mode === 'edit' && !opts?.skipDebtHistory && phone) {
      if (nextDebt < prevDebt - 0.001) recordStoreDebtRepayment(phone, prevDebt - nextDebt)
      else if (nextDebt > prevDebt + 0.001) recordStoreDebtCharge(phone, nextDebt - prevDebt)
    }

    await useOfflineSync.getState().queueOp(
      'card_loyalty_patch',
      {
        clientRef,
        num: card.num,
        clientId: form.clientId,
        debt: patch.debt,
        debtEnabled: patch.debtEnabled,
        debtLimit: patch.debtLimit,
        bonus: patch.bonus,
        level: form.level,
        vip: !!form.vip,
        cardPatch: patch,
        clientPatch: {
          debt: patch.debt,
          debtEnabled: patch.debtEnabled,
          debtLimit: patch.debtLimit,
          bonus: patch.bonus,
          level: form.level,
          vip: !!form.vip,
        },
      },
      { clientRef },
    )
    persistClientsAndCards()
    if (form.clientId) {
      const c = useClientStore.getState().clients.find(x => x.id === form.clientId)
      if (c) shadowMirrorPut('client', c.id, c)
    }
  }

  return raceOp(async () => {
    await saveCardLoyalty(card, form, mode, opts)
  }, applyLocal)
}

/** Удобная обёртка для DebtsModule: погасить / начислить долг. */
export async function adjustClientDebtSafe(
  client: AdminClient,
  input: {
    action: 'repay' | 'charge'
    amount: number
    skipDebtHistory?: boolean
    /** Абсолютный долг (для sync из истории) — вместо action/amount */
    absoluteDebt?: number
  },
): Promise<OfflineResult<{ debt: number }>> {
  let card = findCardForClient(client, useCardStore.getState().cards) || null

  if (!card) {
    if (isOfflineV2Full()) {
      throw new Error('Нет карты лояльности — выдача карты нужна при связи')
    }
    const updated = await provisionLoyaltyCardForClient(client)
    card = findCardForClient(updated, useCardStore.getState().cards) || null
  }
  if (!card) throw new Error('Не удалось получить карту лояльности')

  const fresh = useClientStore.getState().clients.find(c => c.id === client.id) || client
  const prevDebt = Math.max(0, Number(fresh.debt) || 0, Number(card.debt) || 0)
  let nextDebt: number
  if (input.absoluteDebt != null) {
    nextDebt = Math.max(0, Math.round(Number(input.absoluteDebt) * 100) / 100)
  } else {
    const amount = Math.max(0, Number(input.amount) || 0)
    nextDebt = input.action === 'repay'
      ? Math.max(0, Math.round((prevDebt - amount) * 100) / 100)
      : Math.round((prevDebt + amount) * 100) / 100
  }

  const base = cardLoyaltyFromCard(card, fresh)
  const res = await saveCardLoyaltySafe(
    card,
    {
      ...base,
      debt: nextDebt,
      ...(nextDebt > 0.001 ? { debtEnabled: true } : {}),
      clientId: fresh.id,
      phone: fresh.phone,
    },
    'edit',
    { skipDebtHistory: input.skipDebtHistory },
  )
  return { offline: res.offline, data: { debt: nextDebt } }
}
