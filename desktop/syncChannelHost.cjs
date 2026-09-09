'use strict'

/**
 * SYNC-канал кассы (main process, НЕ UI):
 *   Сервер ←→ SYNC ←→ SQLite
 * UI только пишет локально, читает SQLite и получает события apply.
 */

const { net, ipcMain, BrowserWindow } = require('electron')
const { buildHttpJob, extractServerId, isLocalId } = require('./syncOpHttp.cjs')

const KEY_IDMAP = 'queue_idmap'
const KEY_INBOUND_SYNC = 'kakapo_inbound_sync'
const KEY_INBOUND_LITE = 'kakapo_inbound_pos_lite'
const KEY_POS_LITE_CURSOR = 'kakapo_pos_lite_cursor'

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
let againMode = 'both'
let started = false
let inboundTimer = null
let wsHandle = null
let wsReconnectTimer = null
let session = {
  apiBase: '',
  token: '',
  deviceId: '',
  wsBase: '',
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

function stashEntitiesFromDelta(json) {
  if (!dbBridge || !json || typeof json !== 'object') return
  const putMany = dbBridge.entityPutMany
  if (typeof putMany !== 'function') return
  const stamp = String(json.cursor || new Date().toISOString())
  try {
    if (Array.isArray(json.products) && json.products.length) {
      putMany(json.products.map((p) => ({
        kind: 'product',
        id: String(p.id),
        data: p,
        updatedAtIso: String(p.updatedAtIso || p.updatedAt || stamp),
      })))
    }
    if (Array.isArray(json.clients) && json.clients.length) {
      putMany(json.clients.map((c) => ({
        kind: 'client',
        id: String(c.id),
        data: c,
        updatedAtIso: String(c.updatedAtIso || stamp),
      })))
    }
    if (Array.isArray(json.cards) && json.cards.length) {
      putMany(json.cards.map((c) => ({
        kind: 'card',
        id: String(c.id || c.num),
        data: c,
        updatedAtIso: String(c.updatedAtIso || stamp),
      })))
    }
    const pos = json.pos || {}
    if (Array.isArray(pos.sales) && pos.sales.length) {
      putMany(pos.sales.map((s) => ({
        kind: 'sale',
        id: String(s.id),
        data: s,
        updatedAtIso: String(s.createdAtIso || s.updatedAtIso || stamp),
      })))
    }
    if (Array.isArray(pos.shifts) && pos.shifts.length) {
      putMany(pos.shifts.map((s) => ({
        kind: 'shift',
        id: String(s.id),
        data: s,
        updatedAtIso: String(s.updatedAtIso || s.openedAtIso || stamp),
      })))
    }
  } catch { /* ignore */ }
}

async function pullInbound() {
  const base = String(session.apiBase || '').replace(/\/$/, '')
  if (!base || !dbBridge) return { lite: false, sync: false }

  let liteOk = false
  let syncOk = false

  // 1) pos-lite → SQLite
  try {
    let liteCursor = ''
    try { liteCursor = String(dbBridge.kvGet(KEY_POS_LITE_CURSOR) || '') } catch { /* ignore */ }
    const q = new URLSearchParams()
    q.set('scope', 'pos-lite')
    if (liteCursor) q.set('since', liteCursor)
    const res = await httpRequest({
      method: 'GET',
      path: `/sync/changes?${q.toString()}`,
      timeoutMs: 12000,
    })
    const json = res.json || {}
    dbBridge.kvSet(KEY_INBOUND_LITE, { ts: Date.now(), json })
    if (json.cursor) {
      try { dbBridge.kvSet(KEY_POS_LITE_CURSOR, String(json.cursor)) } catch { /* ignore */ }
    }
    stashEntitiesFromDelta(json)
    liteOk = true
  } catch { /* best-effort */ }

  // 2) полный sync/changes → SQLite (если очередь пуста)
  try {
    const pending = (dbBridge.queueAll() || []).filter(r => r && !r.failed)
    if (pending.length === 0) {
      let cursor = ''
      try {
        const meta = dbBridge.metaGet ? dbBridge.metaGet() : {}
        cursor = String(meta?.syncCursor || '') || ''
      } catch { /* ignore */ }
      const qs = cursor ? `?since=${encodeURIComponent(cursor)}` : ''
      const res = await httpRequest({
        method: 'GET',
        path: `/sync/changes${qs}`,
        timeoutMs: 15000,
      })
      const json = res.json || {}
      dbBridge.kvSet(KEY_INBOUND_SYNC, { ts: Date.now(), json })
      if (json.cursor && dbBridge.metaPatch) {
        try { dbBridge.metaPatch({ syncCursor: String(json.cursor) }) } catch { /* ignore */ }
      }
      stashEntitiesFromDelta(json)
      syncOk = true
    }
  } catch { /* best-effort */ }

  if (liteOk || syncOk) {
    emitToUi('desktop:syncChannelEvent', {
      type: 'inbound-ready',
      lite: liteOk,
      sync: syncOk,
    })
  }
  return { lite: liteOk, sync: syncOk }
}

async function runFlush(mode = 'both') {
  if (!dbBridge) return
  if (running) {
    again = true
    againMode = mode
    return
  }
  running = true
  again = false
  let sent = 0
  let failed = 0
  const doFlush = mode === 'flush' || mode === 'both'
  const doInbound = mode === 'inbound' || mode === 'both'
  try {
    emitToUi('desktop:syncChannelEvent', { type: 'start', mode })

    if (doFlush) {
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
        await new Promise(r => setImmediate(r))
      }
    }

    if (doInbound) {
      await pullInbound()
    }

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
      const m = againMode || 'both'
      againMode = 'both'
      setTimeout(() => { void runFlush(m) }, 50)
    }
  }
}

function ensureInboundTimer() {
  if (inboundTimer) return
  inboundTimer = setInterval(() => {
    if (!session.apiBase || !dbBridge) return
    void runFlush('inbound')
  }, 35000)
}

function wsUrl() {
  const base = String(session.wsBase || '').replace(/\/$/, '')
  if (base) return `${base}/ws/pos?token=${encodeURIComponent(session.token || '')}`
  // apiBase https://x/api/kakapo → wss://x
  try {
    const u = new URL(String(session.apiBase || ''))
    const proto = u.protocol === 'http:' ? 'ws:' : 'wss:'
    return `${proto}//${u.host}/ws/pos?token=${encodeURIComponent(session.token || '')}`
  } catch {
    return ''
  }
}

function connectWs() {
  const url = wsUrl()
  if (!url || typeof WebSocket === 'undefined') return
  try {
    if (wsHandle) {
      try { wsHandle.close() } catch { /* ignore */ }
      wsHandle = null
    }
    const ws = new WebSocket(url)
    wsHandle = ws
    ws.onopen = () => { /* ok */ }
    ws.onmessage = (ev) => {
      try {
        const raw = typeof ev.data === 'string' ? ev.data : ''
        if (!raw || raw === 'pong') return
        const msg = JSON.parse(raw)
        const evName = String(msg?.event || '')
        if (evName === 'pos_update') {
          const kind = String(msg?.payload?.kind || msg?.payload?.reason || '')
          if (kind === 'device-unbind') {
            emitToUi('desktop:syncChannelEvent', {
              type: 'device-unbind',
              deviceId: String(msg?.payload?.deviceId || ''),
            })
            return
          }
        }
        if (/pos_update|product_update|loyalty_update|category_update/i.test(evName)) {
          void runFlush('inbound')
        }
      } catch { /* ignore */ }
    }
    ws.onclose = () => {
      wsHandle = null
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer)
      wsReconnectTimer = setTimeout(() => connectWs(), 4000)
    }
    ws.onerror = () => {
      try { ws.close() } catch { /* ignore */ }
    }
    const ping = setInterval(() => {
      try {
        if (ws.readyState === 1) ws.send('ping')
      } catch { /* ignore */ }
    }, 25000)
    ws.addEventListener?.('close', () => clearInterval(ping))
  } catch { /* no WS in this runtime */ }
}

function kick(opts = {}) {
  if (opts.apiBase) session.apiBase = String(opts.apiBase)
  if (opts.token != null) session.token = String(opts.token || '')
  if (opts.deviceId != null) session.deviceId = String(opts.deviceId || '')
  if (opts.wsBase) session.wsBase = String(opts.wsBase || '')
  if (opts.extraHeaders && typeof opts.extraHeaders === 'object') {
    session.extraHeaders = opts.extraHeaders
  }
  ensureInboundTimer()
  if (session.token && session.apiBase) connectWs()
  const mode = opts.mode === 'flush' || opts.mode === 'inbound' || opts.mode === 'both'
    ? opts.mode
    : 'both'
  void runFlush(mode)
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
