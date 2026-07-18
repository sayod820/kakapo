'use strict'

/**
 * Полный шаблон чека 58 мм (как макет).
 * Хранится в userData кассы — работает даже со старым /trade на сервере.
 */

const DEFAULT_RECEIPT_TEMPLATE = {
  storeName: 'КАКАПО',
  storePhone: '+992 112 373 333',
  subtitle: 'магазин - касса',
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

function normalizeReceiptTemplate(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const d = DEFAULT_RECEIPT_TEMPLATE
  return {
    storeName: asStr(p.storeName, d.storeName),
    storePhone: String(p.storePhone != null ? p.storePhone : d.storePhone).trim(),
    subtitle: asStr(p.subtitle, d.subtitle),
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

/** savedTemplate — база с диска; printOpts — любые переопределения (в т.ч. полный шаблон из редактора) */
function mergeTemplateOpts(printOpts, savedTemplate) {
  const t = normalizeReceiptTemplate(savedTemplate)
  const o = printOpts && typeof printOpts === 'object' ? printOpts : {}
  // любое поле шаблона, переданное в printOpts, перекрывает диск (нужно для «Тест печати» без сохранения)
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
}
