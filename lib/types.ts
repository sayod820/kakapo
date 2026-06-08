// ── ОБЩИЕ ТИПЫ ──────────────────────────────────
export type OrderStatus =
  | 'new' | 'assembling' | 'assembler_done'
  | 'courier_picked' | 'delivering' | 'delivered' | 'cancelled'
  | 'cooking' | 'ready'

export type OrderType = 'market' | 'restaurant'

export interface OrderItem {
  id: number
  art?: string
  e: string
  name: string
  qty: number
  unit: string
  price: number
  done?: boolean // для сборщика
}

export interface Order {
  id: string
  type: OrderType
  status: OrderStatus
  createdAt: string
  client: { name: string; phone: string; addr: string }
  courier?: { name: string; phone: string } | null
  assembler?: { name: string } | null
  items: OrderItem[]
  total: number
  comment?: string
  priority?: 'normal' | 'urgent'
  restId?: string
  restName?: string
}

export interface Product {
  id: number
  art: string
  e: string
  name: string
  price: number
  old?: number | null
  cat: string
  catId: string
  unit: string
  stock: number
  hot: boolean
  organic?: boolean
  discount?: number
  photo?: string
}

export interface Restaurant {
  id: string
  name: string
  emoji: string
  cuisine: string
  address: string
  phone: string
  email: string
  commission: number
  open: boolean
  rating: number
  reviews: number
  ordersMonth: number
  revenueMonth: number
  img: string
  menu: MenuItem[]
}

export interface MenuItem {
  id: number
  cat: string
  e: string
  name: string
  desc?: string
  price: number
  inStock: boolean
  popular?: boolean
  photo?: string
}

export interface Courier {
  id: string
  name: string
  phone: string
  vehicle: string
  status: 'available' | 'busy' | 'offline'
  rating: number
  orders: number
  today: number
}

export interface Assembler {
  id: string
  name: string
  phone: string
  status: 'working' | 'available' | 'offline'
  ordersToday: number
  rating: number
}

export interface Client {
  id: string
  name: string
  phone: string
  card: string
  level: 'bronze' | 'silver' | 'gold' | 'platinum'
  orders: number
  spent: number
  debt: number
  bonus: number
}
