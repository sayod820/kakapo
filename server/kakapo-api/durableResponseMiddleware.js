/**
 * ONLINE-O5 — defer snapshot flush until successful HTTP response (Postgres lab/production).
 * Routes that call persist() / scheduleSaveDb mark the request; res.json/res.send await flushDbAsync first.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { flushDbAsync, isPostgresEnabled } from './db.js'

export const durableRequestStore = new AsyncLocalStorage()

export function markDurablePending() {
  const ctx = durableRequestStore.getStore()
  if (ctx) ctx.pending = true
}

function shouldFlushBeforeResponse(ctx, res) {
  if (!ctx || ctx.skip || !ctx.pending) return false
  if (!isPostgresEnabled()) return false
  if (res.headersSent) return false
  const code = res.statusCode || 200
  return code >= 200 && code < 300
}

async function flushThen(fn, res, args) {
  const ctx = durableRequestStore.getStore()
  if (shouldFlushBeforeResponse(ctx, res)) {
    try {
      await flushDbAsync()
      if (ctx) ctx.pending = false
    } catch (e) {
      if (!res.headersSent) {
        res.status(500).json({
          detail: e?.message || 'Не удалось сохранить данные',
          code: 'DURABLE_FLUSH_FAILED',
        })
        return res
      }
      throw e
    }
  }
  return fn(...args)
}

export function durableResponseMiddleware() {
  return (req, res, next) => {
    const ctx = { pending: false, skip: false }
    req.skipDurableFlush = () => {
      ctx.skip = true
    }

    const origJson = res.json.bind(res)
    const origSend = res.send.bind(res)

    res.json = function jsonDurable(...args) {
      return flushThen(origJson, res, args)
    }
    res.send = function sendDurable(...args) {
      return flushThen(origSend, res, args)
    }

    durableRequestStore.run(ctx, () => next())
  }
}
