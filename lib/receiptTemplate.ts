export type ReceiptLang = 'ru' | 'tg'
export type ReceiptAlign = 'left' | 'center'
export type ReceiptSeparator = 'dotted' | 'solid' | 'dashed'
export type ReceiptFont = 'arial' | 'arial-narrow' | 'tahoma' | 'verdana' | 'times' | 'courier'
export type ReceiptFontWeight = 'normal' | 'medium' | 'bold' | 'black'

export type ReceiptTemplate = {
  schemaVersion: 2
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
  /** Масштаб всех шрифтов: 80–140% */
  fontScale: number
  fontFamily: ReceiptFont
  /** Жирность основного текста */
  fontWeight: ReceiptFontWeight
  /** Межстрочный интервал 110–160 (%) */
  lineHeightPct: number
  /** Межбуквенный интервал 0–80 (×0.01em) */
  letterSpacing: number
  /** Поля контейнера 0–6 мм — 0 = от края до края */
  paddingMm: number
  /** Ширина контента 88–100% ленты */
  contentWidthPct: number
  /** Плотность растровой печати: 1–5 */
  printDensity: number
  /** text = нативный шрифт принтера (чётко), raster = как предпросмотр */
  printMode: 'text' | 'raster'
  storeAlign: ReceiptAlign
  titleAlign: ReceiptAlign
  footerAlign: ReceiptAlign
  separatorStyle: ReceiptSeparator
  /** Чёрная плашка с белым названием чека */
  titleInverted: boolean
  shopUppercase: boolean
  titleUppercase: boolean
  valuesBold: boolean
  compact: boolean
  showCustomer: boolean
  showCashier: boolean
  showFooter: boolean
  showPhone: boolean
  showAddress: boolean
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

export const RECEIPT_FONT_OPTIONS: { id: ReceiptFont; label: string }[] = [
  { id: 'arial', label: 'Arial — стандартный' },
  { id: 'arial-narrow', label: 'Arial Narrow — узкий' },
  { id: 'tahoma', label: 'Tahoma — чёткий' },
  { id: 'verdana', label: 'Verdana — широкий' },
  { id: 'times', label: 'Times New Roman' },
  { id: 'courier', label: 'Courier New — кассовый' },
]

export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = {
  schemaVersion: 2,
  lang: 'ru',
  storeName: 'KAKAPO',
  storeAddress: '',
  storePhone: '',
  headerText: '',
  footerThanks: '',
  footerNote: '',
  fontScale: 100,
  fontFamily: 'arial',
  fontWeight: 'bold',
  lineHeightPct: 135,
  letterSpacing: 0,
  paddingMm: 1,
  contentWidthPct: 100,
  printDensity: 2,
  printMode: 'raster',
  storeAlign: 'center',
  titleAlign: 'center',
  footerAlign: 'center',
  separatorStyle: 'dotted',
  titleInverted: true,
  shopUppercase: true,
  titleUppercase: true,
  valuesBold: true,
  compact: false,
  showCustomer: true,
  showCashier: true,
  showFooter: true,
  showPhone: true,
  showAddress: true,
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

function asFont(v: unknown): ReceiptFont {
  return (
    v === 'arial-narrow'
    || v === 'tahoma'
    || v === 'verdana'
    || v === 'times'
    || v === 'courier'
  ) ? v : 'arial'
}

function asWeight(v: unknown): ReceiptFontWeight {
  return (
    v === 'normal'
    || v === 'medium'
    || v === 'bold'
    || v === 'black'
  ) ? v : 'bold'
}

function asAlign(v: unknown): ReceiptAlign {
  return v === 'left' ? 'left' : 'center'
}

function asSep(v: unknown): ReceiptSeparator {
  return v === 'solid' || v === 'dashed' ? v : 'dotted'
}

export function normalizeReceiptTemplate(raw: unknown): ReceiptTemplate {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReceiptTemplate>
  const legacy = p.schemaVersion !== 2
  const lang: ReceiptLang = p.lang === 'tg' ? 'tg' : 'ru'
  return {
    schemaVersion: 2,
    lang,
    storeName: String(p.storeName ?? DEFAULT_RECEIPT_TEMPLATE.storeName).trim() || 'KAKAPO',
    storeAddress: String(p.storeAddress ?? '').trim(),
    storePhone: String(p.storePhone ?? '').trim(),
    headerText: String(p.headerText ?? '').trim(),
    footerThanks: String(p.footerThanks ?? '').trim(),
    footerNote: String(p.footerNote ?? '').trim(),
    fontScale: Math.max(80, Math.min(140, Math.round(Number(p.fontScale) || 100))),
    fontFamily: asFont(p.fontFamily),
    fontWeight: asWeight(p.fontWeight),
    lineHeightPct: Math.max(110, Math.min(160, Math.round(Number(p.lineHeightPct) || 135))),
    letterSpacing: Math.max(0, Math.min(80, Math.round(Number(p.letterSpacing) || 0))),
    paddingMm: Math.max(0, Math.min(6, Math.round((Number(p.paddingMm ?? DEFAULT_RECEIPT_TEMPLATE.paddingMm)) * 10) / 10 || 0)),
    contentWidthPct: Math.max(88, Math.min(100, Math.round(Number(p.contentWidthPct ?? DEFAULT_RECEIPT_TEMPLATE.contentWidthPct) || 100))),
    printDensity: Math.max(1, Math.min(5, Math.round(Number(legacy ? 2 : p.printDensity) || 2))),
    printMode: legacy ? 'raster' : (p.printMode === 'text' ? 'text' : 'raster'),
    storeAlign: asAlign(p.storeAlign),
    titleAlign: asAlign(p.titleAlign),
    footerAlign: asAlign(p.footerAlign),
    separatorStyle: asSep(p.separatorStyle),
    titleInverted: legacy ? true : p.titleInverted !== false,
    shopUppercase: p.shopUppercase !== false,
    titleUppercase: p.titleUppercase !== false,
    valuesBold: p.valuesBold !== false,
    compact: p.compact === true,
    showCustomer: p.showCustomer !== false,
    showCashier: p.showCashier !== false,
    showFooter: p.showFooter !== false,
    showPhone: p.showPhone !== false,
    showAddress: p.showAddress !== false,
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

export function receiptFontCss(font: ReceiptFont) {
  if (font === 'arial-narrow') return "'Arial Narrow','Roboto Condensed',Arial,sans-serif"
  if (font === 'tahoma') return 'Tahoma,Arial,sans-serif'
  if (font === 'verdana') return 'Verdana,Arial,sans-serif'
  if (font === 'times') return "'Times New Roman',Times,serif"
  if (font === 'courier') return "'Courier New',Courier,monospace"
  return "Arial,'Helvetica Neue',sans-serif"
}

export function receiptWeightCss(weight: ReceiptFontWeight) {
  if (weight === 'normal') return { base: 500, strong: 700, black: 800 }
  if (weight === 'medium') return { base: 600, strong: 800, black: 900 }
  if (weight === 'black') return { base: 800, strong: 900, black: 900 }
  return { base: 700, strong: 800, black: 900 }
}
