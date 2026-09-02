import type { Product } from './types'

function splitBarcodeField(raw: unknown): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw.flatMap(v => splitBarcodeField(v))
  }
  const s = String(raw).replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '').trim()
  if (!s) return []
  // Иногда с API/CSV приходит одна строка «код1, код2»
  if (/[,;|]/.test(s)) {
    return s.split(/[,;|]+/).map(x => x.trim()).filter(Boolean)
  }
  return [s]
}

/** Уникальные штрихкоды товара (основной + дополнительные) */
export function productBarcodes(p: Partial<Product> | null | undefined): string[] {
  if (!p) return []
  const list = [
    ...splitBarcodeField(p.barcode),
    ...splitBarcodeField((p as { barcodes?: unknown }).barcodes),
  ].filter(Boolean)
  return [...new Set(list)]
}

/**
 * Очистка сырого скана: AIM/GS1-префиксы, невидимые символы, пробелы по краям.
 */
export function cleanScannedBarcode(raw: string): string {
  let s = String(raw || '')
  s = s.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
  s = s.trim()
  // AIM prefix ровно 3 символа: ]C1 ]E0 ]d2 — не жрать цифру штриха ({1,3} съедал ]C14…)
  s = s.replace(/^\][A-Za-z][0-9A-Za-z]/, '')
  s = s.replace(/^[\u001D\u00A0]+/, '')
  // GS1 AI в скобках: (01)0460… → 0460…
  s = s.replace(/^\((\d{2})\)/, '')
  // Частый префикс AI 01 перед GTIN-14
  {
    const d = s.replace(/\D/g, '')
    if ((d.length === 16 || d.length === 15) && d.startsWith('01')) s = d.slice(2)
  }
  return s.trim()
}

/**
 * Варианты цифрового кода для сопоставления скана и базы:
 * UPC-A (12) ↔ EAN-13 с ведущим 0, GTIN-14, обрезка ведущих нулей.
 */
export function barcodeDigitKeys(raw: string): string[] {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return []
  const keys = new Set<string>([digits])

  if (digits.length === 12) keys.add(`0${digits}`)
  if (digits.length === 13 && digits.startsWith('0')) keys.add(digits.slice(1))
  // Скан без контрольной / UPC без ведущего 0
  if (digits.length === 13) keys.add(digits.slice(0, 12))
  // GTIN-14 → EAN-13 (ведущий indicator / 0)
  if (digits.length === 14) {
    keys.add(digits.slice(1))
    if (digits.startsWith('0')) keys.add(digits.slice(1))
    keys.add(digits.slice(0, 13))
    keys.add(digits.slice(1, 13))
  }
  if (digits.length === 8) {
    // EAN-8 иногда сравнивают с урезанным хранением без ведущих нулей
    const stripped8 = digits.replace(/^0+/, '')
    if (stripped8 && stripped8 !== digits) keys.add(stripped8)
  }

  const stripped = digits.replace(/^0+/, '')
  if (stripped.length >= 8 && stripped !== digits) {
    keys.add(stripped)
    if (stripped.length === 12) keys.add(`0${stripped}`)
    if (stripped.length === 13) keys.add(stripped)
    if (stripped.length === 11) {
      keys.add(`0${stripped}`)
      keys.add(`00${stripped}`)
    }
  }

  return [...keys]
}

export function barcodesMatch(a: string, b: string): boolean {
  const left = String(a || '').trim()
  const right = String(b || '').trim()
  if (!left || !right) return false
  if (left === right) return true
  const ka = barcodeDigitKeys(left)
  const kb = new Set(barcodeDigitKeys(right))
  return ka.some(k => kb.has(k))
}

export function normalizeBarcodes(codes: string[]) {
  const barcodes = [...new Set(codes.map(c => c.trim()).filter(Boolean))]
  return {
    barcode: barcodes[0],
    barcodes,
  }
}

/** Все товары с точным совпадением штрихкода (один код → несколько карточек) */
export function findProductsByExactBarcode<T extends Partial<Product>>(
  products: T[] | null | undefined,
  raw: string,
): T[] {
  const q = cleanScannedBarcode(raw)
  if (!q) return []
  const qKeys = new Set(barcodeDigitKeys(q))
  const hits: T[] = []
  const seen = new Set<number>()
  for (const p of products || []) {
    const id = Number(p.id)
    if (Number.isFinite(id) && seen.has(id)) continue
    const match = productBarcodes(p).some(c => {
      if (c === q) return true
      return barcodeDigitKeys(c).some(k => qKeys.has(k))
    })
    if (!match) continue
    if (Number.isFinite(id)) seen.add(id)
    hits.push(p)
  }
  return hits
}

/** Префикс внутренних EAN-13 (не 2x — чтобы не путать с весовыми этикетками) */
export const INTERNAL_EAN_PREFIX = '460'

export function ean13CheckDigit(digits12: string): string {
  const d = String(digits12 || '').replace(/\D/g, '').padStart(12, '0').slice(0, 12)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return String((10 - (sum % 10)) % 10)
}

export function buildEan13(digits12: string): string {
  const d = String(digits12 || '').replace(/\D/g, '').padStart(12, '0').slice(0, 12)
  return d + ean13CheckDigit(d)
}

export function collectUsedBarcodes(
  products: Array<Partial<Product>> | null | undefined,
  excludeId?: number | null,
): Set<string> {
  const used = new Set<string>()
  for (const p of products || []) {
    if (excludeId != null && p.id != null && Number(p.id) === Number(excludeId)) continue
    for (const c of productBarcodes(p)) {
      used.add(c)
      const d = c.replace(/\D/g, '')
      if (d.length >= 4) used.add(`d:${d}`)
    }
  }
  return used
}

/** Товар, у которого уже есть этот штрихкод (кроме excludeId). */
export function findBarcodeOwner(
  products: Array<Partial<Product>> | null | undefined,
  code: string,
  excludeId?: number | null,
): { id: number; name: string; barcode: string } | null {
  const q = String(code || '').trim()
  if (!q) return null
  const digits = q.replace(/\D/g, '')
  for (const p of products || []) {
    if (excludeId != null && p.id != null && Number(p.id) === Number(excludeId)) continue
    for (const c of productBarcodes(p)) {
      if (barcodesMatch(c, q) || (digits.length >= 4 && barcodesMatch(c, digits))) {
        return {
          id: Number(p.id) || 0,
          name: String(p.name || `#${p.id}`),
          barcode: c,
        }
      }
    }
  }
  return null
}

/** Все владельцы штрихкода (кроме excludeId) — для подсказки при общем коде. */
export function findBarcodeOwners(
  products: Array<Partial<Product>> | null | undefined,
  code: string,
  excludeId?: number | null,
): Array<{ id: number; name: string; barcode: string }> {
  const q = String(code || '').trim()
  if (!q) return []
  const digits = q.replace(/\D/g, '')
  const hits: Array<{ id: number; name: string; barcode: string }> = []
  const seen = new Set<number>()
  for (const p of products || []) {
    const id = Number(p.id)
    if (excludeId != null && Number.isFinite(id) && id === Number(excludeId)) continue
    if (Number.isFinite(id) && seen.has(id)) continue
    for (const c of productBarcodes(p)) {
      if (barcodesMatch(c, q) || (digits.length >= 4 && barcodesMatch(c, digits))) {
        if (Number.isFinite(id)) seen.add(id)
        hits.push({
          id: Number.isFinite(id) ? id : 0,
          name: String(p.name || `#${p.id}`),
          barcode: c,
        })
        break
      }
    }
  }
  return hits
}

/** @deprecated уникальность штрихкода не требуется — один код может быть у нескольких товаров */
export function assertBarcodesAvailable(
  _products: Array<Partial<Product>> | null | undefined,
  _codes: string[],
  _excludeId?: number | null,
): void {
  /* no-op: дубликаты разрешены, на кассе показывается выбор */
}

/**
 * Свободный внутренний EAN-13: 460 + 9 цифр + контрольная.
 * preferSerial — обычно номер артикула (если свободен).
 */
export function nextFreeEan13(
  products: Array<Partial<Product>> | null | undefined,
  preferSerial?: number | null,
  excludeId?: number | null,
): string {
  const used = collectUsedBarcodes(products, excludeId)
  let n = preferSerial && preferSerial > 0 ? Math.floor(preferSerial) : 1
  if (n > 999_999_999) n = 1
  for (let i = 0; i < 1_000_000; i++) {
    const serial = ((n - 1 + i) % 999_999_999) + 1
    const code = buildEan13(INTERNAL_EAN_PREFIX + String(serial).padStart(9, '0'))
    if (!used.has(code)) return code
  }
  const stamp = Date.now() % 1_000_000_000
  return buildEan13(INTERNAL_EAN_PREFIX + String(stamp).padStart(9, '0'))
}

/**
 * Мастер-штрихкод весового товара (CAS / весы):
 * 21 + PLU(5) + 00000 + контрольная.
 * Вес на этикетке печатают весы; в карточке храним «нулевой» вес.
 */
export function buildWeightMasterBarcode(plu: number | string): string | null {
  const n = typeof plu === 'number' ? plu : Number(String(plu || '').replace(/\D/g, ''))
  if (!Number.isFinite(n) || n <= 0 || n > 99999) return null
  const item = String(Math.floor(n)).padStart(5, '0')
  return buildEan13(`21${item}00000`)
}

export function productBarcodeSearchText(p: Partial<Product>): string {
  return productBarcodes(p).join(' ')
}

/**
 * Фонетическая нормализация: bic ≈ бик, cola ≈ кола.
 * Сводит латиницу и кириллицу к одному «скелету» для поиска.
 */
export function foldSearchText(input: string): string {
  let s = String(input || '').toLowerCase().replace(/ё/g, 'е')
  // лат. диграфы → одна «буква»-токен
  s = s
    .replace(/sch/g, 'щ')
    .replace(/sh/g, 'ш')
    .replace(/ch/g, 'ч')
    .replace(/zh/g, 'ж')
    .replace(/kh/g, 'х')
    .replace(/ts/g, 'ц')
    .replace(/yo/g, 'е')
    .replace(/yu/g, 'ю')
    .replace(/ya/g, 'я')
    .replace(/ye/g, 'е')

  let out = ''
  for (const ch of s) {
    if (LAT_FOLD[ch]) out += LAT_FOLD[ch]
    else if (CYR_FOLD[ch]) out += CYR_FOLD[ch]
    else if (/[a-z0-9]/.test(ch)) out += ch
    else if (/\s|-|_/.test(ch)) out += ' '
  }
  return out.replace(/\s+/g, ' ').trim()
}

const LAT_FOLD: Record<string, string> = {
  // c → k: bic/бик, cola/кола
  a: 'a', b: 'b', c: 'k', d: 'd', e: 'e', f: 'f', g: 'g', h: 'h',
  i: 'i', j: 'j', k: 'k', l: 'l', m: 'm', n: 'n', o: 'o', p: 'p',
  q: 'k', r: 'r', s: 's', t: 't', u: 'u', v: 'v', w: 'v', x: 'x',
  y: 'i', z: 'z',
}

const CYR_FOLD: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** Текст для полнотекстового поиска: имя, артикул, штрихкоды, PLU, бренд */
export function productSearchHaystack(p: Partial<Product>, extra = ''): string {
  return [
    p.name,
    p.art,
    p.brand,
    p.plu,
    productBarcodeSearchText(p),
    extra,
  ].filter(Boolean).join(' ').toLowerCase()
}

function textMatchScore(hay: string, q: string, qFold: string): number {
  if (!q) return 0
  const h = hay.toLowerCase()
  const hFold = foldSearchText(hay)
  if (!h && !hFold) return 0
  if (h === q || hFold === qFold) return 100
  if (h.startsWith(q) || hFold.startsWith(qFold)) return 90
  const words = h.split(/[\s,/.\-_+]+/).filter(Boolean)
  const wordsFold = hFold.split(/\s+/).filter(Boolean)
  if (words.some(w => w.startsWith(q)) || wordsFold.some(w => w.startsWith(qFold))) return 80
  if (h.includes(q) || (qFold.length >= 2 && hFold.includes(qFold))) return 60
  return 0
}

/**
 * Релевантность для списка поиска (касса / склад).
 * Приоритет: точный код → хвост штрихкода (4–5+) → название (с транслитом) → артикул.
 */
export function productSearchScore(p: Partial<Product>, query: string, extra = ''): number {
  const qRaw = query.trim()
  const q = qRaw.toLowerCase()
  if (!q) return 0

  const qFold = foldSearchText(qRaw)
  const qDigits = qRaw.replace(/\D/g, '')
  const codes = productBarcodes(p)
  const codeDigits = codes.map(c => c.replace(/\D/g, '')).filter(Boolean)

  // 1) Точный штрихкод (с учётом UPC/EAN ведущего нуля)
  if (codes.some(c => barcodesMatch(c, qRaw))) return 1000
  if (qDigits.length >= 8 && codeDigits.some(cd => barcodeDigitKeys(cd).some(k => barcodeDigitKeys(qDigits).includes(k)))) return 1000

  // 2) Хвост штрихкода: последние 4–5+ цифр → вверху списка
  if (qDigits.length >= 4 && /^\d+$/.test(qRaw.replace(/[\s\-]/g, ''))) {
    if (codeDigits.some(cd => cd.length >= qDigits.length && cd.endsWith(qDigits))) {
      return qDigits.length >= 5 ? 970 : 960
    }
  }

  const name = (p.name || '').toLowerCase()
  const art = (p.art || '').toLowerCase()
  const brand = (p.brand || '').toLowerCase()
  const pluDigits = String(p.plu || '').replace(/\D/g, '')

  // 3) Точный артикул / PLU
  if (art && art === q) return 940
  if (qDigits && pluDigits && pluDigits === qDigits && qDigits.length <= 6) return 930

  // 4) Название / бренд (латиница ↔ кириллица: bic ≈ бик)
  const nameHit = textMatchScore(name, q, qFold)
  if (nameHit >= 100) return 920
  if (nameHit >= 90) return 900
  if (nameHit >= 80) return 880
  if (nameHit >= 60) return 860

  const brandHit = textMatchScore(brand, q, qFold)
  if (brandHit >= 80) return 840
  if (brandHit >= 60) return 820

  const artHit = textMatchScore(art, q, qFold)
  if (artHit >= 90) return 800
  if (artHit >= 60) return 760

  // 5) Префикс / середина длинного штрихкода
  if (qDigits.length >= 8) {
    if (codeDigits.some(cd => cd.startsWith(qDigits))) return 700
    if (codeDigits.some(cd => cd.includes(qDigits))) return 650
  }
  if (qRaw.length >= 8) {
    if (codes.some(c => c.startsWith(qRaw))) return 700
    if (codes.some(c => c.includes(qRaw))) return 650
  }

  // Короткие чистые цифры без совпадения PLU/хвоста — не шумим по haystack
  if (/^\d+$/.test(qRaw) && qDigits.length <= 7) return 0

  const haystack = productSearchHaystack(p, extra)
  const hayHit = textMatchScore(haystack, q, qFold)
  if (hayHit >= 60) return 200
  if (hayHit > 0) return 100
  return 0
}

export function productMatchesSearch(p: Partial<Product>, query: string, extra = ''): boolean {
  if (!query.trim()) return true
  return productSearchScore(p, query, extra) > 0
}

/** Отфильтровать и отсортировать товары по имени / артикулу / штрихкоду */
export function filterProductsBySearch<T extends Partial<Product>>(
  products: T[],
  query: string,
  limit = 30,
  extraForProduct?: (p: T) => string,
): T[] {
  const q = query.trim()
  if (!q) return products.slice(0, limit)
  return products
    .map(p => ({ p, score: productSearchScore(p, q, extraForProduct?.(p) || '') }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(row => row.p)
}

/** Лучшее совпадение для сканера (Enter / точный штрихкод / PLU) */
export function pickProductBySearch<T extends Partial<Product>>(
  products: T[],
  query: string,
  extraForProduct?: (p: T) => string,
): T | null {
  const q = query.trim()
  if (!q) return null
  // Один-два символа слишком шумные для автопробития («р» ≈ половина каталога)
  if (q.length < 3 && !/^\d{1,4}$/.test(q)) return null
  const qDigits = q.replace(/\D/g, '')
  const rows = filterProductsBySearch(products, q, 30, extraForProduct)
  if (!rows.length) return null

  const exactBarcode = rows.find(p => {
    const codes = productBarcodes(p)
    return codes.some(c => barcodesMatch(c, q))
  })
  if (exactBarcode) return exactBarcode

  const exactArt = rows.find(p => String(p.art || '').toLowerCase() === q.toLowerCase())
  if (exactArt) return exactArt

  // PLU (обычно 4 цифры) — только точное совпадение, не префикс штрихкода
  if (qDigits.length >= 1 && qDigits.length <= 4 && /^\d+$/.test(q.trim())) {
    const exactPlu = rows.find(p => String(p.plu || '').replace(/\D/g, '') === qDigits)
    if (exactPlu) return exactPlu
    return null
  }

  // 5–7 цифр без точного штриха/PLU/артикула — не угадываем по хвосту штрихкода
  if (/^\d+$/.test(q.trim()) && qDigits.length >= 5 && qDigits.length < 8) return null

  const scoreOf = (p: T) => productSearchScore(p, q, extraForProduct?.(p) || '')

  if (rows.length === 1) {
    const only = rows[0]
    const sc = scoreOf(only)
    // Для короткого текста требуем сильное совпадение (не «содержит букву»)
    if (q.length < 5) return sc >= 880 ? only : null
    return sc >= 600 ? only : null
  }
  const top = rows[0]
  const second = rows[1]
  const topScore = scoreOf(top)
  const secondScore = scoreOf(second)
  // Несколько кандидатов с близким счётом — не угадываем (Шакар vs чужой товар)
  if (topScore < 880) return null
  if (secondScore >= topScore - 20 && secondScore >= 860) return null
  if (q.length < 5 && topScore < 900) return null
  return topScore >= 600 ? top : null
}

/** Поиск товара в строке документа (приход, списание, ревизия) */
export function documentProductMatchesSearch(
  productId: number,
  productName: string,
  products: Iterable<Partial<Product>>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (productName.toLowerCase().includes(q)) return true
  for (const p of products) {
    if (p.id === productId && productMatchesSearch(p, q)) return true
  }
  return false
}
