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
  /** Живой вес в POS по TCP */
  scaleLiveWeight?: boolean
}

export type DesktopPrintOptions = Partial<DesktopPrinterSettings> & {
  role?: 'receipt' | 'label'
  pageWidthMm?: number
  pageHeightMm?: number
  /** Зазор между этикетками (мм), XP-235B обычно 2 */
  gapMm?: number
  /** Копии одной этикетки (TSPL PRINT n) — без паузы между листами */
  copies?: number
  /** Данные продажи для ESC/POS чека (обязательно для role=receipt) */
  sale?: unknown
  storeName?: string
  storePhone?: string
  posLabel?: string
  cashierName?: string
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

export type CasWeightEvent = {
  connected: boolean
  running?: boolean
  host?: string
  port?: number
  weightKg: number
  grams: number
  price?: number | null
  stable?: boolean
  /** Строка как на дисплее CAS, напр. "0.255" */
  display?: string
  error?: string
  raw?: string
  ts?: number
}

export type DesktopUpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  availableVersion: string
  percent: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  error: string
  message: string
}

export type KakapoDesktopApi = {
  isDesktop: true
  getInfo: () => Promise<{ isDesktop: boolean; platform: string; version: string }>
  getPrinters: () => Promise<DesktopPrinter[]>
  getPrinterSettings: () => Promise<DesktopPrinterSettings>
  savePrinterSettings: (data: Partial<DesktopPrinterSettings>) => Promise<DesktopPrinterSettings>
  /** Макет этикеток — файл в userData, переживает обновление UI */
  getLabelDesign?: () => Promise<unknown | null>
  saveLabelDesign?: (design: unknown) => Promise<{ ok: boolean }>
  printHtml: (html: string, options?: DesktopPrintOptions) => Promise<{ ok: boolean }>
  printReceipt?: (payload: {
    sale: unknown
    printerName?: string
    storeName?: string
    storePhone?: string
    subtitle?: string
    showSubtitle?: boolean
    showStorePhone?: boolean
    footerThanks?: string
    footerNote?: string
    posLabel?: string
    cashierName?: string
  }) => Promise<{ ok: boolean }>
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
  startCasWeight?: (payload?: {
    host?: string
    port?: number
    intervalMs?: number
  }) => Promise<{ ok: boolean; host: string; port: number; running: boolean }>
  stopCasWeight?: () => Promise<{ ok: boolean; running: boolean }>
  readCasWeight?: (payload?: {
    host?: string
    port?: number
    timeoutMs?: number
    /** true = новое TCP-соединение (тест), не через монитор */
    forceDirect?: boolean
    fresh?: boolean
  }) => Promise<{
    ok: boolean
    host: string
    port: number
    weightKg: number
    grams: number
    price: number | null
    raw?: string
    display?: string
    connected: boolean
    ts: number
  }>
  getCasWeightStatus?: () => Promise<{
    running: boolean
    connected: boolean
    host: string
    port: number
    error: string
  }>
  getLocalIpv4?: () => Promise<{ ok: boolean; list: { name: string; address: string; netmask: string }[] }>
  onCasWeight?: (handler: (payload: CasWeightEvent) => void) => () => void
  getUpdateStatus?: () => Promise<DesktopUpdateStatus>
  checkForUpdates?: () => Promise<DesktopUpdateStatus>
  downloadUpdate?: () => Promise<DesktopUpdateStatus>
  quitAndInstall?: () => Promise<{ ok: boolean; error?: string }>
  onUpdateStatus?: (handler: (payload: DesktopUpdateStatus) => void) => () => void
  /** Локальная база на диске ПК (SQLite) */
  localDbInfo?: () => Promise<{
    ok: boolean
    root: string
    engine?: string
    bootstrapComplete: boolean
    kvKeys: number
    queueLen: number
    mirrorCount?: number
    lastBootstrapAt?: string | null
    lastSyncAt?: string | null
  }>
  localDbKvGet?: (key: string) => Promise<unknown>
  localDbKvSet?: (key: string, value: unknown) => Promise<{ ok: boolean }>
  localDbKvDelete?: (key: string) => Promise<{ ok: boolean }>
  localDbQueueAll?: () => Promise<unknown[]>
  localDbQueuePut?: (row: unknown) => Promise<{ ok: boolean }>
  localDbQueueDelete?: (clientRef: string) => Promise<{ ok: boolean }>
  localDbMetaGet?: () => Promise<Record<string, unknown>>
  localDbMetaPatch?: (patch: Record<string, unknown>) => Promise<{ ok: boolean; meta: Record<string, unknown> }>
  /** Пометить установку завершённой — больше не просить скачивание */
  localDbMarkInstalled?: () => Promise<{ ok: boolean; bootstrapComplete: boolean }>
  /** Offline V2: теневое зеркало сущностей (не влияет на кассу, пока режим off) */
  localDbMirrorPut?: (row: { kind: string; id: string; data: unknown }) => Promise<{ ok: boolean }>
  localDbMirrorGet?: (kind: string, id: string) => Promise<unknown>
  localDbMirrorList?: (kind?: string, limit?: number) => Promise<Array<{
    kind: string
    id: string
    data: unknown
    updatedAtIso: string
  }>>
  /** Двусторонний синк: сущности по kind+id */
  localDbEntityPut?: (row: {
    kind: string
    id: string
    data: unknown
    updatedAtIso?: string
    deleted?: boolean
  }) => Promise<{ ok: boolean }>
  localDbEntityGet?: (kind: string, id: string) => Promise<{ data: unknown; updatedAtIso: string } | null>
  localDbEntityList?: (kind?: string, opts?: {
    since?: string
    limit?: number
    includeDeleted?: boolean
  }) => Promise<Array<{
    kind: string
    id: string
    data: unknown
    updatedAtIso: string
    deleted?: boolean
  }>>
  localDbEntityDelete?: (kind: string, id: string) => Promise<{ ok: boolean }>
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
