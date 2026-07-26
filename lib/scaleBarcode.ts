import { parseProductCodeNum } from './productCodes'
import { productBarcodes } from './productBarcodes'
import { isWeighted } from './productWeight'
import type { Product } from './types'

/**
 * Весовая этикетка EAN-13 (CAS / in-store GS1):
 *   2X IIIII WWWWW C
 *   21 00001 00255 8  → PLU 1, 255 г = 0.255 кг
 *
 * Альтернатива (некоторые настройки весов):
 *   2 PPPPP WWWWW C
 *   2 10001 00255 8 → PLU 10001, 255 г
 */
export type ScaleBarcodeParse = {
  digits: string
  prefix: string
  itemCode: number
  itemCodeRaw: string
  /** Доп. кандидаты PLU (другая разбивка штрихкода) */
  altItemCodes: number[]
  grams: number
  weightKg: number
  valueRaw: string
}

export function parseScaleBarcode(raw: string): ScaleBarcodeParse | null {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length !== 13) return null
  if (digits[0] !== '2') return null

  const prefix = digits.slice(0, 2)
  if (!/^2\d$/.test(prefix)) return null

  const itemCodeRaw = digits.slice(2, 7)
  const valueRaw = digits.slice(7, 12)
  const itemCode = Number(itemCodeRaw)
  const grams = Number(valueRaw)
  if (!Number.isFinite(itemCode) || itemCode <= 0) return null
  if (!Number.isFinite(grams) || grams <= 0) return null

  const weightKg = Math.round(grams) / 1000
  // Пачка больше 100 кг на этикетке не бывает — отсекаем «ценовые» коды
  if (!(weightKg > 0.0005) || weightKg > 100) return null

  const altCodes = new Set<number>()
  // Иногда PLU без ведущих нулей хранят иначе — пробуем 4 цифры справа от префикса
  const alt4 = Number(digits.slice(3, 7))
  if (Number.isFinite(alt4) && alt4 > 0 && alt4 !== itemCode) altCodes.add(alt4)

  return {
    digits,
    prefix,
    itemCode,
    itemCodeRaw,
    altItemCodes: [...altCodes],
    grams: Math.round(grams),
    weightKg,
    valueRaw,
  }
}

function codeMatches(p: Partial<Product>, code: number): boolean {
  return parseProductCodeNum(p.plu) === code || parseProductCodeNum(p.art) === code
}

function barcodePrefixMatch(p: Partial<Product>, digits: string, itemCodeRaw: string): boolean {
  const stem = digits.slice(0, 7) // 2X + IIIII без веса
  for (const c of productBarcodes(p)) {
    const cd = c.replace(/\D/g, '')
    if (!cd) continue
    if (cd === digits) return true
    if (cd.length >= 7 && cd.slice(0, 7) === stem) return true
    // В карточке хранят только PLU-часть штрихкода
    if (cd === itemCodeRaw || Number(cd) === Number(itemCodeRaw)) return true
  }
  return false
}

/** Найти товар по PLU/артикулу из весовой этикетки */
export function findProductForScaleBarcode<T extends Partial<Product>>(
  products: T[],
  parsed: ScaleBarcodeParse,
): T | null {
  const codes = [parsed.itemCode, ...parsed.altItemCodes]

  const weighted = products.filter(p => isWeighted(p))
  const pools = [weighted, products]

  for (const pool of pools) {
    for (const code of codes) {
      const hit = pool.find(p => codeMatches(p, code))
      if (hit) return hit
    }
    const byBarcode = pool.find(p => barcodePrefixMatch(p, parsed.digits, parsed.itemCodeRaw))
    if (byBarcode) return byBarcode
  }
  return null
}
