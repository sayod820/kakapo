'use client'

import { api } from './api'
import { USE_API } from './config'
import { type AdminClient } from './clientCrm'
import { cartSyncTimestamp, findSyncClient } from './clientCartSync'
import type { ClientSavedAddress } from './clientAddresses'

export type AddressBundle = {
  addresses: ClientSavedAddress[]
  addressesUpdatedAt?: string
}

function sanitizeAddresses(raw: unknown): ClientSavedAddress[] {
  if (!Array.isArray(raw)) return []
  const out: ClientSavedAddress[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    if (a.id == null) continue
    out.push({
      id: Number(a.id),
      label: String(a.label ?? ''),
      street: String(a.street ?? ''),
      apt: String(a.apt ?? ''),
      floor: String(a.floor ?? ''),
      ent: String(a.ent ?? ''),
      comment: String(a.comment ?? ''),
      def: !!a.def,
      lat: typeof a.lat === 'number' ? a.lat : undefined,
      lng: typeof a.lng === 'number' ? a.lng : undefined,
    })
  }
  // единственный адрес по умолчанию
  let seenDefault = false
  for (const a of out) {
    if (a.def && !seenDefault) seenDefault = true
    else if (a.def) a.def = false
  }
  if (!seenDefault && out.length) out[0].def = true
  return out
}

export function addressBundleFromClient(client?: AdminClient | null): AddressBundle {
  return {
    addresses: sanitizeAddresses(client?.addresses),
    addressesUpdatedAt: client?.addressesUpdatedAt,
  }
}

/** Последняя запись побеждает; при равном времени — объединение адресов с обоих устройств по id. */
export function mergeAddressData(local: AddressBundle, remote: AddressBundle): AddressBundle {
  const localTs = cartSyncTimestamp(local.addressesUpdatedAt)
  const remoteTs = cartSyncTimestamp(remote.addressesUpdatedAt)

  if (remoteTs > localTs) {
    return { addresses: sanitizeAddresses(remote.addresses), addressesUpdatedAt: remote.addressesUpdatedAt }
  }
  if (localTs > remoteTs) {
    return { addresses: sanitizeAddresses(local.addresses), addressesUpdatedAt: local.addressesUpdatedAt }
  }

  const localList = sanitizeAddresses(local.addresses)
  const remoteList = sanitizeAddresses(remote.addresses)
  if (!remoteList.length) return { addresses: localList, addressesUpdatedAt: local.addressesUpdatedAt || remote.addressesUpdatedAt }
  if (!localList.length) return { addresses: remoteList, addressesUpdatedAt: remote.addressesUpdatedAt || local.addressesUpdatedAt }

  const byId = new Map<number, ClientSavedAddress>()
  for (const a of localList) byId.set(a.id, a)
  for (const a of remoteList) if (!byId.has(a.id)) byId.set(a.id, a)
  const merged = sanitizeAddresses([...byId.values()])
  return { addresses: merged, addressesUpdatedAt: remote.addressesUpdatedAt || local.addressesUpdatedAt }
}

export async function fetchRemoteAddresses(phone: string, clientId?: string): Promise<AddressBundle> {
  if (!USE_API) return { addresses: [] }
  return addressBundleFromClient(await findSyncClient(phone, clientId))
}

export async function saveRemoteAddresses(
  clientId: string,
  addresses: ClientSavedAddress[],
  addressesUpdatedAt?: string,
): Promise<string> {
  const ts = addressesUpdatedAt || new Date().toISOString()
  if (!USE_API || !clientId) return ts
  await api.updateClient(clientId, {
    addresses: sanitizeAddresses(addresses),
    addressesUpdatedAt: ts,
  } as Partial<AdminClient>)
  return ts
}
