/**
 * Постоянный код этого аппарата + привязка к точке продаж.
 * Не MAC и не IP: один раз записали на диск и не меняем.
 */
import { isKakapoDesktop } from './desktopBridge'
import { getLocalDb } from './localDbClient'

const LS_DEVICE = 'kakapo_trade_device_id'
const LS_BIND = 'kakapo_trade_device_bind'
const KV_DEVICE = 'trade_device_id'
const KV_BIND = 'trade_device_bind'

export type TradeDeviceBind = {
  deviceId: string
  deviceName: string
  posId: string
  posName: string
  boundAtIso: string
}

let deviceIdMem = ''
let bindMem: TradeDeviceBind | null | undefined
let ready: Promise<void> | null = null

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function guessDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Устройство'
  const ua = navigator.userAgent || ''
  if (/Android/i.test(ua)) return 'Телефон Android'
  if (/iPhone|iPad/i.test(ua)) return 'iPhone'
  if (isKakapoDesktop()) return 'ПК касса'
  return 'Браузер'
}

function readLs(key: string): string {
  if (typeof window === 'undefined') return ''
  try { return String(localStorage.getItem(key) || '') } catch { return '' }
}

function writeLs(key: string, value: string) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, value) } catch { /* quota */ }
}

export function ensureTradeDeviceReady(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    const desk = getLocalDb()
    let id = ''
    if (desk?.localDbKvGet) {
      try { id = String((await desk.localDbKvGet(KV_DEVICE)) || '') } catch { /* ignore */ }
    }
    if (!id) id = readLs(LS_DEVICE)
    if (!id) id = newId()
    deviceIdMem = id
    writeLs(LS_DEVICE, id)
    if (desk?.localDbKvSet) {
      try { await desk.localDbKvSet(KV_DEVICE, id) } catch { /* ignore */ }
    }

    let bind: TradeDeviceBind | null = null
    if (desk?.localDbKvGet) {
      try {
        const raw = await desk.localDbKvGet(KV_BIND)
        if (raw && typeof raw === 'object') bind = raw as TradeDeviceBind
      } catch { /* ignore */ }
    }
    if (!bind) {
      try {
        const raw = readLs(LS_BIND)
        bind = raw ? JSON.parse(raw) as TradeDeviceBind : null
      } catch { bind = null }
    }
    if (bind && bind.deviceId !== id) bind = null
    bindMem = bind
  })()
  return ready
}

export function getTradeDeviceIdSync(): string {
  return deviceIdMem || readLs(LS_DEVICE)
}

export function getTradeDeviceBindSync(): TradeDeviceBind | null {
  if (bindMem !== undefined) return bindMem
  try {
    const raw = readLs(LS_BIND)
    return raw ? JSON.parse(raw) as TradeDeviceBind : null
  } catch {
    return null
  }
}

export function getBoundPosIdSync(): string {
  return String(getTradeDeviceBindSync()?.posId || '')
}

export function getBoundDeviceNameSync(): string {
  return String(getTradeDeviceBindSync()?.deviceName || '').trim()
}

export async function saveTradeDeviceBind(bind: TradeDeviceBind): Promise<void> {
  bindMem = bind
  writeLs(LS_BIND, JSON.stringify(bind))
  const desk = getLocalDb()
  if (desk?.localDbKvSet) {
    try { await desk.localDbKvSet(KV_BIND, bind) } catch { /* ignore */ }
  }
}

export async function clearTradeDeviceBind(): Promise<void> {
  bindMem = null
  if (typeof window !== 'undefined') {
    try { localStorage.removeItem(LS_BIND) } catch { /* ignore */ }
  }
  const desk = getLocalDb()
  if (desk?.localDbKvDelete) {
    try { await desk.localDbKvDelete(KV_BIND) } catch { /* ignore */ }
  }
}

export function defaultDeviceName(): string {
  return guessDeviceName()
}

if (typeof window !== 'undefined') void ensureTradeDeviceReady()
