'use strict'

/**
 * Локальная база кассы на диске ПК (userData).
 * Атомарная запись: temp → rename — переживает обрыв света.
 * Хранит: KV (товары/клиенты/смены…), очередь синка, состояние чеков.
 */

const fs = require('fs')
const path = require('path')
const { app, ipcMain } = require('electron')

const FILE_KV = 'local-kv.json'
const FILE_QUEUE = 'local-queue.json'
const FILE_META = 'local-meta.json'

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
    // повреждённый файл после сбоя — пробуем .bak
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
  const json = JSON.stringify(data)
  fs.writeFileSync(tmp, json, 'utf8')
  try {
    if (fs.existsSync(p)) {
      try { fs.copyFileSync(p, bak) } catch { /* ignore */ }
    }
    fs.renameSync(tmp, p)
  } catch (e) {
    // Windows: rename может не заменить существующий — пишем напрямую
    try {
      fs.writeFileSync(p, json, 'utf8')
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    } catch (e2) {
      throw e2
    }
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

function saveKv() {
  atomicWrite(FILE_KV, loadKv())
}

function saveQueue() {
  atomicWrite(FILE_QUEUE, loadQueue())
}

function saveMeta() {
  atomicWrite(FILE_META, loadMeta())
}

function initLocalDb() {
  rootDir = path.join(app.getPath('userData'), 'kakapo-local-db')
  ensureDir(rootDir)
  loadKv()
  loadQueue()
  loadMeta()
  return {
    root: rootDir,
    bootstrapComplete: !!loadMeta().bootstrapComplete,
    kvKeys: Object.keys(loadKv()).length,
    queueLen: loadQueue().length,
  }
}

function installLocalDbIpc() {
  initLocalDb()

  ipcMain.handle('desktop:localDbInfo', () => ({
    ok: true,
    root: rootDir,
    bootstrapComplete: !!loadMeta().bootstrapComplete,
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

  ipcMain.handle('desktop:localDbMetaGet', () => ({ ...loadMeta() }))

  ipcMain.handle('desktop:localDbMetaPatch', (_e, patch) => {
    const meta = loadMeta()
    Object.assign(meta, patch && typeof patch === 'object' ? patch : {})
    metaCache = meta
    saveMeta()
    return { ok: true, meta: { ...meta } }
  })
}

module.exports = {
  initLocalDb,
  installLocalDbIpc,
}
