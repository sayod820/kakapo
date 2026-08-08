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

/** Занятые только PLU (1–9999) */
export function collectUsedPluCodes(products, excludeId) {
  const used = new Set()
  for (const p of products || []) {
    if (excludeId != null && Number(p.id) === Number(excludeId)) continue
    const pl = parseProductCodeNum(p.plu)
    if (pl != null && pl >= 1 && pl <= 9999) used.add(pl)
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

/** Минимальный свободный PLU 1–9999 */
export function nextFreePlu(products, excludeId) {
  const used = collectUsedPluCodes(products, excludeId)
  let n = 1
  while (n <= 9999 && used.has(n)) n += 1
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
 * Артикул всегда. PLU — только needPlu (весовой).
 * Штучный: plu сбрасывается.
 */
export function allocateProductCodes(products, input = {}, excludeId = null, opts = {}) {
  const needPlu = opts.needPlu === true
  const free = nextFreeProductCode(products, excludeId)
  let art = String(input.art ?? '').trim()
  let plu = needPlu ? String(input.plu ?? '').trim() : ''

  if (!art) {
    const pn = needPlu ? parseProductCodeNum(plu) : null
    art = pn != null ? String(pn) : String(free)
  }

  if (needPlu) {
    if (!plu) {
      const n = nextFreePlu(products, excludeId)
      plu = n <= 9999 ? String(n) : ''
    }
    const pn = parseProductCodeNum(plu)
    if (pn != null && pn > 9999) {
      throw new Error('PLU должен быть от 1 до 9999')
    }
    plu = pn != null ? String(pn) : String(plu).replace(/\D/g, '').slice(0, 4)
    if (plu && isPluTaken(products, plu, excludeId)) {
      throw new Error(`PLU «${plu}» уже занят`)
    }
  }

  if (isArtTaken(products, art, excludeId)) {
    throw new Error(`Артикул «${art}» уже занят`)
  }

  return { art, plu: needPlu && plu ? plu : undefined }
}

/** Префикс внутренних EAN-13 (не 2x — весовые этикетки) */
export const INTERNAL_EAN_PREFIX = '460'

export function ean13CheckDigit(digits12) {
  const d = String(digits12 || '').replace(/\D/g, '').padStart(12, '0').slice(0, 12)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return String((10 - (sum % 10)) % 10)
}

export function buildEan13(digits12) {
  const d = String(digits12 || '').replace(/\D/g, '').padStart(12, '0').slice(0, 12)
  return d + ean13CheckDigit(d)
}

export function productBarcodeList(p) {
  if (!p) return []
  const list = [
    ...(p.barcode ? [String(p.barcode).trim()] : []),
    ...(Array.isArray(p.barcodes) ? p.barcodes.map(b => String(b).trim()) : []),
  ].filter(Boolean)
  return [...new Set(list)]
}

export function collectUsedBarcodes(products, excludeId) {
  const used = new Set()
  for (const p of products || []) {
    if (excludeId != null && Number(p.id) === Number(excludeId)) continue
    for (const c of productBarcodeList(p)) used.add(c)
  }
  return used
}

/** Свободный внутренний EAN-13: 460 + 9 цифр + контрольная */
export function nextFreeEan13(products, preferSerial, excludeId = null) {
  const used = collectUsedBarcodes(products, excludeId)
  let n = preferSerial && preferSerial > 0 ? Math.floor(preferSerial) : 1
  if (n > 999999999) n = 1
  for (let i = 0; i < 1000000; i++) {
    const serial = ((n - 1 + i) % 999999999) + 1
    const code = buildEan13(INTERNAL_EAN_PREFIX + String(serial).padStart(9, '0'))
    if (!used.has(code)) return code
  }
  const stamp = Date.now() % 1000000000
  return buildEan13(INTERNAL_EAN_PREFIX + String(stamp).padStart(9, '0'))
}

/** Нормализация barcodes из тела запроса; пусто → авто EAN-13 */
export function allocateProductBarcodes(products, input = {}, preferSerial = null, excludeId = null) {
  let list = []
  if (Array.isArray(input.barcodes)) {
    list = input.barcodes.map(b => String(b).trim()).filter(Boolean)
  }
  if (input.barcode) {
    const one = String(input.barcode).trim()
    if (one) list.unshift(one)
  }
  list = [...new Set(list)]
  if (!list.length) {
    list = [nextFreeEan13(products, preferSerial, excludeId)]
  }
  const used = collectUsedBarcodes(products, excludeId)
  for (const code of list) {
    if (used.has(code)) {
      throw new Error(`Штрихкод «${code}» уже занят`)
    }
  }
  return { barcode: list[0], barcodes: list }
}
