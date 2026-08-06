/**
 * Идемпотентность офлайн-очереди Offline V2.
 * При повторе запроса с тем же clientRef отдаём сохранённый результат.
 */
export function takeClientRef(req) {
  return String(req?.body?.clientRef || req?.query?.clientRef || '').trim()
}

export function makeIdempotency(findOpRef, rememberOpRef) {
  function replyIfKnownOp(res, kind, clientRef) {
    if (!clientRef) return false
    const known = findOpRef(kind, clientRef)
    if (known == null) return false
    res.json(known)
    return true
  }

  function remember(kind, clientRef, result) {
    if (clientRef) rememberOpRef(kind, clientRef, result)
  }

  return { replyIfKnownOp, remember, takeClientRef }
}
