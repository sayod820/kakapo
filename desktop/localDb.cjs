'use strict'

/**
 * Локальная база кассы на диске ПК (userData).
 * Атомарная запись: temp → rename — переживает обрыв света.
 * Флаг INSTALL_OK — установка завершена, больше не просим интернет.
 */

const fs = require('fs')
const path = require('path')
const { app, ipcMain } = require('electron')

const FILE_KV = 'local-kv.json'
const FILE_QUEUE = 'local-queue.json'
const FILE_META = 'local-meta.json'
const FILE_INSTALL_OK = 'INSTALL_OK'

let rootDir = ''
let kvCache = null
let queueCache = null
let metaCache = null

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function dbPath(name) {
  return path.join(rootDir, name)
}

function readJson(file, fallback) {
  try {
    const p = dbPath(file)
    if (!fs.existsSync(p)) return fallback
    const raw = fs.readFileSync(p, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    try {
      const bak = dbPath(file + '.bak')
      if (fs.existsSync(bak)) return JSON.parse(fs.readFileSync(bak, 'utf8'))
    } catch { /* ignore */ }
    return fallback
  }
}

function atomicWrite(file, data) {
  ensureDir(rootDir)
  const p = dbPath(file)
  const tmp = p + '.tmp'
  const bak = p + '.bak'
  const json = typeof data === 'string' ? data : JSON.stringify(data)
  fs.writeFileSync(tmp, json, 'utf8')
  try {
    if (fs.existsSync(p)) {
      try { fs.copyFileSync(p, bak) } catch { /* ignore */ }
    }
    fs.renameSync(tmp, p)
  } catch {
    fs.writeFileSync(p, json, 'utf8')
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}

function loadKv() {
  if (!kvCache) kvCache = readJson(FILE_KV, {})
  if (!kvCache || typeof kvCache !== 'object') kvCache = {}
  return kvCache
}

function loadQueue() {
  if (!queueCache) {
    const raw = readJson(FILE_QUEUE, [])
    queueCache = Array.isArray(raw) ? raw : []
  }
  return queueCache
}

function loadMeta() {
  if (!metaCache) metaCache = readJson(FILE_META, {})
  if (!metaCache || typeof metaCache !== 'object') metaCache = {}
  return metaCache
}

function saveKv() { atomicWrite(FILE_KV, loadKv()) }
function saveQueue() { atomicWrite(FILE_QUEUE, loadQueue()) }
function saveMeta() { atomicWrite(FILE_META, loadMeta()) }

function hasInstallOkFile() {
  try { return fs.existsSync(dbPath(FILE_INSTALL_OK)) } catch { return false }
}

function writeInstallOk() {
  ensureDir(rootDir)
  const stamp = new Date().toISOString()
  fs.writeFileSync(dbPath(FILE_INSTALL_OK), stamp, 'utf8')
  const meta = loadMeta()
  meta.bootstrapComplete = true
  meta.installComplete = true
  meta.lastBootstrapAt = stamp
  metaCache = meta
  saveMeta()
}

function catalogReady() {
  const kv = loadKv()
  const products = kv.catalog_products
  return Array.isArray(products) && products.length > 0
}

function isSetupComplete() {
  if (hasInstallOkFile()) return true
  if (loadMeta().bootstrapComplete || loadMeta().installComplete) return true
  // Данные уже на диске (старая сессия) — считаем установку завершённой
  if (catalogReady()) {
    writeInstallOk()
    return true
  }
  return false
}

function initLocalDb() {
  rootDir = path.join(app.getPath('userData'), 'kakapo-local-db')
  ensureDir(rootDir)
  loadKv()
  loadQueue()
  loadMeta()
  // самовосстановление флага, если каталог уже есть
  if (!hasInstallOkFile() && catalogReady()) writeInstallOk()
  return {
    root: rootDir,
    bootstrapComplete: isSetupComplete(),
    kvKeys: Object.keys(loadKv()).length,
    queueLen: loadQueue().length,
  }
}

function installLocalDbIpc() {
  initLocalDb()

  ipcMain.handle('desktop:localDbInfo', () => ({
    ok: true,
    root: rootDir,
    bootstrapComplete: isSetupComplete(),
    installComplete: isSetupComplete(),
    hasCatalog: catalogReady(),
    kvKeys: Object.keys(loadKv()).length,
    queueLen: loadQueue().length,
    lastBootstrapAt: loadMeta().lastBootstrapAt || null,
    lastSyncAt: loadMeta().lastSyncAt || null,
  }))

  ipcMain.handle('desktop:localDbKvGet', (_e, key) => {
    const k = String(key || '')
    if (!k) return null
    const kv = loadKv()
    return Object.prototype.hasOwnProperty.call(kv, k) ? kv[k] : null
  })

  ipcMain.handle('desktop:localDbKvSet', (_e, key, value) => {
    const k = String(key || '')
    if (!k) return { ok: false }
    const kv = loadKv()
    kv[k] = value
    saveKv()
    return { ok: true }
  })

  ipcMain.handle('desktop:localDbKvDelete', (_e, key) => {
    const k = String(key || '')
    if (!k) return { ok: false }
    const kv = loadKv()
    delete kv[k]
    saveKv()
    return { ok: true }
  })

  ipcMain.handle('desktop:localDbQueueAll', () => loadQueue().slice())

  ipcMain.handle('desktop:localDbQueuePut', (_e, row) => {
    if (!row || !row.clientRef) return { ok: false }
    const list = loadQueue()
    const idx = list.findIndex(r => r && r.clientRef === row.clientRef)
    if (idx >= 0) list[idx] = row
    else list.push(row)
    queueCache = list
    saveQueue()
    return { ok: true }
  })

  ipcMain.handle('desktop:localDbQueueDelete', (_e, clientRef) => {
    const id = String(clientRef || '')
    queueCache = loadQueue().filter(r => r && r.clientRef !== id)
    saveQueue()
    return { ok: true }
  })

  ipcMain.handle('desktop:localDbMetaGet', () => ({
    ...loadMeta(),
    bootstrapComplete: isSetupComplete(),
    installComplete: isSetupComplete(),
  }))

  ipcMain.handle('desktop:localDbMetaPatch', (_e, patch) => {
    const meta = loadMeta()
    Object.assign(meta, patch && typeof patch === 'object' ? patch : {})
    metaCache = meta
    saveMeta()
    if (meta.bootstrapComplete || meta.installComplete) {
      try { writeInstallOk() } catch { /* ignore */ }
    }
    return { ok: true, meta: { ...meta, bootstrapComplete: isSetupComplete() } }
  })

  ipcMain.handle('desktop:localDbMarkInstalled', () => {
    writeInstallOk()
    return { ok: true, bootstrapComplete: true }
  })
}

module.exports = {
  initLocalDb,
  installLocalDbIpc,
  isSetupComplete,
}
