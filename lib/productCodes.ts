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
 * Назначить артикул и PLU: пустые поля → минимальный свободный номер.
 * Один и тот же номер для обоих, если оба пустые.
 */
export function allocateProductCodes(
  products: CodeProduct[],
  input: { art?: string | null; plu?: string | null },
  excludeId?: number | null,
): { art: string; plu?: string } {
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
    plu = pn != null ? String(pn) : plu.replace(/\D/g, '').slice(0, 4)
  }

  if (isArtTaken(products, art, excludeId)) {
    throw new Error(`Артикул «${art}» уже занят`)
  }
  if (plu && isPluTaken(products, plu, excludeId)) {
    throw new Error(`PLU «${plu}» уже занят`)
  }

  return { art, plu: plu || undefined }
}
