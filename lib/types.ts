// ── ОБЩИЕ ТИПЫ ──────────────────────────────────
export type OrderStatus =
  | 'new' | 'assembling' | 'assembler_done'
  | 'courier_picked' | 'delivering' | 'delivered' | 'cancelled'
  | 'cooking' | 'ready'

export type OrderType = 'market' | 'restaurant' | 'mixed'

export interface OrderItem {
  id?: number
  product_id?: number
  art?: string
  e: string
  name: string
  qty: number
  unit: string
  price: number
  done?: boolean // для сборщика
  source?: 'market' | 'restaurant'
  restId?: string
}

export interface Order {
  id: string
  type: OrderType
  status: OrderStatus
  createdAt: string
  client: { name: string; phone: string; addr: string; lat?: number; lng?: number }
  courier?: { name: string; phone: string } | null
  assembler?: { name: string; id?: string } | null
  /** Команда сборщиков на одном заказе */
  assemblerTeam?: { name: string; id?: string }[]
  items: OrderItem[]
  total: number
  /** cash | card | credit (VIP-кредит: товары в долг, доставка наличными) */
  payment_method?: string
  pay?: string
  /** Сумма товаров, списанная в VIP-долг */
  creditAmount?: number
  comment?: string
  /** Заметка сборщика при изменении заказа */
  assemblerNote?: string
  priority?: 'normal' | 'urgent'
  restId?: string
  restIds?: string[]
  restName?: string
  pickupIds?: string[]
  distanceKm?: number
  deliveryFee?: number
  /** Зафиксированная стоимость доставки — не пересчитывается при смене тарифа */
  deliveryFeeLocked?: boolean
  durationMin?: number
  weightKg?: number
  /** Статус части магазина в смешанном заказе */
  marketStatus?: 'new' | 'assembling' | 'done'
  /** Статус части ресторана(ов) в смешанном заказе */
  restParts?: Record<string, 'new' | 'cooking' | 'done'>
  /** Точки забора, откуда курьер уже забрал (store, rest1, …) */
  pickedUpIds?: string[]
  /** Порядок точек забора, выбранный курьером */
  courierRoute?: string[]
  /** Время завершения доставки (HH:MM) */
  deliveredAt?: string
  /** ISO-дата создания заказа (для лояльности) */
  createdAtIso?: string
  /** ISO-дата доставки (для лояльности) */
  deliveredAtIso?: string
  /** Курьер на месте у клиента (перед подтверждением доставки) */
  courierAtClient?: boolean
  /** Причина отмены заказа */
  cancelReason?: string
  /** Списано бонусов при оформлении */
  bonusSpent?: number
  /** Начислено бонусов при доставке */
  bonusEarned?: number
  /** Бонусы уже начислены (идемпотентность) */
  bonusCredited?: boolean
  /** ID клиента на момент заказа (для разделения циклов аккаунта) */
  clientAccountId?: string
  /** Поколение аккаунта (1, 2, …) */
  accountGeneration?: number
  /** Выручка ресторану уже начислена */
  revenueCredited?: boolean
}

export type SellType = 'piece' | 'weight'

export interface Product {
  id: number
  art: string
  e: string
  name: string
  price: number
  /** Цена прихода / закупки (только админ, не для витрины) */
  costPrice?: number | null
  old?: number | null
  cat: string
  catId: string
  unit: string
  stock: number
  hot: boolean
  organic?: boolean
  discount?: number
  photo?: string
  desc?: string
  brand?: string
  country?: string
  barcode?: string
  /** piece — поштучно, weight — на развес (граммы в корзине) */
  sellType?: SellType
  /** Цена указана за столько грамм (1000 = за 1 кг) */
  unitGrams?: number
  /** Шаг добавления в корзину, г */
  weightStep?: number
  /** Минимальный заказ, г */
  minWeight?: number
  /** Оптовые цены: от minQty шт (или г) — цена за единицу */
  bulkPricing?: BulkPriceTier[]
}

export interface BulkPriceTier {
  minQty: number
  price: number
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
  blocked?: boolean
  rating: number
  reviews: number
  ordersMonth: number
  revenueMonth: number
  /** Валовая выручка, уже выплаченная частями в текущем периоде */
  paidRevenueMonth?: number
  img: string
  menu: MenuItem[]
}

export interface RestaurantPayout {
  id: number
  restId: string
  restName: string
  emoji?: string
  partial?: boolean
  revenueTotal?: number
  revenuePaid?: number
  revenue: number
  revenueRemaining?: number
  orders?: number
  commission: number
  commissionPct: number
  amount: number
  netRemaining?: number
  paidNetBefore?: number
  paidGrossBefore?: number
  method: string
  note?: string
  date: string
  createdAt?: string
}

export interface Review {
  id: number
  restId: string
  restName?: string
  orderId?: string
  client: string
  rating: number
  text: string
  date: string
  status: 'new' | 'read'
  restSeen?: boolean
  restNotified?: boolean
  urgent?: boolean
  adminReply?: string
  restReply?: string
  createdAt?: string
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
  num?: string
  week?: number
  maxActiveOrders?: number
  blocked?: boolean
  otp?: string
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

export type PromoType = 'pct' | 'free' | 'first' | 'fixed' | 'product'

export interface Promo {
  id: number
  e: string
  title: string
  sub: string
  disc: number
  on: boolean
  cat: 'Магазин' | 'Рестораны'
  type?: PromoType
  from?: string
  to?: string
  till?: string
  /** Скидка на конкретный товар (type === 'product') */
  productId?: number
  salePrice?: number
  oldPrice?: number
  /** always | daily (часы) | flash (до даты) */
  scheduleMode?: 'always' | 'daily' | 'flash'
  startsAt?: string
  endsAt?: string
