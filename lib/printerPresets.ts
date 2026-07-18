import type { DesktopPrinter } from '@/lib/desktopBridge'

/** Xprinter XP-58C — чековая лента 58 мм */
export const XP_RECEIPT_HINTS = [
  'xp-58c', 'xp58c', 'xp-58', 'xp58', '58c',
  'xprinter 58', 'xprinter xp-58', 'xpos-58', 'pos-58',
]

/** Xprinter XP-235B — принтер этикеток */
export const XP_LABEL_HINTS = ['xp-235', 'xp235', '235b', 'xp-235b', 'xprinter 235', 'xprinter xp-235']

export function printerNameMatches(name: string, hints: string[]): boolean {
  const n = String(name || '').toLowerCase()
  return hints.some(h => n.includes(h))
}

export function isLikelyLabelPrinter(p: DesktopPrinter): boolean {
  return printerNameMatches(p.name, XP_LABEL_HINTS)
    || printerNameMatches(p.displayName || '', XP_LABEL_HINTS)
}

export function isLikelyReceiptPrinter(p: DesktopPrinter): boolean {
  if (isLikelyLabelPrinter(p)) return false
  return printerNameMatches(p.name, XP_RECEIPT_HINTS)
    || printerNameMatches(p.displayName || '', XP_RECEIPT_HINTS)
    || /xprinter/i.test(p.name)
    || /xprinter/i.test(p.displayName || '')
}

export function pickReceiptPrinter(printers: DesktopPrinter[]): string {
  const list = printers || []
  const exact = list.find(p => isLikelyReceiptPrinter(p) && (
    printerNameMatches(p.name, XP_RECEIPT_HINTS)
    || printerNameMatches(p.displayName || '', XP_RECEIPT_HINTS)
  ))
  if (exact) return exact.name
  const soft = list.find(p => isLikelyReceiptPrinter(p))
  if (soft) return soft.name
  return ''
}

export function pickLabelPrinter(printers: DesktopPrinter[]): string {
  const hit = printers.find(p =>
    printerNameMatches(p.name, XP_LABEL_HINTS)
    || printerNameMatches(p.displayName || '', XP_LABEL_HINTS),
  )
  return hit?.name || ''
}

/** XP-58C сверху списка, затем остальные (без этикеточного) */
export function sortReceiptPrinters(printers: DesktopPrinter[]): DesktopPrinter[] {
  const list = [...(printers || [])]
  return list.sort((a, b) => {
    const ar = isLikelyReceiptPrinter(a) ? 0 : isLikelyLabelPrinter(a) ? 2 : 1
    const br = isLikelyReceiptPrinter(b) ? 0 : isLikelyLabelPrinter(b) ? 2 : 1
    if (ar !== br) return ar - br
    return String(a.displayName || a.name).localeCompare(String(b.displayName || b.name), 'ru')
  })
}

export const XP58C_RECEIPT_MM = 58 as const
export const XP235B_LABEL_WIDTH_MM = 58
export const XP235B_LABEL_HEIGHT_MM = 40
