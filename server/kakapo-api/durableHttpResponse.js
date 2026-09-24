/**
 * ONLINE-O5 — Ensure mutating HTTP 2xx responses wait for durable PG/json flush
 * before the response body is sent (Express 4–safe deferred res.json).
 */
import { durableFlushBeforeResponse } from './db.js'

/** Routes that must not block on snapshot flush (ephemeral / test / already-O8 atomic). */
/** O1–O4: businessMutationTx already committed docs — avoid full snapshot flush (test harness). */
const O8_ALREADY_DURABLE_RE = [
  /^\/pos\/shifts\//,
  /^\/pos\/sales/,
  /^\/stock\/receipts/,
  /^\/stock\/adjustments/,
  /^\/stock\/writeoffs/,
  /^\/suppliers\/[^/]+\/payments/,
  /^\/expenses/,
  /^\/finance\/moves/,
  /^\/finance\/vault\//,
  /^\/clients\/[^/]+\/debt-adjustments$/,
  /^\/cards\/[^/]+\/(cash-topup|cash-advance|debt-repay|bonus-adjustments)$/,
  /^\/cards\/[^/]+\/unlink$/,
]

const EPHEMERAL_PATH_RE = [
  /^\/__o8\//,
  /^\/__l13\//,
  /^\/health$/,
  /^\/auth\/otp\//,
  /^\/pos\/devices\/heartbeat$/,
  /^\/notifications\/(deliver|read-all|[^/]+\/read)$/,
  /^\/push\/(send|settings)$/,
  /^\/sync\/woocommerce$/,
  /^\/admin\/ai\/ask$/,
  /^\/loyalty\/sync$/,
  /^\/employees\/login$/,
]

export function markResponseEphemeral(res) {
  res.locals.kakapoSkipDurableFlush = true
}

function shouldDurableFlush(req, res) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false
  if (res.locals.kakapoSkipDurableFlush) return false
  const path = req.path || req.url?.split('?')[0] || ''
  if (EPHEMERAL_PATH_RE.some(re => re.test(path))) return false
  if (O8_ALREADY_DURABLE_RE.some(re => re.test(path))) return false
  if (path === '/pos/shifts/open' || path.match(/^\/pos\/shifts\/[^/]+\/close$/)) return false
  return true
}

async function flushMasterDataSnapshot() {
  const prev = process.env.KAKAPO_MASTER_DATA_PERSIST
  process.env.KAKAPO_MASTER_DATA_PERSIST = '1'
  try {
    await durableFlushBeforeResponse()
  } finally {
    if (prev === undefined) delete process.env.KAKAPO_MASTER_DATA_PERSIST
    else process.env.KAKAPO_MASTER_DATA_PERSIST = prev
  }
}

export function installDurableHttpResponse(app) {
  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()

    const origJson = res.json.bind(res)
    const origSend = res.send.bind(res)
    const origEnd = res.end.bind(res)

    function wrapDurableFlush(sendFn, body) {
      if (!shouldDurableFlush(req, res) || res.headersSent) {
        return sendFn(body)
      }
      const code = res.statusCode || 200
      if (code < 200 || code >= 300) {
        return sendFn(body)
      }
      void flushMasterDataSnapshot()
        .then(() => sendFn(body))
        .catch((err) => {
          console.error('[durableHttpResponse] flush failed', err?.message || err)
          if (!res.headersSent) {
            res.status(500).json({ detail: 'Не удалось сохранить данные', code: 'DURABLE_FLUSH_FAILED' })
          }
        })
      return res
    }

    res.json = (body) => {
      return wrapDurableFlush(origJson, body)
    }

    res.send = (body) => wrapDurableFlush(origSend, body)

    res.end = (chunk, encoding, cb) => {
      if (chunk !== undefined && chunk !== null && chunk !== '') {
        return wrapDurableFlush((b) => origEnd(b, encoding, cb), chunk)
      }
      if (!shouldDurableFlush(req, res) || res.headersSent) {
        return origEnd(chunk, encoding, cb)
      }
      const code = res.statusCode || 200
      if (code < 200 || code >= 300) {
        return origEnd(chunk, encoding, cb)
      }
      void flushMasterDataSnapshot()
        .then(() => origEnd(chunk, encoding, cb))
        .catch((err) => {
          console.error('[durableHttpResponse] flush failed', err?.message || err)
          if (!res.headersSent) {
            res.status(500).json({ detail: 'Не удалось сохранить данные', code: 'DURABLE_FLUSH_FAILED' })
          }
        })
      return res
    }

    next()
  })
}
