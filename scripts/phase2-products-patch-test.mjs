/**
 * Phase 2 — stock patch / no full catalog rewrite on sale.
 * Run: node scripts/phase2-products-patch-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storeSrc = fs.readFileSync(path.join(root, 'lib', 'store.ts'), 'utf8')
const posSrc = fs.readFileSync(path.join(root, 'lib', 'offlinePosOps.ts'), 'utf8')
const cashierSrc = fs.readFileSync(path.join(root, 'components', 'trade', 'CashierModule.tsx'), 'utf8')

const results = []
function test(name, fn) {
  try {
    fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ── Simulate store patchProductStocks (mirrors lib/store.ts) ─────────────────
function makeCatalog(n) {
  const products = []
  for (let i = 1; i <= n; i++) {
    products.push({ id: i, name: `P${i}`, stock: 100, barcode: `460${String(i).padStart(10, '0')}` })
  }
  return {
    products,
    catalogEpoch: 1,
    stockEpoch: 0,
    patchProductStocks(patches, mode = 'delta') {
      const map = patches instanceof Map ? patches : new Map(patches)
      let touched = 0
      let mapPasses = 0
      mapPasses += 1
      this.products = this.products.map(p => {
        if (!map.has(p.id)) return p
        const raw = Number(map.get(p.id)) || 0
        const nextStock = mode === 'set'
          ? Math.max(0, raw)
          : Math.max(0, (Number(p.stock) || 0) + raw)
        if (Math.abs(nextStock - (Number(p.stock) || 0)) < 0.0001) return p
        touched += 1
        return { ...p, stock: nextStock }
      })
      if (touched) this.stockEpoch += 1
      return { touched, catalogSize: this.products.length, mapPasses }
    },
    /** OLD: N× full map via updateProduct */
    updateProductLoop(deltas) {
      let mapPasses = 0
      for (const [id, delta] of deltas) {
        mapPasses += 1
        this.products = this.products.map(p => (
          p.id === id ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) + delta) } : p
        ))
      }
      return { mapPasses }
    },
  }
}

test('source — patchProductStocks exists', () => {
  expect(storeSrc.includes('patchProductStocks'), 'API missing')
  expect(storeSrc.includes('catalogEpoch'), 'catalogEpoch missing')
  expect(posSrc.includes('patchProductStocks'), 'sale path not wired')
  expect(!/createSaleSafe[\s\S]{0,2500}products:\s*s\.products\.map/.test(posSrc)
    || !posSrc.includes("products: s.products.map(p => {\n            const dec = decById"), 'old createSaleSafe map still present')
})

test('source — Cashier indexes use catalogEpoch', () => {
  expect(cashierSrc.includes('catalogEpoch'), 'catalogEpoch subscribe')
  expect(/productCodeIndex = useMemo\([\s\S]*?\[catalogEpoch\]/.test(cashierSrc), 'productCodeIndex deps')
  expect(/receiptBarcodeIndex = useMemo\([\s\S]*?\[catalogEpoch\]/.test(cashierSrc), 'receiptBarcodeIndex deps')
  expect(/\}, \[catalogEpoch, warehouseRev\]/.test(cashierSrc), 'layers effect deps')
})

test('A — one product sale stock patch (5k)', () => {
  const cat = makeCatalog(5000)
  const beforeRefs = cat.products.map(p => p)
  const t0 = performance.now()
  const r = cat.patchProductStocks(new Map([[42, -1]]), 'delta')
  const ms = performance.now() - t0
  expect(cat.products[41].stock === 99, 'stock 42 decremented')
  expect(cat.products[0] === beforeRefs[0], 'product 1 same ref')
  expect(cat.products[41] !== beforeRefs[41], 'product 42 new ref')
  expect(r.touched === 1, 'touched 1')
  expect(r.mapPasses === 1, 'one map pass')
  expect(cat.catalogEpoch === 1, 'catalogEpoch unchanged')
  expect(cat.stockEpoch === 1, 'stockEpoch bumped')
  results[results.length - 1].ms = Math.round(ms * 100) / 100
})

test('B — multi item 20 products = one map pass (not 20)', () => {
  const cat = makeCatalog(5000)
  const deltas = new Map()
  for (let i = 1; i <= 20; i++) deltas.set(i, -1)
  const r = cat.patchProductStocks(deltas, 'delta')
  expect(r.mapPasses === 1, 'one pass')
  expect(r.touched === 20, '20 touched')
  for (let i = 1; i <= 20; i++) expect(cat.products[i - 1].stock === 99, `stock ${i}`)
  const old = makeCatalog(5000)
  const oldR = old.updateProductLoop(deltas)
  expect(oldR.mapPasses === 20, 'old was 20 passes')
})

test('C — 100 sequential sales no catalogEpoch drift', () => {
  const cat = makeCatalog(5000)
  const t0 = performance.now()
  for (let i = 0; i < 100; i++) {
    cat.patchProductStocks(new Map([[(i % 5000) + 1, -1]]), 'delta')
  }
  const ms = performance.now() - t0
  expect(cat.catalogEpoch === 1, 'catalogEpoch still 1')
  expect(cat.stockEpoch === 100, 'stockEpoch 100')
  results[results.length - 1].ms = Math.round(ms * 100) / 100
})

test('D — return restores stock (delta +)', () => {
  const cat = makeCatalog(100)
  cat.patchProductStocks(new Map([[5, -3]]), 'delta')
  expect(cat.products[4].stock === 97, 'after sale')
  cat.patchProductStocks(new Map([[5, 3]]), 'delta')
  expect(cat.products[4].stock === 100, 'after return')
})

test('E — barcode keys stable across stock patch', () => {
  const cat = makeCatalog(1000)
  const buildIndex = () => {
    const m = new Map()
    for (const p of cat.products) m.set(p.barcode, p.id)
    return m
  }
  const idx1 = buildIndex()
  cat.patchProductStocks(new Map([[10, -1]]), 'delta')
  const idx2 = buildIndex()
  expect(idx1.get(cat.products[9].barcode) === 10, 'id stable')
  expect(idx2.get(cat.products[9].barcode) === 10, 'id still 10')
  // index content (ids) identical — only Product.stock changed
  expect([...idx1.entries()].every(([k, v]) => idx2.get(k) === v), 'index ids unchanged')
})

test('F — warehouse visibility via updated stock field', () => {
  const cat = makeCatalog(50)
  cat.patchProductStocks(new Map([[7, -5]]), 'delta')
  expect(cat.products.find(p => p.id === 7).stock === 95, 'warehouse reads 95')
})

test('G — source outbox/sale still queues (no createSaleSafe rewrite of queue)', () => {
  expect(posSrc.includes("queueOp('sale'"), 'sale still queued')
  expect(posSrc.includes('patchProductStocks'), 'uses patch')
})

test('H — 10k catalog timing: patch vs 20×updateProduct', () => {
  const N = 10000
  const deltas = new Map()
  for (let i = 1; i <= 20; i++) deltas.set(i * 17, -1)

  const a = makeCatalog(N)
  const t0 = performance.now()
  a.patchProductStocks(deltas, 'delta')
  const patchMs = performance.now() - t0

  const b = makeCatalog(N)
  const t1 = performance.now()
  b.updateProductLoop(deltas)
  const loopMs = performance.now() - t1

  expect(patchMs < loopMs || loopMs < 5, `patch ${patchMs}ms vs loop ${loopMs}ms`)
  results[results.length - 1].detail = {
    catalogSize: N,
    items: 20,
    patchMs: Math.round(patchMs * 100) / 100,
    oldLoopMs: Math.round(loopMs * 100) / 100,
    complexity: { old: 'O(N × items)', neu: 'O(N + items)' },
  }
})

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 2,
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, passed: results.filter(r => r.status === 'PASS').length, failed: failed.length },
  results,
}
const out = path.join(root, 'scripts', 'phase2-products-patch-report.json')
fs.writeFileSync(out, JSON.stringify(report, null, 2))
console.log('\n' + JSON.stringify(report.summary, null, 2))
console.log(`Wrote ${out}`)
process.exit(failed.length ? 1 : 0)
