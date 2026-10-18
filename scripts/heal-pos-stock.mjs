#!/usr/bin/env node
/**
 * Лечение «висячего» остатка на работающем сервере (без перезапуска).
 *
 * Товар числится в наличии (`product.stock > 0`), но открытых партий меньше:
 * касса отвечает «Недостаточно остатка … (есть 0)». Скрипт находит такие товары
 * и переносит недостающую часть в партию через POST /products/:id/stock-layers.
 *
 * Остаток товара НЕ меняется (партии догоняют счётчик), деньги поставщику не
 * начисляются (paidNow = 0), долг не растёт. Партия помечена «Перенос остатка».
 *
 * По умолчанию — только показать. Запись: --apply
 *
 *   node scripts/heal-pos-stock.mjs --api https://kakappo.shop/api/kakapo
 *   node scripts/heal-pos-stock.mjs --api https://kakappo.shop/api/kakapo --apply
 *   node scripts/heal-pos-stock.mjs --api ... --apply --id 437
 */
const args = process.argv.slice(2)
const arg = (name, def = '') => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return def
  const v = args[i + 1]
  return v == null || v.startsWith('--') ? def : String(v)
}
const flag = (name) => args.includes(`--${name}`)

const api = String(arg('api', process.env.KAKAPO_API || 'http://localhost:8000')).replace(/\/+$/, '')
const apply = flag('apply')
const onlyId = arg('id', '')
const label = arg('label', 'Перенос остатка · старый приход')

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

async function request(path, { method = 'GET', body } = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 30000)
      const res = await fetch(`${api}${path}`, {
        method,
        signal: ctl.signal,
        headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      clearTimeout(timer)
      const text = await res.text()
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
      return text ? JSON.parse(text) : null
    } catch (e) {
      if (i === tries - 1) throw e
      await new Promise(r => setTimeout(r, 1200))
    }
  }
}

console.log(`Сервер: ${api}`)
console.log(apply ? 'РЕЖИМ: запись' : 'РЕЖИМ: только показать (для записи добавьте --apply)')

const productsRaw = await request('/products')
const products = (Array.isArray(productsRaw) ? productsRaw : productsRaw?.products || [])
  .filter(p => !p.deleted && !p.archived)
const layersRaw = await request('/stock/layers')
const layers = Array.isArray(layersRaw) ? layersRaw : (layersRaw?.layers || layersRaw?.items || [])

const layerSum = new Map()
for (const l of layers) {
  const pid = Number(l.productId)
  const qty = Number(l.remainingQty) || 0
  if (!pid || !(qty > 0)) continue
  layerSum.set(pid, r2((layerSum.get(pid) || 0) + qty))
}

const gaps = []
for (const p of products) {
  if (onlyId && String(p.id) !== String(onlyId)) continue
  const stock = r2(p.stock)
  const inLayers = r2(layerSum.get(Number(p.id)) || 0)
  const gap = r2(stock - inLayers)
  if (gap > 0.0001) gaps.push({ id: Number(p.id), name: p.name, art: p.art, price: r2(p.price), costPrice: r2(p.costPrice), stock, inLayers, gap })
}

if (!gaps.length) {
  console.log('\nРасхождений нет: у всех товаров партии покрывают остаток.')
  process.exit(0)
}

console.log(`\nТоваров с «висячим» остатком: ${gaps.length}`)
for (const g of gaps) {
  console.log(`  #${g.id} ${g.name} | арт. ${g.art || '—'} | остаток ${g.stock} | партии ${g.inLayers} | перенести ${g.gap}`)
}

if (!apply) {
  console.log('\nНичего не изменено. Запустите с --apply, чтобы перенести остаток в партии.')
  process.exit(0)
}

let ok = 0
let failed = 0
for (const g of gaps) {
  try {
    await request(`/products/${g.id}/stock-layers`, {
      method: 'POST',
      body: {
        qty: g.gap,
        costPrice: g.costPrice,
        retailPrice: g.price,
        supplierName: label,
        createdBy: 'stock-heal',
        paidNow: 0,
      },
    })
    ok += 1
    console.log(`  OK  #${g.id} ${g.name}: перенесено ${g.gap}`)
  } catch (e) {
    failed += 1
    console.log(`  FAIL #${g.id} ${g.name}: ${e.message}`)
  }
}

// Проверка результата: остаток не должен измениться, партии — догнать остаток
console.log('\nПроверка после записи:')
const productsAfter = await request('/products')
const after = (Array.isArray(productsAfter) ? productsAfter : productsAfter?.products || [])
const layersAfter = await request('/stock/layers')
const layersAfterList = Array.isArray(layersAfter) ? layersAfter : (layersAfter?.layers || layersAfter?.items || [])
const sumAfter = new Map()
for (const l of layersAfterList) {
  const pid = Number(l.productId)
  const qty = Number(l.remainingQty) || 0
  if (!pid || !(qty > 0)) continue
  sumAfter.set(pid, r2((sumAfter.get(pid) || 0) + qty))
}
let bad = 0
for (const g of gaps) {
  const p = after.find(x => Number(x.id) === g.id)
  const stockNow = r2(p?.stock)
  const layersNow = r2(sumAfter.get(g.id) || 0)
  const stockSame = Math.abs(stockNow - g.stock) < 0.011
  const layersOk = layersNow + 0.011 >= stockNow
  if (!stockSame || !layersOk) bad += 1
  console.log(`  ${stockSame && layersOk ? 'OK  ' : 'FAIL'} #${g.id}: остаток ${g.stock} → ${stockNow}, партии ${g.inLayers} → ${layersNow}`)
}

console.log(`\n=== перенесено: ${ok}, ошибок: ${failed}, проверка: ${bad ? bad + ' проблем' : 'всё сходится'} ===`)
if (failed || bad) process.exit(1)
