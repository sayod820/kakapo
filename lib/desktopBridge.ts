export type DesktopPrinter = {
  name: string
  displayName: string
  description?: string
  isDefault?: boolean
  status?: number
}

export type DesktopPrinterSettings = {
  /** Принтер чеков */
  printerName: string
  paperWidthMm: 58 | 80
  /** Принтер этикеток (если пусто — тот же, что чек) */
  labelPrinterName: string
  /** Весы с печатью этикеток (PLU) */
  scaleMode: 'none' | 'plu-label'
  /** IP весов CAS CL-3000 / CL-5000 */
  scaleHost: string
  /** Порт TCP (часто 20304 или 20000) */
  scalePort: number
  /** Отдел на весах */
  scaleDept: number
}

export type DesktopPrintOptions = Partial<DesktopPrinterSettings> & {
  role?: 'receipt' | 'label'
  pageWidthMm?: number
  pageHeightMm?: number
  /** Зазор между этикетками (мм), XP-235B обычно 2 */
  gapMm?: number
  /** Копии одной этикетки (TSPL PRINT n) — без паузы между листами */
  copies?: number
  /** Язык чека (для логов / подписей) */
  receiptLang?: 'ru' | 'tg'
  /** Плотность растра чека: 1–5 */
  receiptDensity?: number
  /** Поля чека в мм (0 = от края до края) */
  receiptPaddingMm?: number
  /** @deprecated GDI на XP-58C ненадёжен — не использовать */
  forceGdi?: boolean
  /** Данные продажи для ESC/POS RAW */
  sale?: unknown
  storeName?: string
  storeAddress?: string
  storePhone?: string
  posLabel?: string
  cashierName?: string
  headerText?: string
  footerThanks?: string
  footerNote?: string
  labels?: Record<string, string>
}

export type DesktopLabelBatchItem = {
  html: string
  copies?: number
}

export type CasPluItem = {
  plu: number
  name: string
  price: number
  barcode?: string
  department?: number
}

export type KakapoDesktopApi = {
  isDesktop: true
  getInfo: () => Promise<{ isDesktop: boolean; platform: string; version: string }>
  getPrinters: () => Promise<DesktopPrinter[]>
  getPrinterSettings: () => Promise<DesktopPrinterSettings>
  savePrinterSettings: (data: Partial<DesktopPrinterSettings>) => Promise<DesktopPrinterSettings>
  printHtml: (html: string, options?: DesktopPrintOptions) => Promise<{ ok: boolean }>
  printLabelsBatch?: (
    items: DesktopLabelBatchItem[],
    options?: DesktopPrintOptions,
  ) => Promise<{ ok: boolean; count?: number }>
  syncCasPlu: (payload: {
    host?: string
    port?: number
    department?: number
    scaleId?: number
    clearAll?: boolean
    items: CasPluItem[]
  }) => Promise<{ ok: boolean; count: number; host: string; port: number }>
}

declare global {
  interface Window {
    kakapoDesktop?: KakapoDesktopApi
  }
}

export function isKakapoDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.kakapoDesktop?.isDesktop
}

export function getKakapoDesktop(): KakapoDesktopApi | null {
  if (typeof window === 'undefined') return null
  return window.kakapoDesktop || null
}
