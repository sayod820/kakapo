'use strict'

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('fs')
const path = require('path')

const { syncCasPlu } = require('./casScale.cjs')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'printer-settings.json')

let mainWindow = null
let printWindow = null

const DEFAULT_SETTINGS = {
  printerName: '',
  paperWidthMm: 80,
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

function printHtml(html, options = {}) {
  return new Promise((resolve, reject) => {
    const settings = loadPrinterSettings()
    const role = options.role === 'label' ? 'label' : 'receipt'
    const printerName = String(
      options.printerName
      || (role === 'label' ? settings.labelPrinterName : settings.printerName)
      || settings.printerName
      || '',
    ).trim()

    let pageWidthMm = Number(options.pageWidthMm)
    let pageHeightMm = Number(options.pageHeightMm)
    if (!Number.isFinite(pageWidthMm) || pageWidthMm <= 0) {
      pageWidthMm = role === 'label' ? 58 : (Number(settings.paperWidthMm) === 58 ? 58 : 80)
    }
    if (!Number.isFinite(pageHeightMm) || pageHeightMm <= 0) {
      pageHeightMm = role === 'label' ? 40 : 300
    }

    const pageWidth = Math.round(pageWidthMm * 1000)
    const pageHeight = Math.round(pageHeightMm * 1000)

    if (printWindow) {
      try { printWindow.destroy() } catch { /* ignore */ }
      printWindow = null
    }

    printWindow = new BrowserWindow({
      show: false,
      width: Math.max(280, Math.round(pageWidthMm * 4)),
      height: Math.max(400, Math.round(pageHeightMm * 4)),
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    printWindow.loadURL(dataUrl)

    const failTimer = setTimeout(() => {
      try { printWindow?.destroy() } catch { /* ignore */ }
      printWindow = null
      reject(new Error('Таймаут печати'))
    }, 45000)

    printWindow.webContents.on('did-finish-load', () => {
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
        try { printWindow?.destroy() } catch { /* ignore */ }
        printWindow = null
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
    })

    printWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      clearTimeout(failTimer)
      try { printWindow?.destroy() } catch { /* ignore */ }
      printWindow = null
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
