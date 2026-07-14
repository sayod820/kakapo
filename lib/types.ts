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
  /** Сумма товаров без доставки (если задана явно при оформлении) */
  goodsTotal?: number
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
  /** Канал оформления: pos = покупка на кассе */
  channel?: 'pos' | 'app' | 'admin' | string
  /** Связь с чеком кассы */
  posSaleId?: string
  posSaleNumber?: number
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
  /** Все штрихкоды одного товара (включая основной) */
  barcodes?: string[]
  /** PLU-код для весов (1–9999) */
  plu?: string
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

export interface Category {
  id: number
  name: string
  slug: string
  parent_id: number | null
  emoji?: string
  desc?: string
  order?: number
  active?: boolean
}

export interface PosPoint {
  id: string
  /** Название точки, напр. «Магазин · Ленина 42» */
  name: string
  /** Подпись, напр. «Касса №1 · KAKAPO» */
  code?: string
  note?: string
  active: boolean
  createdAtIso?: string
}

export interface PosCashier {
  id: string
  name: string
  pin: string
  active: boolean
  salesCount: number
  salesTotal: number
  createdAtIso?: string
}

export interface PosShift {
  id: string
  /** К какой точке продаж относится смена */
  posId?: string
  cashierId: string
  cashierName: string
  openedAtIso: string
  closedAtIso?: string | null
  openingCash: number
  closingCash?: number | null
  /** Ожидаемые наличные при закрытии (старт + продаж нал − расходы) */
  expectedCash?: number | null
  /** Фактический пересчёт кассира */
  actualCash?: number | null
  /** fact − expected */
  cashDiff?: number | null
  salesCash: number
  salesCard: number
  salesCredit: number
  salesCount: number
  expenseTotal: number
  /** Внесения наличных в смену (не продажи) */
  cashInTotal?: number
  status: 'open' | 'closed'
  note?: string
}

/** Вклад в кассу / снятие денег владельцем */
export interface FinanceMove {
  id: string
  type: 'deposit' | 'withdraw'
  amount: number
  note?: string
  createdBy?: string
  createdAtIso: string
  shiftId?: string
  posId?: string
  supplierId?: string
  supplierName?: string
}

/** Запись audit / денежного журнала (источник правды) */
export interface MoneyLedgerEntry {
  id: string
  createdAtIso: string
  type: string
  amount: number
  direction: 'in' | 'out' | 'info'
  signedAmount: number
  cashAffect: boolean
  posId?: string
  shiftId?: string
  cashierId?: string
  cashierName?: string
  refType?: string
  refId?: string
  note?: string
  reason?: string
  meta?: Record<string, unknown>
  balanceAfter?: number
}

export interface FinanceTruthBundle {
  cashBook: {
    balance: number
    entries: MoneyLedgerEntry[]
    days: { day: string; inflow: number; outflow: number; net: number; count: number }[]
    summary: { inflow: number; outflow: number; count: number }
  }
  expectedVsActual: {
    threshold: number
    rows: {
      shiftId: string
      posId: string
      cashierId: string
      cashierName: string
      openedAtIso?: string
      closedAtIso?: string
      openingCash: number
      salesCash: number
      expenseTotal: number
      expectedCash: number
      actualCash: number
      cashDiff: number
      alert: boolean
      day: string
    }[]
    summary: {
      shifts: number
      withAlert: number
      absDiffSum: number
      shortCount: number
      overCount: number
    }
  }
  profit: {
    summary: {
      revenue: number
      cogs: number
      profit: number
      marginPct: number
      salesCount: number
    }
    products: {
      productId: number
      productName: string
      qty: number
      revenue: number
      cogs: number
      profit: number
    }[]
  }
  journal: MoneyLedgerEntry[]
  alerts: {
    threshold: number
    alerts: {
      id: string
      kind: string
      severity: string
      title: string
      message: string
      amount: number
      atIso?: string
      posId?: string
      shiftId?: string
      cashierName?: string
    }[]
    count: number
  }
  generatedAtIso: string
}

export interface PosSupplier {
  id: string
  name: string
  category?: string
  phone?: string
  address?: string
  note?: string
  payableAmount: number
  totalSupplied: number
  totalPaid: number
  lastDeliveryAtIso?: string | null
}

export interface SupplierPayment {
  id: string
  supplierId: string
  supplierName: string
  amount: number
  paidAtIso: string
  note?: string
}

export interface PosExpense {
  id: string
  category: string
  amount: number
  note?: string
  createdBy?: string
  createdAtIso: string
  shiftId?: string
}

export interface StockReceiptItem {
  productId: number
  productName: string
  qty: number
  remainingQty: number
  costPrice: number
  retailPrice?: number
  bulkPricing?: BulkPriceTier[]
  expiryDate?: string | null
}

export interface ProductStockLayer {
  receiptId: string
  productId: number
  productName: string
  qty: number
  remainingQty: number
  costPrice: number
  retailPrice: number
  bulkPricing: BulkPriceTier[]
  expiryDate?: string | null
  createdAtIso: string
  supplierName?: string
  queueIndex: number
  isActive: boolean
}

export interface StockReceipt {
  id: string
  supplierId?: string | null
  supplierName?: string
  createdAtIso: string
  createdBy?: string
  totalCost: number
  paidNow: number
  debtAdded: number
  items: StockReceiptItem[]
}

export interface StockWriteoffItem {
  productId: number
  productName: string
  qty: number
  unitCost?: number
  lineCost?: number
}

export interface StockWriteoff {
  id: string
  createdAtIso: string
  createdBy?: string
  reason: string
  note?: string
  totalCost: number
  items: StockWriteoffItem[]
}

export interface StockRevisionItem {
  productId: number
  productName: string
  systemStock: number
  countedStock: number
  diff: number
}

export interface StockRevision {
  id: string
  createdAtIso: string
  createdBy?: string
  note?: string
  items: StockRevisionItem[]
}

export interface PosSaleItem {
  productId: number
  productName: string
  qty: number
  price: number
  lineTotal: number
  /** Партия прихода, с которой списали (если кассир выбрал вручную) */
  receiptId?: string
  unitCost?: number
  lineCost?: number
  /** Сколько уже возвращено по этой позиции */
  returnedQty?: number
}

export interface PosSaleReturnLine {
  productId: number
  productName?: string
  qty: number
  price: number
  lineTotal: number
}

export interface PosSaleReturn {
  atIso: string
  total: number
  cutCash?: number
  cutCard?: number
  cutDebt?: number
  note?: string
  cashierId?: string
  items: PosSaleReturnLine[]
}

export interface PosSale {
  id: string
  /** Сквозной номер чека (№1, №2…) */
  number?: number
  createdAtIso: string
  cashierId?: string
  cashierName?: string
  shiftId?: string
  clientId?: string
  clientName?: string
  clientPhone?: string
  cardNum?: string
  paymentMethod: 'cash' | 'card' | 'credit' | 'mixed'
  total: number
  paidCash: number
  paidCard: number
  debtAdded: number
  /** Точка продаж, с которой проведён чек */
  posId?: string
  /** Сколько наличных дал клиент (до сдачи) */
  cashReceived?: number
  /** Сдача клиенту */
  changeGiven?: number
  note?: string
  orderId?: string
  items: PosSaleItem[]
  status?: 'sold' | 'partial' | 'returned'
  originalTotal?: number
  lastReturnTotal?: number
  returns?: PosSaleReturn[]
  returnedAtIso?: string
  returnNote?: string
  returnedByCashierId?: string
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
  productKey?: string
  productId?: number | string
  productName?: string
  targetType?: 'product' | 'market' | 'restaurant'
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
  /** Лимит по акции: штуки или граммы (0/пусто = без лимита) */
  stockLimit?: number
  /** Единица лимита при сохранении: grams = кг в админке ×1000, pieces = шт */
  stockLimitUnit?: 'grams' | 'pieces'
  /** Продано по акции — обновляется при заказах */
  stockSold?: number
  markHot?: boolean
}
