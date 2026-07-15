import type { DesktopPrinter } from '@/lib/desktopBridge'

/** Xprinter XP-58C — чековая лента 58 мм */
export const XP_RECEIPT_HINTS = ['xp-58', 'xp58', '58c', 'xp-58c', 'xprinter 58', 'xprinter xp-58']

/** Xprinter XP-235B — принтер этикеток */
export const XP_LABEL_HINTS = ['xp-235', 'xp235', '235b', 'xp-235b', 'xprinter 235', 'xprinter xp-235']

export function printerNameMatches(name: string, hints: string[]): boolean {
  const n = String(name || '').toLowerCase()
  return hints.some(h => n.includes(h))
}

export function pickReceiptPrinter(printers: DesktopPrinter[]): string {
  const hit = printers.find(p =>
    printerNameMatches(p.name, XP_RECEIPT_HINTS)
    || printerNameMatches(p.displayName || '', XP_RECEIPT_HINTS),
  )
  return hit?.name || ''
}

export function pickLabelPrinter(printers: DesktopPrinter[]): string {
  const hit = printers.find(p =>
    printerNameMatches(p.name, XP_LABEL_HINTS)
    || printerNameMatches(p.displayName || '', XP_LABEL_HINTS),
  )
  return hit?.name || ''
}

export const XP58C_RECEIPT_MM = 58 as const
export const XP235B_LABEL_WIDTH_MM = 58
export const XP235B_LABEL_HEIGHT_MM = 40
