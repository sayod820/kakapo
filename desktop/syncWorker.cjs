'use strict'

/**
 * Electron UtilityProcess: HTTP для sync вне renderer (batch / one-shot).
 * Messages from parent: { id, type: 'http-batch'|'http-one', url, method?, headers?, body? }
 * Replies: { id, ok, status, json?, text?, error? }
 *
 * Electron UtilityProcess: process.parentPort (MessagePort-like).
 */

const port = process.parentPort
if (!port) {
  throw new Error('syncWorker must run as Electron utilityProcess')
}

async function doFetch(msg) {
  const id = msg?.id
  const url = String(msg?.url || '')
  const method = String(msg?.method || 'POST').toUpperCase()
  const headers = msg?.headers && typeof msg.headers === 'object' ? { ...msg.headers } : {}
  let body = msg?.body
  if (body != null && typeof body !== 'string') {
    body = JSON.stringify(body)
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json'
    }
  }
  if (!url) {
    return { id, ok: false, status: 0, error: 'missing url' }
  }
  try {
    const res = await fetch(url, { method, headers, body: body != null ? body : undefined })
    const status = res.status
    const text = await res.text()
    let json
    try {
      json = text && text.trim() ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return {
      id,
      ok: status >= 200 && status < 300,
      status,
      json,
      text,
    }
  } catch (e) {
    return {
      id,
      ok: false,
      status: 0,
      error: e?.message || String(e),
    }
  }
}

port.on('message', (event) => {
  const msg = event && Object.prototype.hasOwnProperty.call(event, 'data') ? event.data : event
  const type = String(msg?.type || '')
  if (type === 'ping') {
    try {
      port.postMessage({ id: msg?.id, ok: true })
    } catch { /* ignore */ }
    return
  }
  if (type !== 'http-batch' && type !== 'http-one') {
    try {
      port.postMessage({
        id: msg?.id,
        ok: false,
        status: 0,
        error: `unknown type: ${type}`,
      })
    } catch { /* ignore */ }
    return
  }
  void doFetch(msg).then(result => {
    try { port.postMessage(result) } catch { /* ignore */ }
  })
})
