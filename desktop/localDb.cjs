'use strict'

/**
 * Локальная база кассы на SQLite (WAL).
 * IPC API тот же: kv / queue / meta.
 * Старые JSON (local-kv.json, kv-*.json, …) один раз мигрируют в kakapo.sqlite.
 */

const fs = require('fs')
const path = require('path')
const { app, ipcMain } = require('electron')

const DB_FILE = 'kakapo.sqlite'
const FILE_KV = 'local-kv.json'
const FILE_QUEUE = 'local-queue.json'
const FILE_META = 'local-meta.json'
const FILE_INSTALL_OK = 'INSTALL_OK'
const MIGRATED_MARK = 'json-migrated-to-sqlite'

const HEAVY_KV_KEYS = [
  'catalog_products',
  'catalog_clients',
  'catalog_employees_auth',
]

let rootDir = ''
let db = null

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

function heavyFileName(key) {
  return `kv-${String(key).replace(/[^\w.-]+/g, '_')}.json`
}

function readJsonFile(file, fallback) {
  try {
    const p = typeof file === 'string' && path.isAbsolute(file) ? file : dbPath(file)
    if (!fs.existsSync(p)) return fallback
    const raw = fs.readFileSync(p, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    try {
      const bak = (typeof file === 'string' && path.isAbsolute(file) ? file : dbPath(file)) + '.bak'
      if (fs.existsSync(bak)) return JSON.parse(fs.readFileSync(bak, 'utf8'))
    } catch { /* ignore */ }
    return fallback
  }
}

/** Seed из папки установки → рабочая userData (sqlite и/или json) */
function importInstallSeedIfNeeded(workDir) {
  const seed = installSeedDir()
  if (!seed || seed === workDir) return false
  const seedOk = path.join(seed, FILE_INSTALL_OK)
  const seedSqlite = path.join(seed, DB_FILE)
  const seedKv = path.join(seed, FILE_KV)
  if (!fs.existsSync(seedOk) && !fs.existsSync(seedSqlite) && !fs.existsSync(seedKv)) return false

  const workOk = path.join(workDir, FILE_INSTALL_OK)
  const workSqlite = path.join(workDir, DB_FILE)
  const workKv = path.join(workDir, FILE_KV)
  if (fs.existsSync(workOk) && (fs.existsSync(workSqlite) || fs.existsSync(workKv))) return false

  ensureDir(workDir)
  copyFileSafe(seedSqlite, workSqlite)
  copyFileSafe(seedSqlite + '-wal', workSqlite + '-wal')
  copyFileSafe(seedSqlite + '-shm', workSqlite + '-shm')
  copyFileSafe(seedKv, workKv)
  copyFileSafe(path.join(seed, FILE_META), path.join(workDir, FILE_META))
  copyFileSafe(path.join(seed, FILE_QUEUE), path.join(workDir, FILE_QUEUE))
  for (const key of HEAVY_KV_KEYS) {
    copyFileSafe(path.join(seed, heavyFileName(key)), path.join(workDir, heavyFileName(key)))
  }
  copyFileSafe(seedOk, workOk)
  if (!fs.existsSync(workOk) && (fs.existsSync(workSqlite) || fs.existsSync(workKv))) {
    fs.writeFileSync(workOk, new Date().toISOString(), 'utf8')
  }
  console.log('[localDb] импорт seed из установки →', workDir)
  return true
}

function openSqlite() {
  const Database = require('better-sqlite3')
  const file = dbPath(DB_FILE)
  ensureDir(rootDir)
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS queue (
      client_ref TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mirror (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS idx_mirror_kind_updated ON mirror(kind, updated_at);
    CREATE TABLE IF NOT EXISTS entities (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS idx_entities_kind_updated ON entities(kind, updated_at);
    CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at);
  `)
}

function sqlKvGet(key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(String(key))
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return null }
}

function sqlKvSet(key, value) {
  db.prepare(`
    INSERT INTO kv(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(key), JSON.stringify(value))
}

function sqlKvDelete(key) {
  db.prepare('DELETE FROM kv WHERE key = ?').run(String(key))
}

function sqlKvKeysCount() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM kv').get()
  return Number(row && row.n) || 0
}

function sqlQueueAll() {
  const rows = db.prepare('SELECT payload FROM queue ORDER BY updated_at ASC, client_ref ASC').all()
  const out = []
  for (const r of rows) {
    try { out.push(JSON.parse(r.payload)) } catch { /* skip */ }
  }
  return out
}

function sqlQueuePut(row) {
  const ref = String(row.clientRef || '')
  if (!ref) return false
  const stamp = new Date().toISOString()
  db.prepare(`
    INSERT INTO queue(client_ref, payload, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(client_ref) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(ref, JSON.stringify(row), stamp)
  return true
}

function sqlQueueDelete(clientRef) {
  db.prepare('DELETE FROM queue WHERE client_ref = ?').run(String(clientRef || ''))
}

function sqlQueueLen() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM queue').get()
  return Number(row && row.n) || 0
}

function sqlMirrorPut(kind, id, data) {
  const k = String(kind || '').trim()
  const i = String(id || '').trim()
  if (!k || !i) return false
  const stamp = new Date().toISOString()
  db.prepare(`
    INSERT INTO mirror(kind, id, payload, updated_at) VALUES(?, ?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(k, i, JSON.stringify(data == null ? null : data), stamp)
  return true
}

function sqlMirrorGet(kind, id) {
  const row = db.prepare('SELECT payload FROM mirror WHERE kind = ? AND id = ?')
    .get(String(kind || ''), String(id || ''))
  if (!row) return null
  try { return JSON.parse(row.payload) } catch { return null }
}

function sqlMirrorList(kind, limit = 200) {
  const lim = Math.max(1, Math.min(2000, Number(limit) || 200))
  const rows = kind
    ? db.prepare('SELECT kind, id, payload, updated_at FROM mirror WHERE kind = ? ORDER BY updated_at DESC LIMIT ?')
      .all(String(kind), lim)
    : db.prepare('SELECT kind, id, payload, updated_at FROM mirror ORDER BY updated_at DESC LIMIT ?')
      .all(lim)
  return rows.map(r => {
    let data = null
    try { data = JSON.parse(r.payload) } catch { data = null }
    return { kind: r.kind, id: r.id, data, updatedAtIso: r.updated_at }
  })
}

function sqlMirrorCount() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM mirror').get()
  return Number(row && row.n) || 0
}

function sqlMetaGetAll() {
  const rows = db.prepare('SELECT key, value FROM meta').all()
  const meta = {}
  for (const r of rows) {
    try { meta[r.key] = JSON.parse(r.value) } catch { meta[r.key] = r.value }
  }
  return meta
}

function sqlMetaSet(key, value) {
  db.prepare(`
    INSERT INTO meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(key), JSON.stringify(value))
}

function sqlMetaPatch(patch) {
  if (!patch || typeof patch !== 'object') return sqlMetaGetAll()
  const tx = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) sqlMetaSet(k, v)
  })
  tx(patch)
  return sqlMetaGetAll()
}

function sqlEntityPut(kind, id, data, updatedAt, deleted) {
  const k = String(kind || '').trim()
  const i = String(id || '').trim()
  if (!k || !i) return false
  const stamp = String(updatedAt || new Date().toISOString())
  const del = deleted ? 1 : 0
  db.prepare(`
    INSERT INTO entities(kind, id, payload, updated_at, deleted) VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted
  `).run(k, i, JSON.stringify(data == null ? null : data), stamp, del)
  return true
}

function sqlEntityPutMany(rows) {
  if (!Array.isArray(rows) || !rows.length) return { ok: true, count: 0 }
  const stmt = db.prepare(`
    INSERT INTO entities(kind, id, payload, updated_at, deleted) VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted
  `)
  const tx = db.transaction((list) => {
    let n = 0
    for (const row of list) {
      const k = String((row && row.kind) || '').trim()
      const i = String((row && row.id) || '').trim()
      if (!k || !i) continue
      const stamp = String((row && (row.updatedAtIso || row.updatedAt)) || new Date().toISOString())
      const del = row && row.deleted ? 1 : 0
      stmt.run(k, i, JSON.stringify(row.data == null ? null : row.data), stamp, del)
      n += 1
    }
    return n
  })
  return { ok: true, count: tx(rows) }
}

function sqlEntityGet(kind, id) {
  const row = db.prepare('SELECT payload, updated_at, deleted FROM entities WHERE kind = ? AND id = ?')
    .get(String(kind || ''), String(id || ''))
  if (!row || row.deleted) return null
  try { return { data: JSON.parse(row.payload), updatedAtIso: row.updated_at } } catch { return null }
}

function sqlEntityList(kind, opts = {}) {
  const lim = Math.max(1, Math.min(50000, Number(opts.limit) || 20000))
  const since = opts.since ? String(opts.since) : ''
  const includeDeleted = !!opts.includeDeleted
  let rows
  if (kind && since) {
    rows = db.prepare(`
      SELECT kind, id, payload, updated_at, deleted FROM entities
      WHERE kind = ? AND updated_at > ?
      ORDER BY updated_at ASC LIMIT ?
    `).all(String(kind), since, lim)
  } else if (kind) {
    rows = db.prepare(`
      SELECT kind, id, payload, updated_at, deleted FROM entities
      WHERE kind = ? ${includeDeleted ? '' : 'AND deleted = 0'}
      ORDER BY updated_at ASC LIMIT ?
    `).all(String(kind), lim)
  } else if (since) {
    rows = db.prepare(`
      SELECT kind, id, payload, updated_at, deleted FROM entities
      WHERE updated_at > ?
      ORDER BY updated_at ASC LIMIT ?
    `).all(since, lim)
  } else {
    rows = db.prepare(`
      SELECT kind, id, payload, updated_at, deleted FROM entities
      WHERE ${includeDeleted ? '1=1' : 'deleted = 0'}
      ORDER BY updated_at ASC LIMIT ?
    `).all(lim)
  }
  return rows.map(r => {
    let data = null
    try { data = JSON.parse(r.payload) } catch { data = null }
    return {
      kind: r.kind,
      id: r.id,
      data,
      updatedAtIso: r.updated_at,
      deleted: !!r.deleted,
    }
  })
}

function sqlEntityDelete(kind, id) {
  return sqlEntityPut(kind, id, null, new Date().toISOString(), true)
}

function sqlEntityCount(kind) {
  if (kind) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM entities WHERE kind = ? AND deleted = 0').get(String(kind))
    return Number(row && row.n) || 0
  }
  const row = db.prepare('SELECT COUNT(*) AS n FROM entities WHERE deleted = 0').get()
  return Number(row && row.n) || 0
}

/** Одноразовая выгрузка тяжёлых KV → entities (продукты / клиенты / партии) */
function migrateKvCatalogsToEntitiesIfNeeded() {
  const meta = sqlMetaGetAll()
  if (meta.entitiesMigratedV1) return false
  const stamp = new Date().toISOString()
  const tx = db.transaction(() => {
    const products = sqlKvGet('catalog_products')
    if (Array.isArray(products)) {
      for (const p of products) {
        const id = String(p && p.id != null ? p.id : '')
        if (!id) continue
        sqlEntityPut('product', id, p, p.updatedAtIso || p.updatedAt || stamp, false)
      }
    }
    const clients = sqlKvGet('catalog_clients')
    if (Array.isArray(clients)) {
      for (const c of clients) {
        const id = String(c && c.id != null ? c.id : '')
        if (!id) continue
        sqlEntityPut('client', id, c, c.updatedAtIso || c.updatedAt || stamp, false)
      }
    }
    const layers = sqlKvGet('catalog_stock_layers')
    if (Array.isArray(layers)) {
      for (const layer of layers) {
        const rid = String(layer && layer.receiptId != null ? layer.receiptId : '')
        const pid = String(layer && layer.productId != null ? layer.productId : '')
        if (!rid || !pid) continue
        sqlEntityPut('stock_layer', `${rid}:${pid}`, layer, layer.createdAtIso || stamp, false)
      }
    }
    sqlMetaSet('entitiesMigratedV1', true)
    if (!meta.syncCursor) sqlMetaSet('syncCursor', '')
  })
  tx()
  return true
}

function renameAside(file) {
  try {
    const p = dbPath(file)
    if (!fs.existsSync(p)) return
    const dest = p + '.bak-pre-sqlite'
    if (!fs.existsSync(dest)) fs.renameSync(p, dest)
  } catch (e) {
    console.warn('[localDb] renameAside', file, e && e.message)
  }
}

/** Один раз: JSON → SQLite */
function migrateJsonToSqliteIfNeeded() {
  const mark = dbPath(MIGRATED_MARK)
  if (fs.existsSync(mark) && sqlKvKeysCount() > 0) return false

  const hasJson =
    fs.existsSync(dbPath(FILE_KV)) ||
    fs.existsSync(dbPath(FILE_QUEUE)) ||
    fs.existsSync(dbPath(FILE_META)) ||
    HEAVY_KV_KEYS.some(k => fs.existsSync(dbPath(heavyFileName(k))))

  if (!hasJson) {
    try { fs.writeFileSync(mark, new Date().toISOString(), 'utf8') } catch { /* ignore */ }
    return false
  }

  // Уже есть данные в sqlite — не затираем, только помечаем
  if (sqlKvKeysCount() > 0 || sqlQueueLen() > 0) {
    try { fs.writeFileSync(mark, new Date().toISOString(), 'utf8') } catch { /* ignore */ }
    return false
  }

  console.log('[localDb] миграция JSON → SQLite…')
  const tx = db.transaction(() => {
    const kv = readJsonFile(FILE_KV, {})
    if (kv && typeof kv === 'object') {
      for (const [key, value] of Object.entries(kv)) {
        sqlKvSet(key, value)
      }
    }
    for (const key of HEAVY_KV_KEYS) {
      const fromFile = readJsonFile(heavyFileName(key), null)
      if (fromFile != null) sqlKvSet(key, fromFile)
    }
    const queue = readJsonFile(FILE_QUEUE, [])
    if (Array.isArray(queue)) {
      for (const row of queue) {
        if (row && row.clientRef) sqlQueuePut(row)
      }
    }
    const meta = readJsonFile(FILE_META, {})
    if (meta && typeof meta === 'object') {
      for (const [key, value] of Object.entries(meta)) sqlMetaSet(key, value)
    }
  })
  tx()

  renameAside(FILE_KV)
  renameAside(FILE_QUEUE)
  renameAside(FILE_META)
  for (const key of HEAVY_KV_KEYS) renameAside(heavyFileName(key))
  try { fs.writeFileSync(mark, new Date().toISOString(), 'utf8') } catch { /* ignore */ }
  console.log('[localDb] миграция JSON → SQLite готова, keys=', sqlKvKeysCount())
  return true
}

function hasInstallOkFile() {
  try { return fs.existsSync(dbPath(FILE_INSTALL_OK)) } catch { return false }
}

function writeInstallOk() {
  ensureDir(rootDir)
  const stamp = new Date().toISOString()
  fs.writeFileSync(dbPath(FILE_INSTALL_OK), stamp, 'utf8')
  sqlMetaPatch({
    bootstrapComplete: true,
    installComplete: true,
    lastBootstrapAt: stamp,
  })
}

function catalogReady() {
  const products = sqlKvGet('catalog_products')
  return Array.isArray(products) && products.length > 0
}

function isSetupComplete() {
  if (catalogReady()) {
    if (!hasInstallOkFile()) writeInstallOk()
    return true
  }
  try {
    if (hasInstallOkFile()) fs.unlinkSync(dbPath(FILE_INSTALL_OK))
  } catch { /* ignore */ }
  const meta = sqlMetaGetAll()
  if (meta.bootstrapComplete || meta.installComplete) {
    try {
      sqlMetaPatch({ bootstrapComplete: false, installComplete: false })
    } catch { /* ignore */ }
  }
  return false
}

function initLocalDb() {
  rootDir = path.join(app.getPath('userData'), 'kakapo-local-db')
  ensureDir(rootDir)
  importInstallSeedIfNeeded(rootDir)
  if (db) {
    try { db.close() } catch { /* ignore */ }
    db = null
  }
  openSqlite()
  migrateJsonToSqliteIfNeeded()
  try { migrateKvCatalogsToEntitiesIfNeeded() } catch (e) {
    console.warn('[localDb] entities migrate', e && e.message)
  }
  if (!hasInstallOkFile() && catalogReady()) writeInstallOk()
  return {
    root: rootDir,
    seed: installSeedDir(),
    engine: 'sqlite',
    bootstrapComplete: isSetupComplete(),
    kvKeys: sqlKvKeysCount(),
    queueLen: sqlQueueLen(),
    entityCount: sqlEntityCount(),
  }
}

function installLocalDbIpc() {
  initLocalDb()

  ipcMain.handle('desktop:localDbInfo', () => ({
    ok: true,
    root: rootDir,
    seed: installSeedDir(),
    engine: 'sqlite',
    bootstrapComplete: isSetupComplete(),
    installComplete: isSetupComplete(),
    hasCatalog: catalogReady(),
    kvKeys: sqlKvKeysCount(),
    queueLen: sqlQueueLen(),
    mirrorCount: sqlMirrorCount(),
    entityCount: sqlEntityCount(),
    syncCursor: sqlMetaGetAll().syncCursor || '',
    lastBootstrapAt: sqlMetaGetAll().lastBootstrapAt || null,
    lastSyncAt: sqlMetaGetAll().lastSyncAt || null,
  }))

  ipcMain.handle('desktop:localDbKvGet', (_e, key) => {
    const k = String(key || '')
    if (!k) return null
    return sqlKvGet(k)
  })

  ipcMain.handle('desktop:localDbKvSet', (_e, key, value) => {
    const k = String(key || '')
    if (!k) return { ok: false }
    try {
      sqlKvSet(k, value)
      return { ok: true }
    } catch (e) {
      console.error('[localDb] kvSet', k, e)
      return { ok: false }
    }
  })

  ipcMain.handle('desktop:localDbKvDelete', (_e, key) => {
    const k = String(key || '')
    if (!k) return { ok: false }
    try {
      sqlKvDelete(k)
      return { ok: true }
    } catch (e) {
      console.error('[localDb] kvDelete', k, e)
      return { ok: false }
    }
  })

  ipcMain.handle('desktop:localDbQueueAll', () => sqlQueueAll())

  ipcMain.handle('desktop:localDbQueuePut', (_e, row) => {
    try {
      return { ok: sqlQueuePut(row) }
    } catch (e) {
      console.error('[localDb] queuePut', e)
      return { ok: false }
    }
  })

  ipcMain.handle('desktop:localDbQueueDelete', (_e, clientRef) => {
    try {
      sqlQueueDelete(clientRef)
      return { ok: true }
    } catch (e) {
      console.error('[localDb] queueDelete', e)
      return { ok: false }
    }
  })

  ipcMain.handle('desktop:localDbMetaGet', () => ({
    ...sqlMetaGetAll(),
    bootstrapComplete: isSetupComplete(),
    installComplete: isSetupComplete(),
  }))

  ipcMain.handle('desktop:localDbMetaPatch', (_e, patch) => {
    const meta = sqlMetaPatch(patch && typeof patch === 'object' ? patch : {})
    if (meta.bootstrapComplete || meta.installComplete) {
      try { writeInstallOk() } catch { /* ignore */ }
    }
    return { ok: true, meta: { ...meta, bootstrapComplete: isSetupComplete() } }
  })

  ipcMain.handle('desktop:localDbMarkInstalled', () => {
    writeInstallOk()
    return { ok: true, bootstrapComplete: true }
  })

  ipcMain.handle('desktop:localDbMirrorPut', (_e, row) => {
    try {
      const kind = row && row.kind
      const id = row && row.id
      const data = row && row.data
      const ok = sqlMirrorPut(kind, id, data)
      return { ok: !!ok }
    } catch (e) {
      console.error('[localDb] mirrorPut', e)
      return { ok: false }
    }
  })

  ipcMain.handle('desktop:localDbMirrorGet', (_e, kind, id) => {
    try {
      return sqlMirrorGet(kind, id)
    } catch (e) {
      console.error('[localDb] mirrorGet', e)
      return null
    }
  })

  ipcMain.handle('desktop:localDbMirrorList', (_e, kind, limit) => {
    try {
      return sqlMirrorList(kind, limit)
    } catch (e) {
      console.error('[localDb] mirrorList', e)
      return []
    }
  })

  ipcMain.handle('desktop:localDbEntityPutMany', (_e, rows) => {
    try {
      return sqlEntityPutMany(rows)
    } catch (e) {
      console.error('[localDb] entityPutMany', e)
      return { ok: false, count: 0 }
    }
  })

  ipcMain.handle('desktop:localDbEntityPut', (_e, row) => {
    try {
      const ok = sqlEntityPut(
        row && row.kind,
        row && row.id,
        row && row.data,
        row && (row.updatedAtIso || row.updatedAt),
        !!(row && row.deleted),
      )
      return { ok: !!ok }
    } catch (e) {
      console.error('[localDb] entityPut', e)
      return { ok: false }
    }
  })

  ipcMain.handle('desktop:localDbEntityGet', (_e, kind, id) => {
    try {
      return sqlEntityGet(kind, id)
    } catch (e) {
      console.error('[localDb] entityGet', e)
      return null
    }
  })

  ipcMain.handle('desktop:localDbEntityList', (_e, kind, opts) => {
    try {
      return sqlEntityList(kind, opts && typeof opts === 'object' ? opts : {})
    } catch (e) {
      console.error('[localDb] entityList', e)
      return []
    }
  })

  ipcMain.handle('desktop:localDbEntityDelete', (_e, kind, id) => {
    try {
      return { ok: !!sqlEntityDelete(kind, id) }
    } catch (e) {
      console.error('[localDb] entityDelete', e)
      return { ok: false }
    }
  })
}

module.exports = {
  initLocalDb,
  installLocalDbIpc,
  isSetupComplete,
}
