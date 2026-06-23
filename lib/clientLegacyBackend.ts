'use client'

import { api } from './api'
import { ensureArray } from './apiGuards'
import { phonesMatch, PURGED_NOTE, RECOVERY_NOTE_PREFIX, type AdminClient } from './clientCrm'
import type { AdminCard } from './cardCrm'

function findRemoteClient(clients: AdminClient[], clientId: string, phone?: string): AdminClient | undefined {
  return clients.find(c => c.id === clientId)
    || (phone ? clients.find(c => phonesMatch(c.phone, phone)) : undefined)
}

function linkedCards(client: AdminClient, cards: AdminCard[]): AdminCard[] {
  return cards.filter(c => {
    if (c.status === 'unlinked') return false
    if (c.clientId === client.id) return true
    if (client.card && c.num === client.card) return true
    if (client.phone && phonesMatch(c.phone || '', client.phone)) return true
    return false
  })
}

async function unlinkRemoteCards(client: AdminClient): Promise<void> {
  const cards = ensureArray<AdminCard>(await api.getCards().catch(() => []), 'cards')
  for (const card of linkedCards(client, cards)) {
    await api.updateCard(card.num, { unlink: true }).catch(() => {})
  }
}

/** Legacy backend: только GET + PATCH — полное «удаление» через анонимизацию */
export async function legacyPurgeClientOnServer(clientId: string, phone?: string): Promise<void> {
  const clients = ensureArray<AdminClient>(await api.getClients(), 'clients')
  const client = findRemoteClient(clients, clientId, phone)
  if (!client) return

  await unlinkRemoteCards(client)

  const anonPhone = `+0000000${client.id.replace(/\D/g, '').slice(-4) || '0000'}`
  await api.updateClient(client.id, {
    name: 'Удалён',
    phone: anonPhone,
    email: '',
    addr: '',
    card: '',
    blocked: true,
    note: PURGED_NOTE,
  })
}

/** Legacy backend: перевод в восстановление через note-маркер */
export async function legacyMoveToRecoveryOnServer(clientId: string, phone?: string): Promise<void> {
  const clients = ensureArray<AdminClient>(await api.getClients(), 'clients')
  const client = findRemoteClient(clients, clientId, phone)
  if (!client) throw new Error('Клиент не найден')

  await unlinkRemoteCards(client)

  const deletedAt = new Date().toISOString().slice(0, 10)
  await api.updateClient(client.id, {
    card: '',
    blocked: false,
    note: `${RECOVERY_NOTE_PREFIX} ${deletedAt}`,
  })
}

export async function legacyRestoreOnServer(clientId: string): Promise<void> {
  const clients = ensureArray<AdminClient>(await api.getClients(), 'clients')
  const client = clients.find(c => c.id === clientId)
  if (!client) throw new Error('Клиент не найден')

  const note = (client.note || '').replace(/^kakapo-recovery\s*\d{4}-\d{2}-\d{2}?\s*/i, '').trim()
  await api.updateClient(clientId, {
    blocked: false,
    note,
  })
}
