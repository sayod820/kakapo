/**
 * Железные острова Торговли — НЕ переписывать при офлайн-синке.
 * Чек / весы CAS / этикетки: только вызывать существующие мосты.
 */

/** Печать чека (HTML + ESC/POS) */
export const RECEIPT_PRINT_MODULES = [
  'lib/printPosReceipt.ts',
  'lib/printerPresets.ts',
  'desktop/main.cjs (printReceiptEscPos)',
] as const

/** Весы CAS CL */
export const CAS_SCALE_MODULES = [
  'desktop/casScale.cjs',
  'lib/desktopBridge.ts (CAS IPC)',
  'lib/scaleBarcode.ts',
] as const

/** Этикетки товаров / прихода */
export const LABEL_PRINT_MODULES = [
  'components/trade/products/LabelsTab.tsx',
  'components/trade/products/labelShared.ts',
  'components/trade/products/labelPrintHtml.ts',
  'desktop/tsplLabel.cjs',
  'components/trade/warehouse/receiptLabelPrint.ts',
] as const

export const TRADE_HARDWARE_ISLANDS = {
  receipt: RECEIPT_PRINT_MODULES,
  cas: CAS_SCALE_MODULES,
  labels: LABEL_PRINT_MODULES,
} as const
