export type CourierWalletTxType = 'deposit' | 'commission' | 'refund'

export type CourierWalletTx = {
  id: string
  courierId: string
  type: CourierWalletTxType
  amount: number
  balanceAfter: number
  note?: string
  orderId?: string
  at: string
}

export type CourierWalletSnapshot = {
  courierId: string
  account: string
  balance: number
  transactions: CourierWalletTx[]
}

const LOCAL_TX_KEY = 'kakapo-courier-wallet-tx'

function loadLocalTx(): CourierWalletTx[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_TX_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveLocalTx(list: CourierWalletTx[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCAL_TX_KEY, JSON.stringify(list.slice(0, 500)))
  } catch { /* quota */ }
}

export function appendLocalCourierWalletTx(tx: CourierWalletTx) {
  const next = [tx, ...loadLocalTx()].slice(0, 500)
  saveLocalTx(next)
}

export function getLocalCourierWalletTransactions(courierId: string, limit = 30): CourierWalletTx[] {
  return loadLocalTx().filter(t => t.courierId === courierId).slice(0, limit)
}

export function formatWalletTxTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export function walletTxLabel(type: CourierWalletTxType): string {
  if (type === 'deposit') return 'Пополнение'
  if (type === 'commission') return 'Комиссия'
  return 'Возврат'
}
