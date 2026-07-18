'use strict'

const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron')
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
const { buildEscPosReceipt, buildEscPosFromReceiptHtml, buildEscPosRaster } = require('./escposReceipt.cjs')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'printer-settings.json')

let mainWindow = null
let printWindow = null

const DEFAULT_SETTINGS = {
  printerName: '',
  paperWidthMm: 58,
  labelPrinterName: '',
  scaleMode: 'plu-label',
  scaleHost: '',
  scalePort: 20304,
  scaleDept: 1,
  /** Плотность чека 1–5 (2 = чётко, без заливки цифр). XP-58C @ 203 DPI */
  receiptDensity: 2,
  /** raster = HTML-дизайн как в предпросмотре; text = нативный ESC/POS */
  receiptPrintMode: 'raster',
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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function savePrinterSettings(next) {
  const cur = loadPrinterSettings()
  const port = Number(next.scalePort ?? cur.scalePort) || 20304
  const density = Math.max(1, Math.min(5, Math.round(Number(next.receiptDensity ?? cur.receiptDensity) || 3)))
  const modeRaw = next.receiptPrintMode ?? cur.receiptPrintMode ?? 'raster'
  const merged = {
    printerName: String(next.printerName ?? cur.printerName ?? ''),
    paperWidthMm: Number(next.paperWidthMm) === 80 ? 80 : 58,
    labelPrinterName: String(next.labelPrinterName ?? cur.labelPrinterName ?? ''),
    scaleMode: next.scaleMode === 'none' ? 'none' : 'plu-label',
    scaleHost: String(next.scaleHost ?? cur.scaleHost ?? '').trim(),
    scalePort: port > 0 && port < 65536 ? port : 20304,
    scaleDept: Math.max(1, Math.min(99, Number(next.scaleDept ?? cur.scaleDept) || 1)),
    receiptDensity: density,
    receiptPrintMode: modeRaw === 'text' ? 'text' : 'raster',
  }
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

/** Плотность 1–5: из опций печати или printer-settings.json */
function resolveReceiptDensity(options = {}) {
  const fromOpt = Number(options.receiptDensity)
  if (Number.isFinite(fromOpt) && fromOpt >= 1 && fromOpt <= 5) return Math.round(fromOpt)
  const fromSettings = Number(loadPrinterSettings().receiptDensity)
  if (Number.isFinite(fromSettings) && fromSettings >= 1 && fromSettings <= 5) return Math.round(fromSettings)
  return 3
}

/**
 * Порог B/W для растра.
 * Ниже порог → меньше чёрного → просветы в 8/0/3/6 остаются.
 * density 3 ≈ 124 (средняя). density 5 ≈ 140 (не max-заливка).
 */
function receiptMonoThreshold(density) {
  const level = Math.max(1, Math.min(5, Math.round(Number(density) || 3)))
  return 100 + level * 8
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

  return (async () => {
    const settings = loadPrinterSettings()
    const density = resolveReceiptDensity(options)
    const mode = options.receiptPrintMode === 'raster' || options.receiptPrintMode === 'text'
      ? options.receiptPrintMode
      : (settings.receiptPrintMode === 'text' ? 'text' : 'raster')
    const opts = { ...options, receiptDensity: density }

    // raster = HTML-шаблон как в предпросмотре (чёрная плашка, Arial)
    // text = нативный шрифт принтера (без дизайна)
    const tryText = async () => {
      if (opts.sale && typeof opts.sale === 'object') {
        return printReceiptEscPos(opts.sale, opts)
      }
      return printReceiptHtmlAsEscPos(html, opts)
    }
    const tryRaster = async () => printReceiptHtmlRaster(html, opts)

    if (mode === 'text') {
      try {
        const res = await tryText()
        logPrintDebug('receipt escpos ok', { printer: res.printerName, mode: res.mode, density })
        return res
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logPrintDebug('receipt escpos fail, try raster', { error: msg, density })
        try {
          const res = await tryRaster()
          logPrintDebug('receipt raster ok', { printer: res.printerName, mode: res.mode, density, h: res.height })
          return res
        } catch (errRaster) {
          const msgR = errRaster instanceof Error ? errRaster.message : String(errRaster)
          try {
            const res = await printReceiptHtmlFallback(html, opts)
            logPrintDebug('receipt gdi ok', { printer: res.printerName })
            return res
          } catch (err2) {
            const msg2 = err2 instanceof Error ? err2.message : String(err2)
            throw new Error(`Печать чека не удалась. RAW: ${msg}. Raster: ${msgR}. GDI: ${msg2}`)
          }
        }
      }
    }

    try {
      const res = await tryRaster()
      logPrintDebug('receipt raster ok', { printer: res.printerName, mode: res.mode, density, h: res.height })
      return res
    } catch (errRaster) {
      const msgR = errRaster instanceof Error ? errRaster.message : String(errRaster)
      logPrintDebug('receipt raster fail, try text escpos', { error: msgR, density })
      try {
        const res = await tryText()
        logPrintDebug('receipt escpos ok', { printer: res.printerName, mode: res.mode, density })
        return res
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        try {
          const res = await printReceiptHtmlFallback(html, opts)
          logPrintDebug('receipt gdi ok', { printer: res.printerName })
          return res
        } catch (err2) {
          const msg2 = err2 instanceof Error ? err2.message : String(err2)
          throw new Error(`Печать чека не удалась. Raster: ${msgR}. RAW: ${msg}. GDI: ${msg2}`)
        }
      }
    }
  })()
}

/** 58 мм ESC/POS: обычно 384 точки (48 мм печатная зона × 8 dot/mm) */
function receiptRasterWidthDots(paperWidthMm) {
  return Number(paperWidthMm) === 80 ? 576 : 384
}

function wrapReceiptHtmlForRaster(html, widthPx, paddingMm = 1) {
  const pad = Math.max(0, Math.min(6, Number(paddingMm) || 0))
  // Не перебиваем размеры/шрифты из HTML-шаблона — печать = предпросмотр.
  // Только: ширина ленты, поля контейнера, белый заголовок, без antialias.
  const inject = `<meta name="color-scheme" content="light only"><style>
:root,html,body{color-scheme:light only!important;background:#fff!important;color:#000!important;margin:0!important;}
html,body{width:${widthPx}px!important;max-width:${widthPx}px!important;overflow:hidden!important;}
body{
  padding:${pad}mm!important;box-sizing:border-box!important;
  -webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;
  -webkit-font-smoothing:none!important;-moz-osx-font-smoothing:unset!important;
  font-smooth:never!important;text-rendering:optimizeSpeed!important;
}
.receipt{max-width:100%!important;margin-left:auto!important;margin-right:auto!important;}
.doc-title,.black{border-radius:0!important;}
.muted,.meta-row span,.foot{color:#000!important;}
/* Чуть развести штрихи цифр — меньше заливка 8/0/3/6 */
.item-calc,.sum-row,.total,.meta-row b{letter-spacing:.04em!important;}
*{
  color-scheme:light only!important;
  -webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;
  -webkit-font-smoothing:none!important;font-smooth:never!important;
  text-rendering:optimizeSpeed!important;
}
</style>`
  const s = String(html || '')
  if (/<head[^>]*>/i.test(s)) {
    return s.replace(/<head([^>]*)>/i, `<head$1>${inject}`)
  }
  return `<!DOCTYPE html><html><head>${inject}</head><body>${s}</body></html>`
}

async function captureReceiptMono(html, widthDots, density = 4, paddingMm = 1) {
  const wPx = Math.max(192, Math.round(widthDots))
  destroyPrintWindow()
  printWindow = new BrowserWindow({
    show: false,
    width: wPx,
    height: 900,
    useContentSize: true,
    enableLargerThanScreen: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1,
    },
  })
  const win = printWindow
  const tmpFile = path.join(os.tmpdir(), `kakapo-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpFile, wrapReceiptHtmlForRaster(html, wPx, paddingMm), 'utf8')

  const prevTheme = nativeTheme.themeSource
  nativeTheme.themeSource = 'light'
  try {
    await win.loadFile(tmpFile)
    try { win.webContents.setZoomFactor(1) } catch { /* ignore */ }
    await waitForPrintRender(win.webContents)
    await new Promise(r => setTimeout(r, 120))

    const padCss = `${Math.max(0, Math.min(6, Number(paddingMm) || 0))}mm`
    const measured = await win.webContents.executeJavaScript(`
      (function () {
        document.documentElement.style.cssText = 'width:${wPx}px;margin:0;padding:0;background:#fff;';
        document.body.style.cssText = 'width:${wPx}px;max-width:${wPx}px;margin:0;padding:${padCss};box-sizing:border-box;background:#fff;color:#000;';
        const el = document.querySelector('.receipt') || document.body;
        const h = Math.ceil(Math.max(
          el.scrollHeight || 0,
          el.getBoundingClientRect().height || 0,
          document.body.scrollHeight || 0,
          document.documentElement.scrollHeight || 0
        ));
        return Math.max(120, Math.min(2400, h + 8));
      })()
    `)
    const hPx = Math.max(120, Math.round(Number(measured) || 400))
    try { win.setContentSize(wPx, hPx) } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 60))

    let img = await win.webContents.capturePage({ x: 0, y: 0, width: wPx, height: hPx })
    const sz = img.getSize()
    // Не используем quality:'best' — размывает края цифр. Подгоняем nearest при расхождении.
    if (sz.width !== wPx || sz.height !== hPx) {
      img = img.resize({ width: wPx, height: hPx, quality: 'nearest' })
    }
    const size = img.getSize()
    const bgra = img.toBitmap()
    const level = resolveReceiptDensity({ receiptDensity: density })
    const threshold = receiptMonoThreshold(level)
    logPrintDebug('receipt raster capture', { wPx, hPx, density: level, threshold, dpi: 203 })
    return monoFromBgra(bgra, size.width, size.height, wPx, hPx, threshold)
  } finally {
    nativeTheme.themeSource = prevTheme
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
    destroyPrintWindow()
  }
}

async function printReceiptHtmlRaster(html, options = {}) {
  const settings = loadPrinterSettings()
  const printerName = await ensureReceiptPrinterName(options.printerName)
  const paperWidthMm = printerNameMatches(printerName, XP_RECEIPT_HINTS)
    ? 58
    : (Number(options.pageWidthMm ?? options.paperWidthMm ?? settings.paperWidthMm) === 80 ? 80 : 58)
  const widthDots = receiptRasterWidthDots(paperWidthMm)
  const density = resolveReceiptDensity(options)

  const mono = await captureReceiptMono(html, widthDots, density, options.receiptPaddingMm)
  if (!mono || !mono.data || mono.height < 40) {
    throw new Error('Пустой снимок чека')
  }
  const raw = buildEscPosRaster(mono, { cut: true, density })
  await printRawWindows(printerName, raw)
  return {
    ok: true,
    printerName,
    role: 'receipt',
    mode: 'escpos-raster',
    pageWidthMm: paperWidthMm,
    height: mono.height,
    density,
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

async function printReceiptHtmlAsEscPos(html, options = {}) {
  const settings = loadPrinterSettings()
  const printerName = await ensureReceiptPrinterName(options.printerName)
  const paperWidthMm = printerNameMatches(printerName, XP_RECEIPT_HINTS)
    ? 58
    : (Number(options.pageWidthMm ?? options.paperWidthMm ?? settings.paperWidthMm) === 80 ? 80 : 58)
  const raw = buildEscPosFromReceiptHtml(html, { paperWidthMm })
  await printRawWindows(printerName, raw)
  return {
    ok: true,
    printerName,
    role: 'receipt',
    mode: 'escpos-from-html',
    pageWidthMm: paperWidthMm,
  }
}

async function printReceiptEscPos(sale, options = {}) {
  const settings = loadPrinterSettings()
  const printerName = await ensureReceiptPrinterName(options.printerName)

  const paperWidthMm = printerNameMatches(printerName, XP_RECEIPT_HINTS)
    ? 58
    : (Number(options.pageWidthMm ?? options.paperWidthMm ?? settings.paperWidthMm) === 80 ? 80 : 58)

  const raw = buildEscPosReceipt(sale, {
    storeName: options.storeName,
    storeAddress: options.storeAddress,
    storePhone: options.storePhone,
    posLabel: options.posLabel,
    cashierName: options.cashierName,
    headerText: options.headerText,
    footerThanks: options.footerThanks,
    footerNote: options.footerNote,
    labels: options.labels,
    paperWidthMm,
    density: resolveReceiptDensity(options),
  })
  await printRawWindows(printerName, raw)
  return {
    ok: true,
    printerName,
    role: 'receipt',
    mode: 'escpos-raw',
    pageWidthMm: paperWidthMm,
  }
}

function printReceiptHtmlFallback(html, options = {}) {
  return (async () => {
    const settings = loadPrinterSettings()
    let printerName = await resolveReceiptPrinterName(options.printerName)
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

    let pageWidthMm = Number(options.pageWidthMm ?? options.paperWidthMm)
    let pageHeightMm = Number(options.pageHeightMm)
    if (!Number.isFinite(pageWidthMm) || pageWidthMm <= 0) {
      pageWidthMm = Number(settings.paperWidthMm) === 80 ? 80 : 58
    }
    if (printerNameMatches(printerName, XP_RECEIPT_HINTS)) pageWidthMm = 58
    if (!Number.isFinite(pageHeightMm) || pageHeightMm <= 0) {
      pageHeightMm = 300
    }

    const pageWidth = Math.round(pageWidthMm * 1000)
    const pageHeight = Math.round(pageHeightMm * 1000)
    const winW = Math.max(320, Math.round(pageWidthMm * 4))
    const winH = Math.max(400, Math.round(pageHeightMm * 4))

    destroyPrintWindow()

    printWindow = new BrowserWindow({
      show: false,
      width: winW,
      height: winH,
      backgroundColor: '#ffffff',
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const tmpFile = path.join(os.tmpdir(), `kakapo-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
    fs.writeFileSync(tmpFile, String(html || ''), 'utf8')

    try {
      await printWindow.loadFile(tmpFile)
      await waitForPrintRender(printWindow.webContents)

      const printOpts = {
        silent: true,
        printBackground: true,
        deviceName: printerName,
        margins: { marginType: 'none' },
        pageSize: { width: pageWidth, height: pageHeight },
        scaleFactor: 100,
      }

      const result = await new Promise((resolve, reject) => {
        printWindow.webContents.print(printOpts, (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || 'Печать чека отменена / принтер недоступен'))
            return
          }
          resolve({
            ok: true,
            printerName,
            role: 'receipt',
            mode: 'html-gdi',
            pageWidthMm,
            pageHeightMm,
          })
        })
      })
      return result
    } finally {
      try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
      destroyPrintWindow()
    }
  })()
}

app.whenReady().then(() => {
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

  ipcMain.handle('desktop:printHtml', async (_e, html, options) => {
    if (!html || typeof html !== 'string') throw new Error('Пустой документ печати')
    return printHtml(html, options || {})
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
