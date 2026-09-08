'use strict'

/**
 * SYNC-канал кассы (main process, НЕ UI):
 *   Сервер ←→ SYNC ←→ SQLite
 * UI только пишет локально и получает события apply/progress.
 */

const { net, ipcMain, BrowserWindow } = require('electron')
const { buildHttpJob, extractServerId, isLocalId } = require('./syncOpHttp.cjs')

const KEY_IDMAP = 'queue_idmap'
const CATALOG_FIRST = new Set([
  'supplier_upsert',
  'product_upsert',
  'client_upsert',
  'category_upsert',
  'cashier_upsert',
  'pos_point_upsert',
])

let dbBridge = null
let running = false
let again = false
let started = false
let session = {
  apiBase: '',
  token: '',
  deviceId: '',
  extraHeaders: {},
}
let delegateWaiters = new Map()
let delegateSeq = 0

function getMainWindow() {
  const wins = BrowserWindow.getAllWindows()
  return wins.find(w => !w.isDestroyed()) || null
}

function emitToUi(channel, payload) {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.send(channel, payload)
  } catch { /* ignore */ }
}

function byOrder(a, b) {
  const sa = Number(a?.seq) || 0
  const sb = Number(b?.seq) || 0
  if (sa !== sb) return sa - sb
  return String(a?.createdAtIso || '').localeCompare(String(b?.createdAtIso || ''))
}

function loadIdMap() {
  try {
    return dbBridge.kvGet(KEY_IDMAP) || {}
  } catch {
    return {}
  }
}

function saveIdMap(map) {
  try {
    dbBridge.kvSet(KEY_IDMAP, map || {})
  } catch { /* ignore */ }
}

function rememberId(localId, serverId) {
  if (!localId || !serverId || localId === serverId) return
  const map = loadIdMap()
  map[localId] = serverId
  saveIdMap(map)
}

function httpRequest(job) {
  const base = String(session.apiBase || '').replace(/\/$/, '')
  const url = `${base}${job.path}`
  const headers = {
    'Content-Type': 'application/json',
    ...(session.extraHeaders || {}),
  }
  if (session.token) headers.Authorization = `Bearer ${session.token}`
  if (session.deviceId) headers['x-kakapo-device-id'] = encodeURIComponent(session.deviceId)

  const timeoutMs = Number(job.timeoutMs) || 15000
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(Object.assign(new Error('Сервер не отвечает'), { network: true }))
    }, timeoutMs)

    try {
      const req = net.request({
        method: job.method || 'GET',
        url,
      })
      for (const [k, v] of Object.entries(headers)) {
        try { req.setHeader(k, String(v)) } catch { /* ignore */ }
      }
      req.on('response', (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(Buffer.from(c)))
        res.on('end', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
          const status = Number(res.statusCode) || 0
          if (status >= 200 && status < 300) {
            resolve({ ok: true, status, json })
            return
          }
          const msg = String(json?.error || json?.message || text || `HTTP ${status}`).slice(0, 400)
          const err = new Error(msg)
          err.status = status
          err.network = status === 0 || status === 502 || status === 503 || status === 504
          reject(err)
        })
        res.on('error', (e) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { network: true }))
        })
      })
      req.on('error', (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { network: true }))
      })
      if (job.body != null && job.method !== 'GET') {
        req.write(JSON.stringify(job.body))
      }
      req.end()
    } catch (e) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { network: true }))
    }
  })
}

function delegateToUi(row) {
  return new Promise((resolve, reject) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) {
      reject(new Error('UI недоступен для delegate'))
      return
    }
    const id = ++delegateSeq
    const timer = setTimeout(() => {
      delegateWaiters.delete(id)
      reject(Object.assign(new Error('Delegate timeout'), { network: true }))
    }, 25000)
    delegateWaiters.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    try {
      win.webContents.send('desktop:syncChannelDelegate', { id, row })
    } catch (e) {
      clearTimeout(timer)
      delegateWaiters.delete(id)
      reject(e)
    }
  })
}

async function sendOne(row) {
  const idMap = loadIdMap()
  let job
  try {
    job = buildHttpJob(row, idMap)
  } catch (e) {
    throw e
  }
  if (!job || job.delegate) {
    const res = await delegateToUi(row)
    return {
      serverId: String(res?.serverId || ''),
      delegated: true,
    }
  }
  if (job === null) {
    return { serverId: '', skipped: true }
  }
  const res = await httpRequest(job)
  const serverId = extractServerId(row.kind, res.json, row)
  return { serverId, json: res.json }
}

async function pullInbound() {
  const base = String(session.apiBase || '').replace(/\/$/, '')
  if (!base) return
  let cursor = ''
  try {
    const meta = dbBridge.metaGet ? dbBridge.metaGet() : {}
    cursor = String(meta?.syncCursor || '') || ''
  } catch { /* ignore */ }
  const qs = cursor ? `?since=${encodeURIComponent(cursor)}` : ''
  try {
    const res = await httpRequest({
      method: 'GET',
      path: `/sync/changes${qs}`,
      timeoutMs: 12000,
    })
    const json = res.json || {}
    if (json.cursor && dbBridge.metaPatch) {
      try { dbBridge.metaPatch({ syncCursor: String(json.cursor) }) } catch { /* ignore */ }
    }
    emitToUi('desktop:syncChannelEvent', {
      type: 'inbound',
      cursor: json.cursor || cursor,
      hint: true,
    })
  } catch { /* inbound best-effort */ }
}

async function runFlush() {
  if (!dbBridge) return
  if (running) {
    again = true
    return
  }
  running = true
  again = false
  let sent = 0
  let failed = 0
  try {
    emitToUi('desktop:syncChannelEvent', { type: 'start' })
    const all = dbBridge.queueAll() || []
    const pending = all.filter(r => r && !r.failed)
    const catalog = pending.filter(r => CATALOG_FIRST.has(r.kind)).sort(byOrder)
    const rest = pending.filter(r => !CATALOG_FIRST.has(r.kind)).sort(byOrder)
    const queue = [...catalog, ...rest]
    const total = queue.length
    let done = 0

    for (const row of queue) {
      emitToUi('desktop:syncChannelEvent', {
        type: 'progress',
        done,
        total,
        clientRef: row.clientRef,
        kind: row.kind,
      })
      try {
        const result = await sendOne(row)
        if (result.skipped) {
          done++
          continue
        }
        if (!result.delegated) {
          if (row.localId && result.serverId) rememberId(row.localId, result.serverId)
          dbBridge.queueDelete(row.clientRef)
        }
        // delegated: UI already deleted/remapped via flushOne
        sent++
        emitToUi('desktop:syncChannelEvent', {
          type: 'op-ok',
          clientRef: row.clientRef,
          kind: row.kind,
          localId: row.localId || '',
          serverId: result.serverId || '',
          delegated: !!result.delegated,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (e && (e.network || /сеть|связ|timeout|не отвечает|ECONN|ETIMEDOUT|502|503|504/i.test(msg))) {
          emitToUi('desktop:syncChannelEvent', { type: 'network', error: msg })
          break
        }
        failed++
        const live = { ...row, failed: true, lastError: msg, attempts: (Number(row.attempts) || 0) + 1 }
        try { dbBridge.queuePut(live) } catch { /* ignore */ }
        emitToUi('desktop:syncChannelEvent', {
          type: 'op-fail',
          clientRef: row.clientRef,
          kind: row.kind,
          localId: row.localId || '',
          error: msg,
          payload: row.payload,
        })
      }
      done++
      // не блокируем main: дать другим IPC/UI событиям пройти
      await new Promise(r => setImmediate(r))
    }

    await pullInbound()
    emitToUi('desktop:syncChannelEvent', {
      type: 'done',
      sent,
      failed,
      remaining: (dbBridge.queueAll() || []).filter(r => r && !r.failed).length,
    })
  } catch (e) {
    emitToUi('desktop:syncChannelEvent', {
      type: 'error',
      error: e instanceof Error ? e.message : String(e),
    })
  } finally {
    running = false
    if (again) {
      again = false
      setTimeout(() => { void runFlush() }, 50)
    }
  }
}

function kick(opts = {}) {
  if (opts.apiBase) session.apiBase = String(opts.apiBase)
  if (opts.token != null) session.token = String(opts.token || '')
  if (opts.deviceId != null) session.deviceId = String(opts.deviceId || '')
  if (opts.extraHeaders && typeof opts.extraHeaders === 'object') {
    session.extraHeaders = opts.extraHeaders
  }
  void runFlush()
  return { ok: true, running: true }
}

function installSyncChannelHost(getBridge) {
  if (started) return
  started = true
  dbBridge = typeof getBridge === 'function' ? getBridge() : getBridge

  ipcMain.handle('desktop:syncChannelKick', (_e, opts) => kick(opts || {}))
  ipcMain.handle('desktop:syncChannelStatus', () => ({
    ok: true,
    running,
    hasBridge: !!dbBridge,
    apiBase: !!session.apiBase,
  }))
  ipcMain.handle('desktop:syncChannelDelegateResult', (_e, payload) => {
    const id = Number(payload?.id)
    const waiter = delegateWaiters.get(id)
    if (!waiter) return { ok: false }
    delegateWaiters.delete(id)
    if (payload?.ok === false) {
      const err = new Error(String(payload?.error || 'delegate failed'))
      if (payload?.network) err.network = true
      waiter.reject(err)
    } else {
      waiter.resolve(payload || {})
    }
    return { ok: true }
  })
}

module.exports = {
  installSyncChannelHost,
  kickSyncChannel: kick,
}
