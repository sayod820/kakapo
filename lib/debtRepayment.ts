/** Погашение VIP-долга: наличные в магазине или перевод */

export type DebtPayMethod = 'cash' | 'transfer'

export const DEBT_REPAY_REQUISITES = {
  kaspi: '+992 93 000 00 00',
  holder: 'ИП КАКАПО',
  bank: 'Аmonatbank',
  storeAddress: 'г. Яван · магазин КАКАПО',
}

export function debtPayMethodLabel(method?: DebtPayMethod): string {
  return method === 'transfer' ? 'Перевод' : 'Наличными'
}

export function debtRepayHistoryDesc(method?: DebtPayMethod): string {
  return method === 'transfer' ? 'Оплата переводом' : 'Оплата наличными'
}

export function copyToClipboard(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
}
