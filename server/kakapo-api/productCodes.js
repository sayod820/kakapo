/** Числовой код из артикула / PLU: "5", "0005", "KAK-0005" → 5 */
export function parseProductCodeNum(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const m = s.match(/(\d+)\s*$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export function collectUsedProductCodes(products, excludeId) {
  const used = new Set()
  for (const p of products || []) {
    if (excludeId != null && Number(p.id) === Number(excludeId)) continue
    const a = parseProductCodeNum(p.art)
    const pl = parseProductCodeNum(p.plu)
    if (a != null) used.add(a)
    if (pl != null) used.add(pl)
  }
  return used
}

/** Самый маленький свободный номер после удалений */
export function nextFreeProductCode(products, excludeId) {
  const used = collectUsedProductCodes(products, excludeId)
  let n = 1
  while (used.has(n)) n += 1
  return n
}

export function isArtTaken(products, art, excludeId) {
  const key = String(art || '').trim().toLowerCase()
  if (!key) return false
  return (products || []).some(p => {
    if (excludeId != null && Number(p.id) === Number(excludeId)) return false
    return String(p.art || '').trim().toLowerCase() === key
  })
}

export function isPluTaken(products, plu, excludeId) {
  const key = String(plu || '').trim()
  if (!key) return false
  return (products || []).some(p => {
    if (excludeId != null && Number(p.id) === Number(excludeId)) return false
    return String(p.plu || '').trim() === key
  })
}

/**
 * Пустые артикул/PLU → минимальный свободный номер (оба одинаковые).
 * Удалённый товар освобождает свой номер.
 */
export function allocateProductCodes(products, input = {}, excludeId = null) {
  const free = nextFreeProductCode(products, excludeId)
  let art = String(input.art ?? '').trim()
  let plu = String(input.plu ?? '').trim()

  if (!art && !plu) {
    art = String(free)
    plu = free <= 9999 ? String(free) : ''
  } else if (!art) {
    const pn = parseProductCodeNum(plu)
    art = pn != null ? String(pn) : String(free)
  } else if (!plu) {
    const an = parseProductCodeNum(art)
    if (an != null && an <= 9999) plu = String(an)
    else if (free <= 9999) plu = String(free)
  }

  if (plu) {
    const pn = parseProductCodeNum(plu)
    if (pn != null && pn > 9999) {
      throw new Error('PLU должен быть от 1 до 9999')
    }
    plu = pn != null ? String(pn) : String(plu).replace(/\D/g, '').slice(0, 4)
  }

  if (isArtTaken(products, art, excludeId)) {
    throw new Error(`Артикул «${art}» уже занят`)
  }
  if (plu && isPluTaken(products, plu, excludeId)) {
    throw new Error(`PLU «${plu}» уже занят`)
  }

  return { art, plu: plu || undefined }
}
