'use strict'

const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu, dialog, session } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { syncCasPlu, readLiveWeight, weightMonitor } = require('./casScale.cjs')
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
} = require('./receiptTemplate.cjs')
const { startLocalUi, stopLocalUi, restartLocalUi, localUiUrl, invalidateUiCacheOnAppUpdate } = require('./localServer.cjs')
const { installUpdaterIpc } = require('./updater.cjs')
const { installLocalDbIpc, initLocalDb } = require('./localDb.cjs')
const { syncOfflineUi } = require('./uiSync.cjs')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const APP_ICON_PATH = (() => {
  const ico = path.join(__dirname, 'icon.ico')
  const png = path.join(__dirname, 'icon.png')
  try {
    if (require('fs').existsSync(ico)) return ico
  } catch { /* ignore */ }
  return png
})()
const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'printer-settings.json')
const LABEL_DESIGN_PATH = () => path.join(app.getPath('userData'), 'label-design.json')
const USER_CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json')
const DEFAULT_TRADE_URL = 'https://kakappo.shop/trade'
const BOOT_LOG_PATH = () => path.join(app.getPath('userData'), 'kassa-boot.log')

let mainWindow = null
let printWindow = null
let allowMainWindowClose = false
/** Опрос версии UI с сайта — после деплоя Electron сам обновляет экран */
let uiVersionPollTimer = null
/** Если сидим на локальном UI при живом интернете — возвращаемся на сайт */
let remoteRecoveryTimer = null
let lastUiVersion = ''
let offlineUiSyncTimer = null

function bootLog(msg, extra) {
  const line = `[${new Date().toISOString()}] ${msg}${extra != null ? ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`
  try { console.log(line) } catch { /* ignore */ }
  try {
    fs.mkdirSync(path.dirname(BOOT_LOG_PATH()), { recursive: true })
    fs.appendFileSync(BOOT_LOG_PATH(), line + '\n', 'utf8')
  } catch { /* ignore */ }
}

function tradeOriginFromUrl(url) {
  try { return new URL(String(url || '')).origin } catch { return '' }
}

function isRemoteTradeLoaded() {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const u = mainWindow.webContents.getURL() || ''
  return /^https?:\/\//i.test(u) && !/127\.0\.0\.1|localhost/i.test(u)
}

function isLocalTradeLoaded() {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const u = mainWindow.webContents.getURL() || ''
  return /127\.0\.0\.1|localhost/i.test(u)
}

function attachKeyboardFocusFix(win) {
  if (!win || win.isDestroyed()) return
  const ping = () => {
    if (!win || win.isDestroyed()) return
    try {
      if (!win.isFocused()) return
      const wc = win.webContents
      if (!wc || wc.isDestroyed()) return
      if (typeof wc.isDevToolsFocused === 'function' && wc.isDevToolsFocused()) return
      if (typeof wc.isFocused === 'function' && wc.isFocused()) return
      wc.focus()
    } catch { /* ignore */ }
  }
  win.on('focus', ping)
  win.on('restore', ping)
  win.on('show', ping)
  win.on('maximize', () => setTimeout(ping, 40))
  win.on('enter-full-screen', () => setTimeout(ping, 60))
  win.on('leave-full-screen', () => setTimeout(ping, 60))
  win.webContents.on('devtools-closed', ping)
  win.webContents.on('did-finish-load', () => setTimeout(ping, 80))
  if (process.platform === 'win32') {
    try {
      win.hookWindowMessage(0x0006, () => { setTimeout(ping, 0) })
      win.hookWindowMessage(0x0007, () => { setTimeout(ping, 0) })
    } catch { /* ignore */ }
  }
  const tick = setInterval(ping, 400)
  win.on('closed', () => clearInterval(tick))
}

function buildRemoteTarget(remoteUrl) {
  try {
    const u = new URL(remoteUrl)
    u.searchParams.set('_kassa', String(app.getVersion() || '0'))
    u.searchParams.set('_r', String(Date.now()))
    return u.toString()
  } catch {
    return remoteUrl
  }
}

async function fetchUiVersion(baseUrl) {
  try {
    const origin = tradeOriginFromUrl(baseUrl) || 'https://kakappo.shop'
    const res = await fetch(`${origin}/api/kassa-ui-version?_=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return ''
    const j = await res.json()
    return String(j?.v || '').trim()
  } catch {
    return ''
  }
}

/** Обновить UI с сайта. НЕ трогает SQLite / userData / серверные данные. */
async function softRefreshRemoteUi(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (!isRemoteTradeLoaded()) return false
  bootLog('ui soft refresh', reason)
  try {
    await mainWindow.webContents.session.clearCache()
  } catch { /* ignore */ }
  try {
    mainWindow.webContents.reloadIgnoringCache()
    return true
  } catch {
    const remoteUrl = String(loadConfig().tradeUrl || DEFAULT_TRADE_URL)
    try {
      mainWindow.loadURL(buildRemoteTarget(remoteUrl))
      return true
    } catch {
      try {
        mainWindow.loadURL(remoteUrl)
        return true
      } catch {
        return false
      }
    }
  }
}

function startUiVersionPoller(remoteUrl) {
  if (uiVersionPollTimer) {
    clearInterval(uiVersionPollTimer)
    uiVersionPollTimer = null
  }
  const tick = async () => {
    if (!isRemoteTradeLoaded()) return
    const v = await fetchUiVersion(remoteUrl)
    if (!v) return
    if (!lastUiVersion) {
      lastUiVersion = v
      bootLog('ui version', v)
      return
    }
    if (v !== lastUiVersion) {
      bootLog('ui version changed', { from: lastUiVersion, to: v })
      lastUiVersion = v
      await softRefreshRemoteUi('deploy-detected')
    }
  }
  void tick()
  uiVersionPollTimer = setInterval(() => { void tick() }, 45000)
}

function stopUiVersionPoller() {
  if (uiVersionPollTimer) {
    clearInterval(uiVersionPollTimer)
    uiVersionPollTimer = null
  }
}

/** Раньше: при появлении сети уходил на сайт. Теперь local-first — только фоновый sync UI. */
function startRemoteRecoveryPoller(_remoteUrl) {
  stopRemoteRecoveryPoller()
  // Не переключаем окно на сайт — касса остаётся на локальном UI (как на схеме).
  scheduleOfflineUiSync()
}

function stopRemoteRecoveryPoller() {
  if (remoteRecoveryTimer) {
    clearInterval(remoteRecoveryTimer)
    remoteRecoveryTimer = null
  }
}

async function runOfflineUiSync(reason) {
  try {
    const userData = app.getPath('userData')
    const result = await syncOfflineUi(userData, { log: bootLog })
    bootLog('offline ui sync', { reason, ...result })
    if (result?.updated) {
      if (isLocalTradeLoaded() && mainWindow && !mainWindow.isDestroyed()) {
        bootLog('restart local UI after ui-sync')
        const url = await restartLocalUi({ timeoutMs: 25000 })
        if (url) mainWindow.loadURL(url)
      } else {
        // Сбросить процесс на старой сборке — следующий офлайн возьмёт ui-cache
        stopLocalUi()
      }
    }
    return result
  } catch (err) {
    bootLog('offline ui sync error', err?.message || String(err))
    return null
  }
}

function scheduleOfflineUiSync() {
  // Сразу после выхода в онлайн + периодически
  void runOfflineUiSync('boot-or-online')
  if (offlineUiSyncTimer) return
  offlineUiSyncTimer = setInterval(() => {
    void (async () => {
      if (!(await probeRemoteReachable(1500))) return
      await runOfflineUiSync('interval')
    })()
  }, 15 * 60 * 1000)
}

// На слабых кассовых ПК GPU/полноэкран часто дают чёрный экран и вылет.
try {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('in-process-gpu')
} catch { /* ignore */ }

process.on('uncaughtException', err => {
  bootLog('uncaughtException', err?.stack || String(err))
})
process.on('unhandledRejection', err => {
  bootLog('unhandledRejection', err?.stack || String(err))
})

// Разрешаем service worker при загрузке интерфейса с http-сервера (иначе касса не открывается офлайн).
// Service worker требует «безопасный контекст»; помечаем origin кассы как доверенный.
try {
  const bootCfg = loadConfigSync()
  const tradeOrigin = new URL(String(bootCfg.tradeUrl || DEFAULT_TRADE_URL)).origin
  if (tradeOrigin && tradeOrigin.startsWith('http://')) {
    app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', tradeOrigin)
  }
} catch { /* origin не распознан — офлайн-оболочка недоступна */ }

const DEFAULT_SETTINGS = {
  printerName: '',
  paperWidthMm: 58,
  labelPrinterName: '',
  scaleMode: 'plu-label',
  scaleHost: '192.168.1.10',
  scalePort: 20304,
  scaleDept: 1,
  /** Живой вес в POS по TCP */
  scaleLiveWeight: true,
}

/** Конфиг рядом с приложением + переопределение из userData */
function loadConfigSync() {
  let base = { tradeUrl: DEFAULT_TRADE_URL, window: { width: 1360, height: 900, fullscreen: false } }
  try {
    base = { ...base, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
  } catch { /* packaged default */ }
  try {
    if (typeof app !== 'undefined' && app.getPath) {
      const userCfg = path.join(app.getPath('userData'), 'config.json')
      if (fs.existsSync(userCfg)) {
        base = { ...base, ...JSON.parse(fs.readFileSync(userCfg, 'utf8')) }
      }
    }
  } catch { /* ignore */ }
  const rawUrl = String(base.tradeUrl || '')
  if (/46\.225\.92\.161|46\.255\.92\.161/.test(rawUrl) || !rawUrl.trim()) {
    base.tradeUrl = DEFAULT_TRADE_URL
  }
  // Полноэкран после загрузки (не при create) — иначе на части ПК чёрный экран/вылет
  base.window = { width: 1360, height: 900, fullscreen: false, ...(base.window || {}) }
  return base
}

function loadConfig() {
  return loadConfigSync()
}

function saveUserConfig(patch) {
  const cur = loadConfig()
  const next = { ...cur, ...patch }
  fs.mkdirSync(path.dirname(USER_CONFIG_PATH()), { recursive: true })
  fs.writeFileSync(USER_CONFIG_PATH(), JSON.stringify(next, null, 2), 'utf8')
  return next
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
      scaleHost: String(raw.scaleHost || '').trim() || '192.168.1.10',
      scalePort: Number(raw.scalePort) || 20304,
      scaleDept: Number(raw.scaleDept) || 1,
      scaleLiveWeight: raw.scaleLiveWeight !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function savePrinterSettings(next) {
  const cur = loadPrinterSettings()
  const port = Number(next.scalePort ?? cur.scalePort) || 20304
  const scaleMode = next.scaleMode !== undefined
    ? (next.scaleMode === 'none' ? 'none' : 'plu-label')
    : (cur.scaleMode === 'none' ? 'none' : 'plu-label')
  const merged = {
    printerName: String(next.printerName ?? cur.printerName ?? ''),
    paperWidthMm: Number(next.paperWidthMm) === 80 ? 80 : 58,
    labelPrinterName: String(next.labelPrinterName ?? cur.labelPrinterName ?? ''),
    scaleMode,
    scaleHost: String(next.scaleHost !== undefined ? next.scaleHost : (cur.scaleHost ?? '')).trim(),
    scalePort: port > 0 && port < 65536 ? port : 20304,
    scaleDept: Math.max(1, Math.min(99, Number(next.scaleDept ?? cur.scaleDept) || 1)),
    scaleLiveWeight: next.scaleLiveWeight != null ? !!next.scaleLiveWeight : cur.scaleLiveWeight !== false,
  }
  fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

function loadLabelDesignFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(LABEL_DESIGN_PATH(), 'utf8'))
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    return null
  }
}

function saveLabelDesignFile(design) {
  if (!design || typeof design !== 'object') return { ok: false }
  fs.mkdirSync(path.dirname(LABEL_DESIGN_PATH()), { recursive: true })
  fs.writeFileSync(LABEL_DESIGN_PATH(), JSON.stringify(design, null, 2), 'utf8')
  return { ok: true }
}

function broadcastCasWeight(payload) {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send('desktop:casWeight', payload)
    }
  }
}

function buildAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'KAKAPO',
      submenu: [
        {
          label: 'Сменить адрес сервера…',
          click: () => {
            if (!mainWindow) return
            const cur = loadConfig().tradeUrl || DEFAULT_TRADE_URL
            const win = mainWindow
            // простой prompt через dialog не умеет input — открываем html
            win.webContents.executeJavaScript(
              `window.prompt('Адрес кассы (URL)', ${JSON.stringify(cur)})`,
            ).then(next => {
              const url = String(next || '').trim()
              if (!url) return
              try { new URL(url) } catch {
                dialog.showErrorBox('Ошибка', 'Некорректный URL')
                return
              }
              saveUserConfig({ tradeUrl: url })
              win.loadURL(url)
            }).catch(() => {})
          },
        },
        {
          label: 'Открыть в браузере',
          click: () => {
            const url = loadConfig().tradeUrl || DEFAULT_TRADE_URL
            shell.openExternal(url)
          },
        },
        {
          label: 'Обновить локальный UI с сервера',
          click: () => {
            void (async () => {
              if (!mainWindow || mainWindow.isDestroyed()) return
              await runOfflineUiSync('menu')
              const local = localUiUrl() || await startLocalUi({ timeoutMs: 25000 }).catch(() => '')
              if (local && mainWindow && !mainWindow.isDestroyed()) {
                stopUiVersionPoller()
                mainWindow.loadURL(local)
              } else {
                dialog.showErrorBox('Обновление', 'Не удалось обновить встроенный интерфейс. Проверьте интернет.')
              }
            })()
          },
        },
        {
          label: 'Открыть сайт (онлайн UI)',
          click: () => {
            const url = loadConfig().tradeUrl || DEFAULT_TRADE_URL
            if (mainWindow && !mainWindow.isDestroyed()) {
              try {
                mainWindow.loadURL(buildRemoteTarget(url))
                startUiVersionPoller(url)
                scheduleOfflineUiSync()
              } catch {
                mainWindow.loadURL(url)
              }
            }
          },
        },
        {
          label: 'Вернуть локальную кассу',
          click: () => {
            stopUiVersionPoller()
            void (async () => {
              let local = localUiUrl()
              if (!local) {
                try { local = await startLocalUi({ timeoutMs: 25000 }) } catch { /* ignore */ }
              }
              if (!local) {
                dialog.showErrorBox('Недоступно', 'Встроенная сборка интерфейса не найдена в этой версии приложения.')
                return
              }
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(local)
                scheduleOfflineUiSync()
              }
            })()
          },
        },
        {
          label: 'Синхронизировать офлайн-интерфейс',
          click: () => {
            void (async () => {
              const r = await runOfflineUiSync('menu')
              const msg = r?.updated
                ? `Офлайн-UI обновлён (${r.version}). При следующем запуске без интернета будет новый код.`
                : (r?.reason === 'current'
                  ? `Уже актуально (${r.version || '—'}).`
                  : `Не удалось: ${r?.reason || 'нет пакета на сервере'}. Нужен файл на https://kakappo.shop/updates/kassa-ui/`)
              dialog.showMessageBox(mainWindow, {
                type: r?.updated ? 'info' : 'warning',
                title: 'Офлайн-интерфейс',
                message: msg,
              }).catch(() => {})
            })()
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'forceReload', label: 'Жёсткое обновление' },
        { role: 'toggleDevTools', label: 'DevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]))
}

function showLoadErrorPage(win, url, errorCode, errorDescription) {
  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>КАКАПО Касса</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#030B05;color:#EBF5ED;font-family:Segoe UI,system-ui,sans-serif;padding:24px}
.card{max-width:520px;background:#0C1C0F;border:1px solid #162B1A;border-radius:16px;padding:24px}
h1{margin:0 0 10px;font-size:18px;color:#1FD760}
p{margin:8px 0;color:#8FB897;font-size:13px;line-height:1.5;word-break:break-all}
code{color:#FFB800}
button{margin-top:14px;margin-right:8px;padding:10px 14px;border-radius:10px;border:none;
background:#1FD760;color:#030B05;font-weight:700;cursor:pointer}
button.sec{background:#162B1A;color:#EBF5ED}
</style></head><body><div class="card">
<h1>Не удалось открыть кассу</h1>
<p>Адрес: <code>${String(url).replace(/</g, '')}</code></p>
<p>Ошибка ${errorCode}: ${String(errorDescription || '').replace(/</g, '')}</p>
<p>Проверьте интернет и что сайт открывается в браузере:<br/>
<code>https://kakappo.shop/trade</code></p>
<button onclick="location.reload()">Повторить</button>
<button class="sec" onclick="location.href='https://kakappo.shop/trade'">Открыть kakappo.shop</button>
</div></body></html>`
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function splashHtml(msg) {
  const text = String(msg || 'Загрузка кассы…').replace(/</g, '')
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>КАКАПО Касса</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0a1a12;color:#EBF5ED;font-family:Segoe UI,system-ui,sans-serif}
.box{text-align:center}
h1{margin:0 0 8px;font-size:28px;letter-spacing:.08em;color:#1FD760}
p{margin:0;color:#8FB897;font-size:14px}
.spin{width:28px;height:28px;margin:18px auto 0;border:3px solid #1a3d28;border-top-color:#1FD760;
border-radius:50%;animation:s .7s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
</style></head><body><div class="box">
<h1>КАКАПО</h1>
<p>${text}</p>
<div class="spin"></div>
</div></body></html>`
}

/** Быстрая проверка: есть ли ответ от сайта (не путать с Wi‑Fi без интернета) */
function probeRemoteReachable(timeoutMs = 1500) {
  return new Promise(resolve => {
    try {
      const https = require('https')
      const req = https.get('https://kakappo.shop/health', { timeout: timeoutMs, servername: 'kakappo.shop' }, res => {
        res.resume()
        resolve(res.statusCode > 0 && res.statusCode < 500)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        try { req.destroy() } catch { /* ignore */ }
        resolve(false)
      })
    } catch {
      resolve(false)
    }
  })
}

function createWindow(localUrl = '') {
  const config = loadConfig()
  const winCfg = config.window || {}
  const isDev = process.argv.includes('--dev')
  const wantFullscreen = winCfg.fullscreen !== false

  try {
    saveUserConfig({ tradeUrl: config.tradeUrl || DEFAULT_TRADE_URL })
  } catch { /* ignore */ }

  bootLog('createWindow start', { version: app.getVersion(), wantFullscreen })

  const splashPath = path.join(__dirname, 'splash.html')

  // Не показываем пустое чёрное окно — сначала splash, потом show
  mainWindow = new BrowserWindow({
    width: Number(winCfg.width) || 1360,
    height: Number(winCfg.height) || 900,
    minWidth: 1024,
    minHeight: 700,
    fullscreen: false,
    title: 'KAKAPO Касса',
    icon: APP_ICON_PATH,
    backgroundColor: '#0a1a12',
    autoHideMenuBar: true,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  const remoteUrl = String(config.tradeUrl || DEFAULT_TRADE_URL).trim() || DEFAULT_TRADE_URL
  let offlineUrl = String(localUrl || '').trim()
  let triedLocalFallback = false
  let enteredFullscreen = false
  let contentShown = false
  let bootGen = 0

  const splashReady = new Promise(resolve => {
    mainWindow.once('ready-to-show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.maximize() } catch { /* ignore */ }
        mainWindow.show()
      }
      resolve()
    })
    // страховка: не держать окно скрытым дольше 1.2с
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        try { mainWindow.maximize() } catch { /* ignore */ }
        mainWindow.show()
      }
      resolve()
    }, 1200)
  })

  if (fs.existsSync(splashPath)) {
    mainWindow.loadFile(splashPath).catch(() => {
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`).catch(() => {})
    })
  } else {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`).catch(() => {})
  }

  mainWindow.setFullScreenable(true)
  attachKeyboardFocusFix(mainWindow)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat || !mainWindow || mainWindow.isDestroyed()) return
    const code = String(input.code || '')
    const key = String(input.key || '')
    const isF11 = code === 'F11' || key === 'F11'
    const isEsc = code === 'Escape' || key === 'Escape' || key === 'Esc'
    if (isF11) {
      event.preventDefault()
      const next = !mainWindow.isFullScreen()
      mainWindow.setFullScreen(next)
      if (!next && mainWindow.isMaximized()) mainWindow.unmaximize()
      return
    }
    if (isEsc && mainWindow.isFullScreen()) {
      event.preventDefault()
      mainWindow.setFullScreen(false)
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
    }
  })

  const enterFullscreenSafe = () => {
    if (enteredFullscreen || !wantFullscreen || !mainWindow || mainWindow.isDestroyed()) return
    enteredFullscreen = true
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(true)
      } catch (e) {
        bootLog('setFullScreen fail', e?.message || String(e))
      }
    }, 400)
  }

  const setSplashMsg = (msg) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const t = String(msg || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    mainWindow.webContents.executeJavaScript(
      `try{window.setSplash&&window.setSplash('${t}')}catch(e){}`,
      true,
    ).catch(() => {})
  }

  const ensureOfflineUi = async (timeoutMs = 20000) => {
    const live = localUiUrl()
    if (live) {
      offlineUrl = live
      return live
    }
    offlineUrl = ''
    try {
      offlineUrl = String(await startLocalUi({ timeoutMs }) || '').trim()
      bootLog('local UI', offlineUrl || '(empty)')
    } catch (err) {
      bootLog('local UI fail', err?.message || String(err))
    }
    return offlineUrl
  }

  const openUrl = (target) => {
    if (!mainWindow || mainWindow.isDestroyed() || !target) return
    mainWindow.loadURL(target).catch(err => {
      bootLog('openUrl fail', err?.message || String(err))
    })
  }

  const remoteTarget = buildRemoteTarget(remoteUrl)

  mainWindow.webContents.on('did-fail-load', async (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || !mainWindow || mainWindow.isDestroyed()) return
    if (errorCode === -3) return
    bootLog('did-fail-load', { errorCode, errorDescription, validatedURL })
    const v = String(validatedURL || '')
    if (v.startsWith('data:') || v.includes('splash.html')) return
    if (v.includes('127.0.0.1')) {
      setSplashMsg('Локальная касса перезапуск…')
      const local = await ensureOfflineUi(20000)
      if (local) openUrl(local)
      else showLoadErrorPage(mainWindow, remoteUrl, errorCode, errorDescription)
      return
    }
    // сайт не открылся — локально
    setSplashMsg('Переход в офлайн…')
    triedLocalFallback = true
    const local = await ensureOfflineUi(20000)
    if (local) {
      openUrl(local)
      startRemoteRecoveryPoller(remoteUrl)
    } else showLoadErrorPage(mainWindow, remoteUrl, errorCode, errorDescription)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    const loaded = mainWindow?.webContents.getURL() || ''
    bootLog('did-finish-load', loaded)
    mainWindow.webContents.executeJavaScript(
      "if(!window.__kakapoKbFocus){window.__kakapoKbFocus=true;window.addEventListener('focus',function(){var el=document.activeElement;if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable)){try{el.focus()}catch(e){}}});}",
      true,
    ).catch(() => {})
    if (/^https?:\/\//i.test(loaded)) {
      contentShown = true
      enterFullscreenSafe()
      if (isRemoteTradeLoaded()) {
        stopRemoteRecoveryPoller()
        scheduleOfflineUiSync()
      } else if (isLocalTradeLoaded()) {
        scheduleOfflineUiSync()
      }
    }
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    bootLog('render-process-gone', details)
  })

  // Local-first (как на схеме): всегда локальный UI → очередь → сервер в фоне.
  // Сайт — только запасной, если встроенный UI недоступен.
  void (async () => {
    const gen = ++bootGen
    await splashReady
    if (!mainWindow || mainWindow.isDestroyed() || gen !== bootGen) return

    setSplashMsg('Запуск локальной кассы…')
    const local = await ensureOfflineUi(25000)
    if (gen !== bootGen || !mainWindow || mainWindow.isDestroyed()) return

    if (local) {
      stopUiVersionPoller()
      stopRemoteRecoveryPoller()
      bootLog('boot → local-first', local)
      setSplashMsg('Локальная касса…')
      openUrl(local)
      // Фон: подтянуть пакет UI и данные, не уходя на сайт
      scheduleOfflineUiSync()
      void probeRemoteReachable(2000).then(online => {
        if (online) scheduleOfflineUiSync()
      })
      return
    }

    setSplashMsg('Проверка связи…')
    const online = await probeRemoteReachable(2000)
    if (gen !== bootGen || !mainWindow || mainWindow.isDestroyed()) return

    if (online) {
      bootLog('boot → remote fallback (no local UI)', remoteTarget)
      setSplashMsg('Загрузка с сервера…')
      try { await mainWindow.webContents.session.clearCache() } catch { /* ignore */ }
      openUrl(remoteTarget)
      startUiVersionPoller(remoteUrl)
      scheduleOfflineUiSync()
      return
    }

    showLoadErrorPage(mainWindow, remoteUrl, -1, 'Нет локального интерфейса и нет интернета')
  })()

  mainWindow.webContents.setWindowOpenHandler(({ url: openUrlExt }) => {
    shell.openExternal(openUrlExt)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('close', event => {
    if (allowMainWindowClose) return
    if (!mainWindow || mainWindow.isDestroyed()) return
    event.preventDefault()
    try {
      const answer = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        title: 'Закрыть KAKAPO Касса?',
        message: 'Вы действительно хотите выйти из приложения?',
        detail: 'Открытые несохранённые действия могут быть потеряны.',
        buttons: ['Выйти', 'Отмена'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (answer === 0) {
        allowMainWindowClose = true
        mainWindow.close()
      }
    } catch (err) {
      bootLog('close dialog fail — оставляем окно', err?.message || String(err))
    }
  })

  mainWindow.on('closed', () => {
    bootLog('window closed')
    stopUiVersionPoller()
    mainWindow = null
    allowMainWindowClose = false
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

/** Кэш списка принтеров — EnumPrinters в Windows часто 5–15с */
let printersCache = { at: 0, list: null }
const PRINTERS_CACHE_MS = 60_000

async function getPrintersCached(force = false) {
  const now = Date.now()
  if (!force && printersCache.list && (now - printersCache.at) < PRINTERS_CACHE_MS) {
    return printersCache.list
  }
  const list = await getPrintersAsync()
  printersCache = { at: now, list: list || [] }
  return printersCache.list
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
    const printers = await getPrintersCached()
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

/**
 * Быстрый путь: если имя принтера уже сохранено — печатаем сразу.
 * Полный опрос Windows (медленный) — только если имени нет или forceVerify.
 */
async function ensureReceiptPrinterName(preferred, { forceVerify = false } = {}) {
  const settings = loadPrinterSettings()
  let printerName = await resolveReceiptPrinterName(preferred)
  if (!printerName) {
    let printers = []
    try { printers = await getPrintersCached(true) } catch { /* ignore */ }
    throw new Error(describeMissingReceiptPrinter(printers))
  }
  if (!forceVerify) return printerName
  try {
    const printers = await getPrintersCached(true)
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

  // Формат 58 мм: дефолт + сохранённый редактор шаблона из Trade.
  const storeOpts = {
    ...normalizeReceiptTemplate({ ...DEFAULT_RECEIPT_TEMPLATE, ...options }),
    posLabel: options.posLabel,
    cashierName: options.cashierName,
  }

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

/**
 * Интерфейс крутится на http://127.0.0.1, а API — на kakappo.shop.
 * Без CORS браузер Electron режет ответы. Подставляем заголовки сами,
 * чтобы касса ходила на API напрямую (без медленного локального Next-прокси).
 */
function installApiCorsBypass() {
  const filter = { urls: ['https://kakappo.shop/*', 'http://kakappo.shop/*'] }
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...(details.responseHeaders || {}) }
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Headers'] = ['*']
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, PATCH, DELETE, OPTIONS']
    // убрать возможный конфликт с credentials
    delete headers['access-control-allow-credentials']
    delete headers['Access-Control-Allow-Credentials']
    callback({ responseHeaders: headers })
  })
}

app.whenReady().then(async () => {
  bootLog('whenReady', { version: app.getVersion(), electron: process.versions.electron })
  try { buildAppMenu() } catch (e) { bootLog('menu', e?.message || String(e)) }
  try { installApiCorsBypass() } catch (e) { bootLog('cors bypass', e?.message || String(e)) }
  try {
    initLocalDb()
    installLocalDbIpc()
  } catch (e) {
    bootLog('localDb', e?.stack || String(e))
  }
  try {
    const inv = invalidateUiCacheOnAppUpdate()
    bootLog('ui-cache invalidate', inv)
  } catch (e) {
    bootLog('ui-cache invalidate fail', e?.message || String(e))
  }
  // Локальный UI греем сразу — к открытию окна уже почти готов
  void startLocalUi({ timeoutMs: 25000 }).catch(err => bootLog('early local UI', err?.message || String(err)))
  try {
    createWindow(localUiUrl() || '')
  } catch (e) {
    bootLog('createWindow throw', e?.stack || String(e))
  }
  try { installUpdaterIpc(() => mainWindow) } catch (e) { bootLog('updater ipc', e?.message || String(e)) }

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

  ipcMain.handle('desktop:getLabelDesign', () => loadLabelDesignFile())

  ipcMain.handle('desktop:saveLabelDesign', (_e, design) => saveLabelDesignFile(design || null))

  ipcMain.handle('desktop:printHtml', async (_e, html, options) => {
    const opts = options || {}
    if (opts.role === 'label') {
      if (!html || typeof html !== 'string') throw new Error('Пустой документ печати')
    }
    return printHtml(typeof html === 'string' ? html : '', opts)
  })

  ipcMain.handle('desktop:printReceipt', async (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {}
    return printHtml('', {
      role: 'receipt',
      printerName: p.printerName,
      paperWidthMm: 58,
      sale: p.sale,
      ...normalizeReceiptTemplate({ ...DEFAULT_RECEIPT_TEMPLATE, ...p }),
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

  weightMonitor.setListener(payload => broadcastCasWeight(payload))

  ipcMain.handle('desktop:startCasWeight', async (_e, payload) => {
    const settings = loadPrinterSettings()
    const host = String(payload?.host || settings.scaleHost || '').trim()
    const port = Number(payload?.port || settings.scalePort) || 20304
    return weightMonitor.start({
      host,
      port,
      intervalMs: payload?.intervalMs,
    })
  })

  ipcMain.handle('desktop:stopCasWeight', async () => weightMonitor.stop())

  ipcMain.handle('desktop:readCasWeight', async (_e, payload) => {
    const settings = loadPrinterSettings()
    const host = String(payload?.host || settings.scaleHost || '').trim()
    const port = Number(payload?.port || settings.scalePort) || 20304
    // forceDirect только если явно true (иначе каждый опрос рвал монитор)
    const forceDirect = payload?.forceDirect === true || payload?.fresh === true
    try {
      return await readLiveWeight({
        host,
        port,
        timeoutMs: payload?.timeoutMs,
        forceDirect,
      })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const hint = /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|Таймаут|Nет связи|Нет ответа/i.test(raw)
        ? ` Нет связи с ${host}:${port}. ПК и весы должны быть в одной сети (касса обычно 192.168.1.2, весы 192.168.1.10). Сейчас проверьте кабель Ethernet к весам.`
        : ''
      throw new Error((raw.replace(/^Error:\s*/i, '') + hint).trim())
    }
  })

  ipcMain.handle('desktop:getLocalIpv4', () => {
    const os = require('os')
    const nets = os.networkInterfaces()
    const list = []
    for (const name of Object.keys(nets || {})) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          list.push({ name, address: net.address, netmask: net.netmask })
        }
      }
    }
    return { ok: true, list }
  })

  ipcMain.handle('desktop:getCasWeightStatus', () => ({
    running: weightMonitor.running,
    connected: weightMonitor.connected,
    host: weightMonitor.host,
    port: weightMonitor.port,
    error: weightMonitor.lastError || '',
  }))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(localUiUrl())
  })
})

app.on('window-all-closed', () => {
  try { weightMonitor.stop() } catch { /* ignore */ }
  stopLocalUi()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopLocalUi()
})
