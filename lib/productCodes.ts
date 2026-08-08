/** Числовой код из артикула / PLU: "5", "0005", "KAK-0005" → 5 */
export function parseProductCodeNum(raw: unknown): number | null {
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

type CodeProduct = { id?: number; art?: string | null; plu?: string | null }

/** Занятые номера артикулов и PLU (после удаления товара номер снова свободен) */
export function collectUsedProductCodes(
  products: CodeProduct[],
  excludeId?: number | null,
): Set<number> {
  const used = new Set<number>()
  for (const p of products) {
    if (excludeId != null && Number(p.id) === Number(excludeId)) continue
    const a = parseProductCodeNum(p.art)
    const pl = parseProductCodeNum(p.plu)
    if (a != null) used.add(a)
    if (pl != null) used.add(pl)
  }
  return used
}

/** Занятые только PLU (1–9999) — для весов */
export function collectUsedPluCodes(
  products: CodeProduct[],
  excludeId?: number | null,
): Set<number> {
  const used = new Set<number>()
  for (const p of products) {
    if (excludeId != null && Number(p.id) === Number(excludeId)) continue
    const pl = parseProductCodeNum(p.plu)
    if (pl != null && pl >= 1 && pl <= 9999) used.add(pl)
  }
  return used
}

/** Самый маленький свободный номер (1, 2, 3… с дырками после удаления) */
export function nextFreeProductCode(
  products: CodeProduct[],
  excludeId?: number | null,
): number {
  const used = collectUsedProductCodes(products, excludeId)
  let n = 1
  while (used.has(n)) n += 1
  return n
}

/** Минимальный свободный PLU 1–9999 (только среди PLU, не артикулов) */
export function nextFreePlu(
  products: CodeProduct[],
  excludeId?: number | null,
): number {
  const used = collectUsedPluCodes(products, excludeId)
  let n = 1
  while (n <= 9999 && used.has(n)) n += 1
  return n
}

export function isArtTaken(
  products: CodeProduct[],
  art: string,
  excludeId?: number | null,
): boolean {
  const key = String(art || '').trim().toLowerCase()
  if (!key) return false
  return products.some(p => {
    if (excludeId != null && Number(p.id) === Number(excludeId)) return false
    return String(p.art || '').trim().toLowerCase() === key
  })
}

export function isPluTaken(
  products: CodeProduct[],
  plu: string,
  excludeId?: number | null,
): boolean {
  const key = String(plu || '').trim()
  if (!key) return false
  return products.some(p => {
    if (excludeId != null && Number(p.id) === Number(excludeId)) return false
    return String(p.plu || '').trim() === key
  })
}

/**
 * Назначить артикул. PLU — только если needPlu (весовой товар).
 * Штучный товар: plu всегда пустой.
 */
export function allocateProductCodes(
  products: CodeProduct[],
  input: { art?: string | null; plu?: string | null },
  excludeId?: number | null,
  opts?: { needPlu?: boolean },
): { art: string; plu?: string } {
  const needPlu = opts?.needPlu === true
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
    plu = pn != null ? String(pn) : plu.replace(/\D/g, '').slice(0, 4)
    if (plu && isPluTaken(products, plu, excludeId)) {
      throw new Error(`PLU «${plu}» уже занят`)
    }
  }

  if (isArtTaken(products, art, excludeId)) {
    throw new Error(`Артикул «${art}» уже занят`)
  }

  return { art, plu: needPlu && plu ? plu : undefined }
}
