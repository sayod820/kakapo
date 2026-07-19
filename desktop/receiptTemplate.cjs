'use strict'

/**
 * Полный шаблон чека 58 мм.
 * Превью редактора и ESC/POS печать используют одни и те же поля стиля.
 */

const DEFAULT_RECEIPT_TEMPLATE = {
  // Базовый шрифт тела чека. small = Font B (42 симв.), normal = Font A (32 симв.)
  printFont: 'normal',
  charsPerLine: 32,
  lineSpacing: 24,

  // Размер отдельных блоков: small | normal | tall (tall = выше, без уширения)
  sizeStoreName: 'tall',
  sizeSubtitle: 'small',
  sizePhone: 'normal',
  sizeDocTitle: 'normal',
  sizeBody: 'normal',
  sizeItems: 'normal',
  sizeTotal: 'tall',
  sizeFooter: 'small',

  // Жирный / обычный
  boldStoreName: true,
  boldSubtitle: false,
  boldPhone: false,
  boldDocTitle: true,
  boldBody: false,
  boldItems: false,
  boldTotal: true,
  boldChange: true,
  boldFooterThanks: true,
  boldFooterNote: false,

  storeName: 'КАКАПО',
  storePhone: '+992 112 373 333',
  subtitle: '',
  docTitle: 'ТОВАРНЫЙ ЧЕК',
  docTitleReturn: 'ВОЗВРАТНЫЙ ЧЕК',
  docTitlePartial: 'ЧЕК - ЧАСТИЧНЫЙ ВОЗВРАТ',
  currency: 'сом',

  labelOrderNo: 'Номер заказа',
  labelReceiptNo: 'Номер чека',
  labelDate: 'Дата',
  labelPos: 'Касса',
  labelCashier: 'Кассир',
  labelClient: 'Клиент',
  labelClientPhone: 'Тел. клиента',
  labelSum: 'Сумма',
  labelDiscount: 'Скидка',
  labelBonusEarned: 'Начислено бонусов',
  labelBonusSpent: 'Списано бонусов',
  labelTotal: 'ИТОГ',
  labelPay: 'Оплата',
  labelCash: 'Наличные',
  labelCard: 'Картой',
  labelDebt: 'В долг',
  labelCashGiven: 'Дал клиент',
  labelChange: 'Сдача',
  labelBonusBalance: 'Баланс бонусов',

  footerThanks: 'Спасибо за покупку!',
  footerNote: 'Сохраняйте чек до проверки товара',

  showStoreName: true,
  showSubtitle: false,
  showStorePhone: true,
  showDocTitle: true,
  showItems: true,
  showSubtotal: true,
  showFooterThanks: true,
  showFooterNote: true,
  showOrderNo: true,
  showReceiptNo: true,
  showDate: true,
  showPos: true,
  showCashier: true,
  showClient: true,
  showClientPhone: true,
  showDiscount: true,
  showBonusEarned: true,
  showBonusSpent: true,
  showBonusBalance: true,
  showPay: true,
  showCash: true,
  showCard: true,
  showDebt: true,
  showCashGiven: true,
  showChange: true,
}

function asBool(v, fallback) {
  if (typeof v === 'boolean') return v
  if (v === 0 || v === '0' || v === 'false') return false
  if (v === 1 || v === '1' || v === 'true') return true
  return fallback
}

function asStr(v, fallback) {
  const s = String(v == null ? '' : v).trim()
  return s || fallback
}

function asInt(v, fallback, min, max) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function asSize(v, fallback) {
  return ['small', 'normal', 'tall'].includes(v) ? v : fallback
}

function asFont(v, fallback) {
  // large → normal (старые шаблоны); без double-width
  if (v === 'large') return 'normal'
  return ['small', 'normal'].includes(v) ? v : fallback
}

/** Ширина строки в символах для XP-58C. */
function charsPerLineFor(printFont) {
  return printFont === 'small' ? 42 : 32
}

function normalizeReceiptTemplate(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const d = DEFAULT_RECEIPT_TEMPLATE
  const printFont = asFont(p.printFont, d.printFont)
  const charsPerLine = charsPerLineFor(printFont)
  return {
    printFont,
    charsPerLine,
    lineSpacing: asInt(p.lineSpacing, d.lineSpacing, 16, 64),

    sizeStoreName: asSize(p.sizeStoreName, d.sizeStoreName),
    sizeSubtitle: asSize(p.sizeSubtitle, d.sizeSubtitle),
    sizePhone: asSize(p.sizePhone, d.sizePhone),
    sizeDocTitle: asSize(p.sizeDocTitle, d.sizeDocTitle),
    sizeBody: asSize(p.sizeBody, d.sizeBody),
    sizeItems: asSize(p.sizeItems, d.sizeItems),
    sizeTotal: asSize(p.sizeTotal, d.sizeTotal),
    sizeFooter: asSize(p.sizeFooter, d.sizeFooter),

    boldStoreName: asBool(p.boldStoreName, d.boldStoreName),
    boldSubtitle: asBool(p.boldSubtitle, d.boldSubtitle),
    boldPhone: asBool(p.boldPhone, d.boldPhone),
    boldDocTitle: asBool(p.boldDocTitle, d.boldDocTitle),
    boldBody: asBool(p.boldBody, d.boldBody),
    boldItems: asBool(p.boldItems, d.boldItems),
    boldTotal: asBool(p.boldTotal, d.boldTotal),
    boldChange: asBool(p.boldChange, d.boldChange),
    boldFooterThanks: asBool(p.boldFooterThanks, d.boldFooterThanks),
    boldFooterNote: asBool(p.boldFooterNote, d.boldFooterNote),

    storeName: asStr(p.storeName, d.storeName),
    storePhone: String(p.storePhone != null ? p.storePhone : d.storePhone).trim(),
    subtitle: String(p.subtitle != null ? p.subtitle : d.subtitle).trim(),
    docTitle: asStr(p.docTitle, d.docTitle),
    docTitleReturn: asStr(p.docTitleReturn, d.docTitleReturn),
    docTitlePartial: asStr(p.docTitlePartial, d.docTitlePartial),
    currency: asStr(p.currency, d.currency),

    labelOrderNo: asStr(p.labelOrderNo, d.labelOrderNo),
    labelReceiptNo: asStr(p.labelReceiptNo, d.labelReceiptNo),
    labelDate: asStr(p.labelDate, d.labelDate),
    labelPos: asStr(p.labelPos, d.labelPos),
    labelCashier: asStr(p.labelCashier, d.labelCashier),
    labelClient: asStr(p.labelClient, d.labelClient),
    labelClientPhone: asStr(p.labelClientPhone, d.labelClientPhone),
    labelSum: asStr(p.labelSum, d.labelSum),
    labelDiscount: asStr(p.labelDiscount, d.labelDiscount),
    labelBonusEarned: asStr(p.labelBonusEarned, d.labelBonusEarned),
    labelBonusSpent: asStr(p.labelBonusSpent, d.labelBonusSpent),
    labelTotal: asStr(p.labelTotal, d.labelTotal),
    labelPay: asStr(p.labelPay, d.labelPay),
    labelCash: asStr(p.labelCash, d.labelCash),
    labelCard: asStr(p.labelCard, d.labelCard),
    labelDebt: asStr(p.labelDebt, d.labelDebt),
    labelCashGiven: asStr(p.labelCashGiven, d.labelCashGiven),
    labelChange: asStr(p.labelChange, d.labelChange),
    labelBonusBalance: asStr(p.labelBonusBalance, d.labelBonusBalance),

    footerThanks: asStr(p.footerThanks, d.footerThanks),
    footerNote: asStr(p.footerNote, d.footerNote),

    showStoreName: asBool(p.showStoreName, d.showStoreName),
    showSubtitle: asBool(p.showSubtitle, d.showSubtitle),
    showStorePhone: asBool(p.showStorePhone, d.showStorePhone),
    showDocTitle: asBool(p.showDocTitle, d.showDocTitle),
    showItems: asBool(p.showItems, d.showItems),
    showSubtotal: asBool(p.showSubtotal, d.showSubtotal),
    showFooterThanks: asBool(p.showFooterThanks, d.showFooterThanks),
    showFooterNote: asBool(p.showFooterNote, d.showFooterNote),
    showOrderNo: asBool(p.showOrderNo, d.showOrderNo),
    showReceiptNo: asBool(p.showReceiptNo, d.showReceiptNo),
    showDate: asBool(p.showDate, d.showDate),
    showPos: asBool(p.showPos, d.showPos),
    showCashier: asBool(p.showCashier, d.showCashier),
    showClient: asBool(p.showClient, d.showClient),
    showClientPhone: asBool(p.showClientPhone, d.showClientPhone),
    showDiscount: asBool(p.showDiscount, d.showDiscount),
    showBonusEarned: asBool(p.showBonusEarned, d.showBonusEarned),
    showBonusSpent: asBool(p.showBonusSpent, d.showBonusSpent),
    showBonusBalance: asBool(p.showBonusBalance, d.showBonusBalance),
    showPay: asBool(p.showPay, d.showPay),
    showCash: asBool(p.showCash, d.showCash),
    showCard: asBool(p.showCard, d.showCard),
    showDebt: asBool(p.showDebt, d.showDebt),
    showCashGiven: asBool(p.showCashGiven, d.showCashGiven),
    showChange: asBool(p.showChange, d.showChange),
  }
}

/** savedTemplate — база с диска; printOpts — любые переопределения */
function mergeTemplateOpts(printOpts, savedTemplate) {
  const t = normalizeReceiptTemplate(savedTemplate)
  const o = printOpts && typeof printOpts === 'object' ? printOpts : {}
  const overlay = {}
  for (const key of Object.keys(DEFAULT_RECEIPT_TEMPLATE)) {
    if (o[key] !== undefined) overlay[key] = o[key]
  }
  const merged = normalizeReceiptTemplate({ ...t, ...overlay })
  return {
    ...merged,
    posLabel: o.posLabel,
    cashierName: o.cashierName,
  }
}

module.exports = {
  DEFAULT_RECEIPT_TEMPLATE,
  normalizeReceiptTemplate,
  mergeTemplateOpts,
  charsPerLineFor,
}
