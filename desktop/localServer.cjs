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

let child = null
let startedUrl = ''

/** Каталог со сборкой: в упакованном виде — resources/ui, в dev — desktop/ui */
function resolveUiDir() {
  const candidates = []
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'ui'))
  candidates.push(path.join(__dirname, 'ui'))
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'server.js'))) return dir
    } catch { /* нет доступа — пробуем следующий */ }
  }
  return ''
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
  const ready = await waitReady(`${base}/trade`, timeoutMs)
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

function localUiUrl() {
  return startedUrl
}

module.exports = { startLocalUi, stopLocalUi, localUiUrl, resolveUiDir }
