'use strict'

const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { syncCasPlu } = require('./casScale.cjs')
const {
  mmToDots,
  monoFromBgra,
  buildTsplBitmapJob,
  buildMultiLabelTspl,
  printRawWindows,
} = require('./tsplLabel.cjs')
const { buildEscPosReceipt, buildEscPosFromReceiptHtml, buildDemoReceiptSale } = require('./escposReceipt.cjs')
const {
  DEFAULT_RECEIPT_TEMPLATE,
  normalizeReceiptTemplate,
  mergeTemplateOpts,
} = require('./receiptTemplate.cjs')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'printer-settings.json')
const TEMPLATE_PATH = () => path.join(app.getPath('userData'), 'receipt-template.json')

let mainWindow = null
let printWindow = null
let receiptEditorWindow = null

const DEFAULT_SETTINGS = {
  printerName: '',
  paperWidthMm: 58,
  labelPrinterName: '',
  scaleMode: 'plu-label',
  scaleHost: '',
  scalePort: 20304,
  scaleDept: 1,
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return { tradeUrl: 'http://localhost:3000/trade', window: { width: 1360, height: 900 } }
  }
}

function loadPrinterSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8'))
    return {
      ...DEFAULT_SETTINGS,
      printerName: String(raw.printerName || ''),
      paperWidthMm: Number(raw.paperWidthMm) === 80 ? 80 : 58,
      labelPrinterName: String(raw.labelPrinterName || ''),
      scaleMode: raw.scaleMode === 'none' ? 'none' : 'plu-label',
      scaleHost: String(raw.scaleHost || ''),
      scalePort: Number(raw.scalePort) || 20304,
      scaleDept: Number(raw.scaleDept) || 1,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function savePrinterSettings(next) {
  const cur = loadPrinterSettings()
  const port = Number(next.scalePort ?? cur.scalePort) || 20304
  const merged = {
    printerName: String(next.printerName ?? cur.printerName ?? ''),
    paperWidthMm: Number(next.paperWidthMm) === 80 ? 80 : 58,
    labelPrinterName: String(next.labelPrinterName ?? cur.labelPrinterName ?? ''),
    scaleMode: next.scaleMode === 'none' ? 'none' : 'plu-label',
    scaleHost: String(next.scaleHost ?? cur.scaleHost ?? '').trim(),
    scalePort: port > 0 && port < 65536 ? port : 20304,
    scaleDept: Math.max(1, Math.min(99, Number(next.scaleDept ?? cur.scaleDept) || 1)),
  }
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

function loadReceiptTemplate() {
  try {
    const raw = JSON.parse(fs.readFileSync(TEMPLATE_PATH(), 'utf8'))
    return normalizeReceiptTemplate(raw)
  } catch {
    return normalizeReceiptTemplate(DEFAULT_RECEIPT_TEMPLATE)
  }
}

function saveReceiptTemplate(data) {
  const tpl = normalizeReceiptTemplate(data)
  fs.writeFileSync(TEMPLATE_PATH(), JSON.stringify(tpl, null, 2), 'utf8')
  return tpl
}

function openReceiptEditor() {
  if (receiptEditorWindow && !receiptEditorWindow.isDestroyed()) {
    receiptEditorWindow.focus()
    return
  }
  receiptEditorWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'Шаблон чека — KAKAPO',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  receiptEditorWindow.loadFile(path.join(__dirname, 'receipt-editor.html'))
  receiptEditorWindow.on('closed', () => {
    receiptEditorWindow = null
  })
}

function closeReceiptEditor() {
  if (receiptEditorWindow && !receiptEditorWindow.isDestroyed()) {
    receiptEditorWindow.close()
  }
}

function buildAppMenu() {
  // Без пункта «Шаблон чека» в меню — редактор только в настройках /trade
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'KAKAPO',
      submenu: [{ role: 'quit', label: 'Выход' }],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]))
}

function createWindow() {
  const config = loadConfig()
  const winCfg = config.window || {}
  const isDev = process.argv.includes('--dev')

  mainWindow = new BrowserWindow({
    width: Number(winCfg.width) || 1360,
    height: Number(winCfg.height) || 900,
    minWidth: 1024,
    minHeight: 700,
    fullscreen: !!winCfg.fullscreen,
    title: 'KAKAPO Касса',
    backgroundColor: '#030B05',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const url = String(config.tradeUrl || 'http://localhost:3000/trade').trim()
  mainWindow.loadURL(url)

  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    shell.openExternal(openUrl)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function getPrintersAsync() {
  const win = mainWindow || BrowserWindow.getAllWindows()[0]
  if (!win) return []
  if (typeof win.webContents.getPrintersAsync === 'function') {
    return win.webContents.getPrintersAsync()
  }
  return win.webContents.getPrinters()
}

const XP_RECEIPT_HINTS = [
  'xp-58c', 'xp58c', 'xp-58', 'xp58', '58c',
  'xprinter 58', 'xprinter xp-58', 'xpos-58', 'pos-58',
]

function printerNameMatches(name, hints) {
  const n = String(name || '').toLowerCase()
  return hints.some(h => n.includes(h))
}

function isLikelyLabelPrinter(p) {
  const hints = ['xp-235', 'xp235', '235b', 'xp-235b', 'xprinter 235']
  return printerNameMatches(p.name, hints) || printerNameMatches(p.displayName || '', hints)
}

function isVirtualPrinter(p) {
  const n = `${p.name || ''} ${p.displayName || ''}`.toLowerCase()
  return ['onenote', 'pdf', 'xps document', 'fax', 'microsoft print to'].some(v => n.includes(v))
}

function pickReceiptPrinterName(printers) {
  const list = printers || []
  const exact = list.find(p =>
    !isLikelyLabelPrinter(p) && (
      printerNameMatches(p.name, XP_RECEIPT_HINTS)
      || printerNameMatches(p.displayName || '', XP_RECEIPT_HINTS)
    ),
  )
  if (exact) return exact.name
  const soft = list.find(p =>
    !isLikelyLabelPrinter(p) && !isVirtualPrinter(p) && (/xprinter/i.test(p.name) || /xprinter/i.test(p.displayName || '')),
  )
  if (soft) return soft.name
  const real = list.find(p => !isLikelyLabelPrinter(p) && !isVirtualPrinter(p))
  if (real) return real.name
  const def = list.find(p => p.isDefault && !isVirtualPrinter(p))
  return def?.name || ''
}

async function resolveReceiptPrinterName(preferred) {
  const settings = loadPrinterSettings()
  let name = String(preferred || settings.printerName || '').trim()
  if (name) return name
  try {
    const printers = await getPrintersAsync()
    name = pickReceiptPrinterName(printers)
    if (name) {
      savePrinterSettings({ ...settings, printerName: name, paperWidthMm: 58 })
    }
  } catch { /* ignore */ }
  return name
}

function describeMissingReceiptPrinter(printers) {
  const names = (printers || []).map(p => p.displayName || p.name).filter(Boolean)
  if (!names.length) {
    return 'Принтер XP-58C не найден в Windows. Подключите USB, включите принтер и установите драйвер Xprinter.'
  }
  return `Принтер XP-58C не найден в Windows. Сейчас доступны: ${names.slice(0, 4).join(', ')}. Подключите XP-58C и нажмите «Обновить» в настройках.`
}

function labelPx(mm) {
  return Math.max(1, mmToDots(mm))
}

function waitForPrintRender(webContents) {
  return webContents.executeJavaScript(`
    new Promise((resolve) => {
      const done = () => setTimeout(resolve, 40)
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(done).catch(done)
        return
      }
      if (document.readyState === 'complete') {
        done()
        return
      }
      window.addEventListener('load', done, { once: true })
      setTimeout(resolve, 200)
    })
  `).catch(() => undefined)
}

function resolveLabelPageSize(options = {}) {
  let pageWidthMm = Number(options.pageWidthMm)
  let pageHeightMm = Number(options.pageHeightMm)
  if (!Number.isFinite(pageWidthMm) || pageWidthMm <= 0) pageWidthMm = 58
  if (!Number.isFinite(pageHeightMm) || pageHeightMm <= 0) pageHeightMm = 40
  if (pageHeightMm > 60) pageHeightMm = 40
  if (pageWidthMm > 70) pageWidthMm = 58
  const gapMm = Number(options.gapMm)
  const gap = Number.isFinite(gapMm) && gapMm >= 0 ? gapMm : 2
  return { pageWidthMm, pageHeightMm, gap }
}

function ensureLabelPrintWindow(wPx, hPx) {
  if (printWindow && !printWindow.isDestroyed()) {
    try { printWindow.setContentSize(wPx, hPx) } catch { /* ignore */ }
    return printWindow
  }
  destroyPrintWindow()
  printWindow = new BrowserWindow({
    show: false,
    width: wPx,
    height: hPx,
    useContentSize: true,
    enableLargerThanScreen: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1,
      offscreen: false,
    },
  })
  try { printWindow.setContentSize(wPx, hPx) } catch { /* ignore */ }
  return printWindow
}

function wrapLabelHtmlLight(html) {
  return String(html || '').replace(
    /<head([^>]*)>/i,
    '<head$1><meta name="color-scheme" content="light only"><style>:root,html,body{color-scheme:light only!important;background:#fff!important;color:#000!important}*{color-scheme:light only!important}</style>',
  )
}

async function captureOneLabelMono(html, wPx, hPx) {
  const win = ensureLabelPrintWindow(wPx, hPx)
  const tmpFile = path.join(os.tmpdir(), `kakapo-label-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpFile, wrapLabelHtmlLight(html), 'utf8')
  try {
    await win.loadFile(tmpFile)
    try {
      await win.webContents.insertCSS(`
        :root { color-scheme: light only !important; }
        html, body { background:#ffffff !important; color:#000000 !important; }
        .k-label-card { background:#ffffff !important; color:#000000 !important; }
      `)
    } catch { /* ignore */ }
    await waitForPrintRender(win.webContents)
    try { win.webContents.setZoomFactor(1) } catch { /* ignore */ }
    try { win.setContentSize(wPx, hPx) } catch { /* ignore */ }

    const cardCount = await win.webContents.executeJavaScript(`
      (function () {
        const cards = Array.from(document.querySelectorAll('.k-label-card'));
        if (!cards.length) return 0;
        document.documentElement.style.cssText = 'width:${wPx}px;height:${hPx}px;overflow:hidden;margin:0;padding:0;';
        document.body.style.cssText = 'width:${wPx}px;height:${hPx}px;overflow:hidden;margin:0;padding:0;background:#fff;';
        const root = document.getElementById('k-label-print');
        if (root) {
          root.style.cssText = 'display:block;width:${wPx}px;height:${hPx}px;margin:0;padding:0;overflow:hidden;';
        }
        cards.forEach((c, idx) => {
          c.style.cssText = 'display:' + (idx === 0 ? 'block' : 'none') + ';position:relative;width:${wPx}px;height:${hPx}px;min-height:${hPx}px;max-height:${hPx}px;max-width:${wPx}px;margin:0;padding:0;overflow:hidden;background:#fff;color:#000;box-sizing:border-box;';
        });
        return Math.min(1, cards.length);
      })()
    `)
    if (!cardCount) throw new Error('Нет этикеток для печати')

    let img = await win.webContents.capturePage({ x: 0, y: 0, width: wPx, height: hPx })
    const sz = img.getSize()
    if (sz.width !== wPx || sz.height !== hPx) {
      img = img.resize({ width: wPx, height: hPx, quality: 'best' })
    }
    const size = img.getSize()
    const bgra = img.toBitmap()
    return monoFromBgra(bgra, size.width, size.height, wPx, hPx, 168)
  } finally {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

function destroyPrintWindow() {
  if (!printWindow) return
  try { printWindow.destroy() } catch { /* ignore */ }
  printWindow = null
}

/** Этикетки XP-235B: TSPL RAW bitmap 203 DPI — без дизеринга Windows-драйвера */
async function printLabelsViaTspl(html, options = {}) {
  const settings = loadPrinterSettings()
  const printerName = String(
    options.printerName || settings.labelPrinterName || settings.printerName || '',
  ).trim()
  if (!printerName) {
    throw new Error('Выберите принтер XP-235B в настройках этикеток')
  }

  const { pageWidthMm, pageHeightMm, gap } = resolveLabelPageSize(options)
  const copies = Math.max(1, Math.min(99, Math.round(Number(options.copies) || 1)))
  const wPx = labelPx(pageWidthMm)
  const hPx = labelPx(pageHeightMm)

  const prevTheme = nativeTheme.themeSource
  nativeTheme.themeSource = 'light'

  try {
    const mono = await captureOneLabelMono(html, wPx, hPx)
    const job = buildTsplBitmapJob({
      widthMm: pageWidthMm,
      heightMm: pageHeightMm,
      gapMm: gap,
      mono,
      copies,
    })
    await printRawWindows(printerName, job)
    return {
      ok: true,
      printerName,
      role: 'label',
      mode: 'tspl-raw',
      pageWidthMm,
      pageHeightMm,
      count: copies,
    }
  } finally {
    nativeTheme.themeSource = prevTheme
    destroyPrintWindow()
  }
}

/**
 * Пакетная печать: захват каждой этикетки один раз, копии через PRINT n,
 * одно RAW-задание на принтер — без паузы между листами.
 */
async function printLabelsBatchViaTspl(items, options = {}) {
  const list = Array.isArray(items) ? items.filter(it => it && typeof it.html === 'string' && it.html) : []
  if (!list.length) throw new Error('Нет этикеток для печати')

  const settings = loadPrinterSettings()
  const printerName = String(
    options.printerName || settings.labelPrinterName || settings.printerName || '',
  ).trim()
  if (!printerName) {
    throw new Error('Выберите принтер XP-235B в настройках этикеток')
  }

  const { pageWidthMm, pageHeightMm, gap } = resolveLabelPageSize(options)
  const wPx = labelPx(pageWidthMm)
  const hPx = labelPx(pageHeightMm)

  const prevTheme = nativeTheme.themeSource
  nativeTheme.themeSource = 'light'

  try {
    const labelsMono = []
    let total = 0
    for (const it of list) {
      const copies = Math.max(1, Math.min(99, Math.round(Number(it.copies) || 1)))
      const mono = await captureOneLabelMono(it.html, wPx, hPx)
      labelsMono.push({ mono, copies })
      total += copies
    }
    const job = buildMultiLabelTspl({
      widthMm: pageWidthMm,
      heightMm: pageHeightMm,
      gapMm: gap,
      labelsMono,
    })
    await printRawWindows(printerName, job)
    return {
      ok: true,
      printerName,
      role: 'label',
      mode: 'tspl-raw-batch',
      pageWidthMm,
      pageHeightMm,
      count: total,
    }
  } finally {
    nativeTheme.themeSource = prevTheme
    destroyPrintWindow()
  }
}

/** Склеивает подряд printHtml(label) в один RAW-пакет (даже со старым UI) */
let labelJobQueue = []
let labelFlushTimer = null

function enqueueLabelPrint(html, options = {}) {
  return new Promise((resolve, reject) => {
    labelJobQueue.push({ html, options, resolve, reject })
    if (labelFlushTimer) clearTimeout(labelFlushTimer)
    labelFlushTimer = setTimeout(() => {
      void flushLabelJobQueue()
    }, 80)
  })
}

async function flushLabelJobQueue() {
  labelFlushTimer = null
  const batch = labelJobQueue.splice(0)
  if (!batch.length) return

  const merged = []
  for (const job of batch) {
    const add = Math.max(1, Math.min(99, Math.round(Number(job.options?.copies) || 1)))
    const last = merged[merged.length - 1]
    if (last && last.html === job.html) {
      last.copies = Math.min(99, last.copies + add)
      last.jobs.push(job)
    } else {
      merged.push({
        html: job.html,
        options: job.options || {},
        copies: add,
        jobs: [job],
      })
    }
  }

  try {
    const result = await printLabelsBatchViaTspl(
      merged.map(m => ({ html: m.html, copies: m.copies })),
      merged[0].options,
    )
    for (const m of merged) {
      for (const j of m.jobs) j.resolve(result)
    }
  } catch (err) {
    for (const m of merged) {
      for (const j of m.jobs) j.reject(err)
    }
  }
}

function logPrintDebug(msg, extra) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`
    fs.appendFileSync(path.join(app.getPath('userData'), 'print-debug.log'), line, 'utf8')
  } catch { /* ignore */ }
}

function printHtml(html, options = {}) {
  const role = options.role === 'label' ? 'label' : 'receipt'
  if (role === 'label') {
    enqueueLabelPrint(html, options).catch(err => {
      console.error('[kakapo label print]', err)
    })
    return Promise.resolve({ ok: true, queued: true })
  }

  // Чек: ESC/POS текст (CP866). HTML как RAW не шлём.
  return (async () => {
    try {
      const res = await printReceiptEscPos(html, options)
      logPrintDebug('receipt escpos ok', { printer: res.printerName, mode: res.mode })
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logPrintDebug('receipt escpos fail', { error: msg })
      throw new Error(`Печать чека не удалась: ${msg}`)
    }
  })()
}

function normalizeSalePayload(raw) {
  if (!raw) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  if (typeof raw === 'object') return raw
  return null
}

async function printReceiptEscPos(html, options = {}) {
  const printerName = await ensureReceiptPrinterName(options.printerName)
  let sale = normalizeSalePayload(options.sale)

  // Старый «Тест чека» (1 сом) → полный демо-макет как на дизайне
  if (sale && (sale.id === 'TEST' || sale.orderId === 'TEST-001' || /Тест печати/i.test(String(sale.items?.[0]?.productName || '')))) {
    const demo = buildDemoReceiptSale()
    sale = {
      ...demo,
      cashierName: options.cashierName || demo.cashierName,
    }
  }

  // Шаблон с диска кассы — база; pos/кассир из продажи
  const storeOpts = mergeTemplateOpts({
    storeName: options.storeName,
    storePhone: options.storePhone,
    subtitle: options.subtitle,
    footerThanks: options.footerThanks,
    footerNote: options.footerNote,
    posLabel: options.posLabel,
    cashierName: options.cashierName,
  }, loadReceiptTemplate())

  let raw
  if (sale && typeof sale === 'object') {
    raw = buildEscPosReceipt(sale, storeOpts)
  } else if (html && typeof html === 'string' && html.includes('<')) {
    if (/Тест печати XP-58C/i.test(html)) {
      raw = buildEscPosReceipt(buildDemoReceiptSale(), storeOpts)
    } else {
      logPrintDebug('receipt fallback html→text', { htmlLen: html.length })
      raw = buildEscPosFromReceiptHtml(html, storeOpts)
    }
  } else {
    throw new Error('Нет данных чека. Обновите страницу /trade (F5) и повторите тест.')
  }

  const asAscii = raw.toString('latin1')
  if (/<!DOCTYPE|<html/i.test(asAscii)) {
    throw new Error('Внутренняя ошибка: HTML попал в RAW-буфер')
  }
  await printRawWindows(printerName, raw)
  return {
    ok: true,
    printerName,
    role: 'receipt',
    mode: sale ? 'escpos-text-cp866' : 'escpos-from-html',
    pageWidthMm: 58,
  }
}

async function ensureReceiptPrinterName(preferred) {
  const settings = loadPrinterSettings()
  let printerName = await resolveReceiptPrinterName(preferred)
  if (!printerName) {
    let printers = []
    try { printers = await getPrintersAsync() } catch { /* ignore */ }
    throw new Error(describeMissingReceiptPrinter(printers))
  }
  try {
    const printers = await getPrintersAsync()
    const exists = (printers || []).some(p => p.name === printerName)
    if (!exists) {
      const again = pickReceiptPrinterName(printers)
      if (again) {
        printerName = again
        savePrinterSettings({ ...settings, printerName, paperWidthMm: 58 })
      } else {
        throw new Error(describeMissingReceiptPrinter(printers))
      }
    }
  } catch (err) {
    if (err instanceof Error && /XP-58C|не найден/.test(err.message)) throw err
  }
  return printerName
}

app.whenReady().then(() => {
  buildAppMenu()
  createWindow()

  ipcMain.handle('desktop:getInfo', () => ({
    isDesktop: true,
    platform: process.platform,
    version: app.getVersion(),
    config: loadConfig(),
  }))

  ipcMain.handle('desktop:getPrinters', async () => {
    const printers = await getPrintersAsync()
    return (printers || []).map(p => ({
      name: p.name,
      displayName: p.displayName || p.name,
      description: p.description || '',
      isDefault: !!p.isDefault,
      status: p.status,
    }))
  })

  ipcMain.handle('desktop:getPrinterSettings', () => loadPrinterSettings())

  ipcMain.handle('desktop:savePrinterSettings', (_e, data) => savePrinterSettings(data || {}))

  ipcMain.handle('desktop:getReceiptTemplate', () => ({
    template: loadReceiptTemplate(),
    defaults: DEFAULT_RECEIPT_TEMPLATE,
  }))

  ipcMain.handle('desktop:saveReceiptTemplate', (_e, data) => saveReceiptTemplate(data || {}))

  ipcMain.handle('desktop:openReceiptEditor', () => {
    openReceiptEditor()
    return { ok: true }
  })

  ipcMain.handle('desktop:closeReceiptEditor', () => {
    closeReceiptEditor()
    return { ok: true }
  })

  ipcMain.handle('desktop:printHtml', async (_e, html, options) => {
    const opts = options || {}
    if (opts.role === 'label') {
      if (!html || typeof html !== 'string') throw new Error('Пустой документ печати')
    }
    return printHtml(typeof html === 'string' ? html : '', opts)
  })

  ipcMain.handle('desktop:printReceipt', async (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {}
    const tpl = loadReceiptTemplate()
    return printHtml('', {
      role: 'receipt',
      printerName: p.printerName,
      paperWidthMm: 58,
      sale: p.sale,
      ...mergeTemplateOpts(p, tpl),
      posLabel: p.posLabel,
      cashierName: p.cashierName,
    })
  })

  ipcMain.handle('desktop:printLabelsBatch', async (_e, items, options) => {
    return printLabelsBatchViaTspl(items || [], options || {})
  })

  ipcMain.handle('desktop:syncCasPlu', async (_e, payload) => {
    const settings = loadPrinterSettings()
    const host = String(payload?.host || settings.scaleHost || '').trim()
    const port = Number(payload?.port || settings.scalePort) || 20304
    const dept = Math.max(1, Math.min(99, Number(payload?.department || settings.scaleDept) || 1))
    const items = (payload?.items || []).map(i => ({
      ...i,
      department: Number(i.department) || dept,
    }))
    return syncCasPlu({
      host,
      port,
      scaleId: Number(payload?.scaleId) || 0,
      clearAll: !!payload?.clearAll,
      items,
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
