export type ReceiptLang = 'ru' | 'tg'

export type ReceiptTemplate = {
  lang: ReceiptLang
  storeName: string
  storeAddress: string
  storePhone: string
  /** Подпись под названием; пусто = из словаря */
  headerText: string
  /** «Спасибо…»; пусто = из словаря */
  footerThanks: string
  /** Нижняя подсказка; пусто = из словаря */
  footerNote: string
}

export type ReceiptLabels = {
  shopTag: string
  titleSale: string
  titleReturn: string
  titlePartial: string
  orderNo: string
  receiptNo: string
  date: string
  pos: string
  cashier: string
  shift: string
  client: string
  cardSuffix: string
  noItems: string
  goods: string
  discount: string
  bonus: string
  total: string
  payment: string
  cash: string
  cardPay: string
  credit: string
  cashReceived: string
  change: string
  bonusEarned: string
  note: string
  thanks: string
  keepReceipt: string
  payCash: string
  payCard: string
  payCredit: string
  payMixed: string
  returnedQty: string
  currency: string
}

export const RECEIPT_TEMPLATE_KEY = 'kakapo_trade_receipt_template'

export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = {
  lang: 'ru',
  storeName: 'KAKAPO',
  storeAddress: '',
  storePhone: '',
  headerText: '',
  footerThanks: '',
  footerNote: '',
}

const LABELS_RU: ReceiptLabels = {
  shopTag: 'магазин · касса',
  titleSale: 'ТОВАРНЫЙ ЧЕК',
  titleReturn: 'ВОЗВРАТНЫЙ ЧЕК',
  titlePartial: 'ЧЕК · ЧАСТИЧНЫЙ ВОЗВРАТ',
  orderNo: 'Номер заказа',
  receiptNo: 'Номер чека',
  date: 'Дата',
  pos: 'Касса',
  cashier: 'Кассир',
  shift: 'Смена',
  client: 'Клиент',
  cardSuffix: 'карта',
  noItems: 'Нет позиций',
  goods: 'Товары',
  discount: 'Скидка',
  bonus: 'Бонусами',
  total: 'ИТОГ',
  payment: 'Оплата',
  cash: 'Наличные',
  cardPay: 'Карта',
  credit: 'В долг',
  cashReceived: 'Дал клиент',
  change: 'Сдача',
  bonusEarned: 'Начислено бонусов',
  note: 'Примечание',
  thanks: 'Спасибо за покупку!',
  keepReceipt: 'Сохраняйте чек до проверки товара',
  payCash: 'Наличные',
  payCard: 'Карта',
  payCredit: 'В долг',
  payMixed: 'Смешанная',
  returnedQty: 'возврат',
  currency: 'сом',
}

const LABELS_TG: ReceiptLabels = {
  shopTag: 'мағоза · хазина',
  titleSale: 'ЧЕКИ МОЛ',
  titleReturn: 'ЧЕКИ БОЗГАШТ',
  titlePartial: 'ЧЕК · БОЗГАШТИ ҚИСМӢ',
  orderNo: 'Рақами фармоиш',
  receiptNo: 'Рақами чек',
  date: 'Сана',
  pos: 'Хазина',
  cashier: 'Хазинадор',
  shift: 'Навбат',
  client: 'Мизоҷ',
  cardSuffix: 'корт',
  noItems: 'Маҳсулот нест',
  goods: 'Молҳо',
  discount: 'Тахфиф',
  bonus: 'Бонусҳо',
  total: 'Ҷамъ',
  payment: 'Пардохт',
  cash: 'Нақд',
  cardPay: 'Корт',
  credit: 'Қарз',
  cashReceived: 'Дод мизоҷ',
  change: 'Бақия',
  bonusEarned: 'Бонусҳои ҳисобшуда',
  note: 'Эзоҳ',
  thanks: 'Ташаккур барои харид!',
  keepReceipt: 'Чекро то санҷиши мол нигоҳ доред',
  payCash: 'Нақд',
  payCard: 'Корт',
  payCredit: 'Қарз',
  payMixed: 'Омехта',
  returnedQty: 'бозгашт',
  currency: 'сом',
}

export function receiptLabels(lang: ReceiptLang): ReceiptLabels {
  return lang === 'tg' ? LABELS_TG : LABELS_RU
}

export function normalizeReceiptTemplate(raw: unknown): ReceiptTemplate {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReceiptTemplate>
  const lang: ReceiptLang = p.lang === 'tg' ? 'tg' : 'ru'
  return {
    lang,
    storeName: String(p.storeName ?? DEFAULT_RECEIPT_TEMPLATE.storeName).trim() || 'KAKAPO',
    storeAddress: String(p.storeAddress ?? '').trim(),
    storePhone: String(p.storePhone ?? '').trim(),
    headerText: String(p.headerText ?? '').trim(),
    footerThanks: String(p.footerThanks ?? '').trim(),
    footerNote: String(p.footerNote ?? '').trim(),
  }
}

export function loadReceiptTemplate(): ReceiptTemplate {
  if (typeof window === 'undefined') return { ...DEFAULT_RECEIPT_TEMPLATE }
  try {
    const raw = localStorage.getItem(RECEIPT_TEMPLATE_KEY)
    if (!raw) return { ...DEFAULT_RECEIPT_TEMPLATE }
    return normalizeReceiptTemplate(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_RECEIPT_TEMPLATE }
  }
}

export function saveReceiptTemplate(t: ReceiptTemplate) {
  if (typeof window === 'undefined') return
  localStorage.setItem(RECEIPT_TEMPLATE_KEY, JSON.stringify(normalizeReceiptTemplate(t)))
}

export function resolveReceiptTexts(template: ReceiptTemplate) {
  const labels = receiptLabels(template.lang)
  return {
    labels,
    storeName: template.storeName || 'KAKAPO',
    storeAddress: template.storeAddress,
    storePhone: template.storePhone,
    headerText: template.headerText || labels.shopTag,
    footerThanks: template.footerThanks || labels.thanks,
    footerNote: template.footerNote || labels.keepReceipt,
  }
}
