'use strict'

/**
 * Локальный Next-сервер внутри кассы.
 *
 * Интерфейс лежит в ресурсах приложения (desktop/ui), поэтому окно
 * открывается даже без интернета. Запросы к API идут на тот же origin
 * (/api/kakapo/*) и проксируются сборкой на сервер КАКАПО — CORS не нужен.
 */

const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')
const { readUiBuiltAtMs } = require('./uiSync.cjs')

let child = null
let startedUrl = ''

/**
 * Каталог со сборкой:
 * 1) userData/ui-cache — только если скачан ПОСЛЕ этой версии Setup
 *    и пакет не старше UI из установщика
 * 2) resources/ui — то, что было в Setup.exe
 * 3) desktop/ui — dev
 */
function resolveUiDir() {
  const candidates = []
  let cacheDir = ''
  let appVersion = ''
  try {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      cacheDir = path.join(app.getPath('userData'), 'ui-cache')
      try { appVersion = String(app.getVersion() || '') } catch { /* ignore */ }
    }
  } catch { /* вне Electron — пропускаем */ }

  const bundled = []
  if (process.resourcesPath) bundled.push(path.join(process.resourcesPath, 'ui'))
  bundled.push(path.join(__dirname, 'ui'))

  let bundledAt = 0
  for (const dir of bundled) {
    try {
      if (fs.existsSync(path.join(dir, 'server.js'))) {
        bundledAt = readUiBuiltAtMs(dir)
        break
      }
    } catch { /* ignore */ }
  }

  const cacheOk = (() => {
    try {
      if (!cacheDir || !fs.existsSync(path.join(cacheDir, 'server.js'))) return false
      if (!appVersion) return true
      let stamp = ''
      try { stamp = fs.readFileSync(path.join(cacheDir, 'app-version.txt'), 'utf8').trim() } catch { /* empty */ }
      if (stamp !== appVersion) return false
      // Старый zip с канала не должен бить свежий Setup (даже со штампом app-version)
      const cacheAt = readUiBuiltAtMs(cacheDir)
      if (bundledAt > 0 && (!cacheAt || cacheAt < bundledAt)) return false
      return true
    } catch {
      return false
    }
  })()

  if (cacheOk) candidates.push(cacheDir)
  candidates.push(...bundled)
  // Запасной вариант: старый кэш без штампа (только если нет bundled)
  if (cacheDir && !cacheOk) {
    try {
      if (fs.existsSync(path.join(cacheDir, 'server.js'))) candidates.push(cacheDir)
    } catch { /* ignore */ }
  }

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'server.js'))) return dir
    } catch { /* нет доступа — пробуем следующий */ }
  }
  return ''
}

/** Сброс ui-cache при смене версии Setup — чтобы сразу шёл UI из установщика */
function invalidateUiCacheOnAppUpdate() {
  try {
    const { app } = require('electron')
    if (!app || typeof app.getPath !== 'function') return { cleared: false }
    const userData = app.getPath('userData')
    const ver = String(app.getVersion() || '')
    const marker = path.join(userData, 'ui-cache-for-app.txt')
    let prev = ''
    try { prev = fs.readFileSync(marker, 'utf8').trim() } catch { /* ignore */ }
    if (prev === ver) return { cleared: false, version: ver }
    const cache = path.join(userData, 'ui-cache')
    if (fs.existsSync(cache)) {
      const bak = path.join(userData, `ui-cache-stale-${Date.now()}`)
      try { fs.renameSync(cache, bak) } catch {
        try { fs.rmSync(cache, { recursive: true, force: true }) } catch { /* ignore */ }
      }
      // не копим вечно
      try { fs.rmSync(bak, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    try { fs.writeFileSync(marker, `${ver}\n`, 'utf8') } catch { /* ignore */ }
    return { cleared: true, version: ver, from: prev || null }
  } catch (e) {
    return { cleared: false, error: e?.message || String(e) }
  }
}

function freePort() {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', () => resolve(0))
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address()?.port || 0
      srv.close(() => resolve(port))
    })
  })
}

function ping(url) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child && child.exitCode != null) return false
    if (await ping(url)) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

/**
 * Поднимает интерфейс локально и возвращает адрес страницы кассы.
 * Возвращает пустую строку, если сборки нет или сервер не стартовал —
 * тогда вызывающий код грузит удалённый адрес, как раньше.
 */
async function startLocalUi({ timeoutMs = 20000 } = {}) {
  if (startedUrl) return startedUrl

  const uiDir = resolveUiDir()
  if (!uiDir) {
    console.warn('[kakapo-desktop] Локальная сборка интерфейса не найдена')
    return ''
  }

  const port = await freePort()
  if (!port) {
    console.warn('[kakapo-desktop] Не удалось выбрать порт для локального интерфейса')
    return ''
  }

  child = spawn(process.execPath, [path.join(uiDir, 'server.js')], {
    cwd: uiDir,
    env: {
      ...process.env,
      // Electron должен запустить файл как обычный Node-процесс
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  child.stdout?.on('data', d => console.log('[kakapo-ui]', String(d).trim()))
  child.stderr?.on('data', d => console.error('[kakapo-ui]', String(d).trim()))
  child.on('exit', code => {
    console.warn('[kakapo-desktop] локальный интерфейс остановлен, код', code)
    child = null
    startedUrl = ''
  })

  const base = `http://127.0.0.1:${port}`
  // / быстрее /trade при холодном старте Next
  const ready = (await waitReady(`${base}/`, Math.min(8000, timeoutMs)))
    || (await waitReady(`${base}/trade`, timeoutMs))
  if (!ready) {
    console.warn('[kakapo-desktop] локальный интерфейс не ответил вовремя')
    stopLocalUi()
    return ''
  }

  startedUrl = `${base}/trade`
  console.log('[kakapo-desktop] локальный интерфейс готов:', startedUrl)
  return startedUrl
}

function stopLocalUi() {
  if (!child) return
  try {
    child.kill()
  } catch { /* уже завершён */ }
  child = null
  startedUrl = ''
}

/** Перезапуск локального UI (после обновления ui-cache). */
async function restartLocalUi({ timeoutMs = 20000 } = {}) {
  stopLocalUi()
  return startLocalUi({ timeoutMs })
}

function localUiUrl() {
  return startedUrl
}

module.exports = {
  startLocalUi,
  stopLocalUi,
  restartLocalUi,
  localUiUrl,
  resolveUiDir,
  invalidateUiCacheOnAppUpdate,
}
