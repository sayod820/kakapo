import { parseProductCodeNum } from './productCodes'
import { productBarcodes } from './productBarcodes'
import { isWeighted } from './productWeight'
import type { Product } from './types'

/**
 * Весовая этикетка EAN-13 (CAS / in-store):
 *   21 IIIII WWWWW C
 *   21 00001 00255 8  → PLU 1, 255 г = 0.255 кг
 *
 * Только префикс 21. Коды 20/22–29 — обычные штрихкоды товаров, не вес.
 * Поиск товара — только по PLU (артикул не используется).
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

/** Префикс весовых этикеток на весах KAKAPO */
export const SCALE_BARCODE_PREFIX = '21'

export function parseScaleBarcode(raw: string): ScaleBarcodeParse | null {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length !== 13) return null
  if (!digits.startsWith(SCALE_BARCODE_PREFIX)) return null

  const prefix = SCALE_BARCODE_PREFIX
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

function pluMatches(p: Partial<Product>, code: number): boolean {
  return parseProductCodeNum(p.plu) === code
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

function uniqById<T extends Partial<Product>>(rows: T[]): T[] {
  const out: T[] = []
  const seen = new Set<number>()
  for (const p of rows) {
    const id = Number(p.id)
    if (Number.isFinite(id)) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    out.push(p)
  }
  return out
}

/**
 * Товары по весовой этикетке — только по PLU.
 * Артикул не учитывается (иначе Шакар art=80 путается с чужим plu=80).
 */
export function findProductsForScaleBarcode<T extends Partial<Product>>(
  products: T[],
  parsed: ScaleBarcodeParse,
): T[] {
  const codes = [parsed.itemCode, ...parsed.altItemCodes]
  const weighted = products.filter(p => isWeighted(p))
  const pools = [weighted, products]

  for (const pool of pools) {
    const byPlu = uniqById(pool.filter(p => codes.some(code => pluMatches(p, code))))
    if (byPlu.length) return byPlu

    // Запасной путь: полный/префиксный штрихкод из карточки (не артикул)
    const byBarcode = uniqById(pool.filter(p => barcodePrefixMatch(p, parsed.digits, parsed.itemCodeRaw)))
    if (byBarcode.length) return byBarcode
  }
  return []
}

/** Один товар по PLU с этикетки; если несколько или нет — null */
export function findProductForScaleBarcode<T extends Partial<Product>>(
  products: T[],
  parsed: ScaleBarcodeParse,
): T | null {
  const hits = findProductsForScaleBarcode(products, parsed)
  return hits.length === 1 ? hits[0] : null
}
