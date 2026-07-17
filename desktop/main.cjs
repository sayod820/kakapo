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
  const merged = {
    printerName: String(next.printerName ?? cur.printerName ?? ''),
    paperWidthMm: Number(next.paperWidthMm) === 58 ? 58 : 80,
    labelPrinterName: String(next.labelPrinterName ?? cur.labelPrinterName ?? ''),
    scaleMode: next.scaleMode === 'none' ? 'none' : 'plu-label',
    scaleHost: String(next.scaleHost ?? cur.scaleHost ?? '').trim(),
    scalePort: port > 0 && port < 65536 ? port : 20304,
    scaleDept: Math.max(1, Math.min(99, Number(next.scaleDept ?? cur.scaleDept) || 1)),
  }
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(merged, null, 2), 'utf8')
  return merged
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

function printHtml(html, options = {}) {
  const role = options.role === 'label' ? 'label' : 'receipt'
  if (role === 'label') {
    // Не ждём каждую этикетку: UI часто делает await в цикле.
    // Копим задания ~80мс и шлём одним RAW (PRINT n) — без паузы между листами.
    enqueueLabelPrint(html, options).catch(err => {
      console.error('[kakapo label print]', err)
    })
    return Promise.resolve({ ok: true, queued: true })
  }

  return new Promise((resolve, reject) => {
    const settings = loadPrinterSettings()
    const printerName = String(
      options.printerName || settings.printerName || '',
    ).trim()

    let pageWidthMm = Number(options.pageWidthMm)
    let pageHeightMm = Number(options.pageHeightMm)
    if (!Number.isFinite(pageWidthMm) || pageWidthMm <= 0) {
      pageWidthMm = Number(settings.paperWidthMm) === 58 ? 58 : 80
    }
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
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const tmpFile = path.join(os.tmpdir(), `kakapo-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
    let tmpFileWritten = false
    try {
      fs.writeFileSync(tmpFile, html, 'utf8')
      tmpFileWritten = true
    } catch (err) {
      reject(new Error(`Не удалось подготовить печать: ${err.message || err}`))
      return
    }

    const cleanupTmp = () => {
      if (!tmpFileWritten) return
      try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
      tmpFileWritten = false
    }

    printWindow.loadFile(tmpFile)

    const failTimer = setTimeout(() => {
      cleanupTmp()
      destroyPrintWindow()
      reject(new Error('Таймаут печати'))
    }, 45000)

    const runPrint = async () => {
      try {
        await waitForPrintRender(printWindow.webContents)
        const printOpts = {
          silent: !!printerName,
          printBackground: true,
          deviceName: printerName || undefined,
          margins: { marginType: 'none' },
          pageSize: { width: pageWidth, height: pageHeight },
          scaleFactor: 100,
        }

        printWindow.webContents.print(printOpts, (success, failureReason) => {
          clearTimeout(failTimer)
          cleanupTmp()
          destroyPrintWindow()
          if (!success) {
            reject(new Error(failureReason || 'Печать отменена'))
            return
          }
          resolve({
            ok: true,
            printerName: printerName || 'default',
            role,
            pageWidthMm,
            pageHeightMm,
          })
        })
      } catch (err) {
        clearTimeout(failTimer)
        cleanupTmp()
        destroyPrintWindow()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }

    printWindow.webContents.once('did-finish-load', () => {
      void runPrint()
    })

    printWindow.webContents.once('did-fail-load', (_e, code, desc) => {
      clearTimeout(failTimer)
      cleanupTmp()
      destroyPrintWindow()
      reject(new Error(desc || `Ошибка загрузки печати (${code})`))
    })
  })
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
