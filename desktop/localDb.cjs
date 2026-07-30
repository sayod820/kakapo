'use strict'

/**
 * Локальная база кассы.
 * При установке данные кладутся в $INSTDIR\kakapo-local-db (seed).
 * Рабочая копия — в userData (туда пишем очередь/чеки, чтобы не упираться в Program Files).
 */

const fs = require('fs')
const path = require('path')
const { app, ipcMain } = require('electron')

const FILE_KV = 'local-kv.json'
const FILE_QUEUE = 'local-queue.json'
const FILE_META = 'local-meta.json'
const FILE_INSTALL_OK = 'INSTALL_OK'

/** Крупные ключи — отдельные файлы, чтобы запись чека не переписывала весь каталог */
const HEAVY_KV_KEYS = new Set([
  'catalog_products',
  'catalog_clients',
  'catalog_employees_auth',
])

function heavyFileName(key) {
  return `kv-${String(key).replace(/[^\w.-]+/g, '_')}.json`
}

let rootDir = ''
let kvCache = null
let queueCache = null
let metaCache = null
let heavyLoaded = false

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function dbPath(name) {
  return path.join(rootDir, name)
}

function installSeedDir() {
  try {
    return path.join(path.dirname(process.execPath), 'kakapo-local-db')
  } catch {
    return ''
  }
}

function copyFileSafe(from, to) {
  try {
    if (fs.existsSync(from)) fs.copyFileSync(from, to)
  } catch (e) {
    console.error('[localDb] copy', from, e)
  }
}

/** Один раз: seed из папки установки → рабочая база userData */
function importInstallSeedIfNeeded(workDir) {
  const seed = installSeedDir()
  if (!seed || seed === workDir) return false
  const seedOk = path.join(seed, FILE_INSTALL_OK)
  const seedKv = path.join(seed, FILE_KV)
  if (!fs.existsSync(seedOk) && !fs.existsSync(seedKv)) return false

  const workOk = path.join(workDir, FILE_INSTALL_OK)
  const workKv = path.join(workDir, FILE_KV)
  // уже есть рабочая база с данными
  if (fs.existsSync(workOk) && fs.existsSync(workKv)) return false

  ensureDir(workDir)
  copyFileSafe(seedKv, path.join(workDir, FILE_KV))
  copyFileSafe(path.join(seed, FILE_META), path.join(workDir, FILE_META))
  copyFileSafe(path.join(seed, FILE_QUEUE), path.join(workDir, FILE_QUEUE))
  copyFileSafe(seedOk, workOk)
  if (!fs.existsSync(workOk) && fs.existsSync(workKv)) {
    fs.writeFileSync(workOk, new Date().toISOString(), 'utf8')
  }
  console.log('[localDb] импорт seed из установки →', workDir)
  return true
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
  if (!heavyLoaded) {
    heavyLoaded = true
    // Подтянуть тяжёлые ключи из отдельных файлов (и вынести из общего файла при первом save)
    for (const key of HEAVY_KV_KEYS) {
      const fromFile = readJson(heavyFileName(key), null)
      if (fromFile != null) {
        kvCache[key] = fromFile
      }
    }
  }
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

function saveLightKv() {
  const kv = loadKv()
  const light = {}
  for (const [key, value] of Object.entries(kv)) {
    if (!HEAVY_KV_KEYS.has(key)) light[key] = value
  }
  atomicWrite(FILE_KV, light)
}

function saveKv() {
  const kv = loadKv()
  for (const key of HEAVY_KV_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(kv, key)) continue
    try { atomicWrite(heavyFileName(key), kv[key]) } catch (e) {
      console.error('[localDb] heavy write', key, e)
    }
  }
  saveLightKv()
}

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
  // Готово ТОЛЬКО если реально есть товары на диске
  if (catalogReady()) {
    if (!hasInstallOkFile()) writeInstallOk()
    return true
  }
  // Битый флаг без каталога — сбрасываем, чтобы снова показать скачку
  try {
    if (hasInstallOkFile()) fs.unlinkSync(dbPath(FILE_INSTALL_OK))
  } catch { /* ignore */ }
  const meta = loadMeta()
  if (meta.bootstrapComplete || meta.installComplete) {
    meta.bootstrapComplete = false
    meta.installComplete = false
    metaCache = meta
    try { saveMeta() } catch { /* ignore */ }
  }
  return false
}

function initLocalDb() {
  rootDir = path.join(app.getPath('userData'), 'kakapo-local-db')
  ensureDir(rootDir)
  importInstallSeedIfNeeded(rootDir)
  // сброс кэша после возможного импорта
  kvCache = null
  queueCache = null
  metaCache = null
  heavyLoaded = false
  loadKv()
  // Один раз вынесем тяжёлые ключи из общего файла, если они ещё там
  try { saveKv() } catch { /* ignore */ }
  loadQueue()
  loadMeta()
  if (!hasInstallOkFile() && catalogReady()) writeInstallOk()
  return {
    root: rootDir,
    seed: installSeedDir(),
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
    seed: installSeedDir(),
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
    if (HEAVY_KV_KEYS.has(k)) {
      try { atomicWrite(heavyFileName(k), value) } catch (e) {
        console.error('[localDb] heavy write', k, e)
        return { ok: false }
      }
      return { ok: true }
    }
    // Чек/сессия — только лёгкий файл, без перезаписи каталога
    saveLightKv()
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
