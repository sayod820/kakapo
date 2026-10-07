/**
 * K3-G1 focused guest tracking/review security test.
 * Uses a temporary JSON DATA_DIR only; it never receives DATABASE_URL.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { DEFAULT } from '../server/kakapo-api/db.js'
import {
  GUEST_TRACK_RATE_LIMIT,
  GUEST_REVIEW_RATE_LIMIT,
} from '../server/kakapo-api/storeGuestOrders.js'
import { matchRoutePolicy } from '../server/kakapo-api/routeAccessInventory.js'

const root = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'))
const apiDir = join(root, 'server', 'kakapo-api')
const ownPhone = '+992 90 123 45 67'
const foreignPhone = '+992 93 555 66 77'
const adminPassword = 'k3-guest-test-admin'

let passed = 0
let failed = 0

function expect(condition, label) {
  if (condition) {
    passed += 1
    console.log(`  OK  ${label}`)
  } else {
    failed += 1
    console.error(`  FAIL ${label}`)
  }
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init)
  let body = null
  try { body = await res.json() } catch { /* empty response */ }
  return { ok: res.ok, status: res.status, body }
}

async function waitHealth(base, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const res = await fetchJson(`${base}/health`)
      if (res.ok && res.body?.ok) return true
    } catch { /* server still booting */ }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  return false
}

async function startApi(dataDir) {
  const port = 19300 + Math.floor(Math.random() * 300)
  const child = spawn(process.execPath, ['index.js'], {
    cwd: apiDir,
    env: {
      ...process.env,
      // A non-empty whitespace value prevents local .env from being loaded as a DB URL;
      // pg/client trims it to disabled, so this process uses only the temporary JSON fixture.
      DATABASE_URL: ' ',
      DATA_DIR: dataDir,
      PORT: String(port),
      NODE_ENV: 'test',
      KAKAPO_AUTH_ENFORCE: '1',
      KAKAPO_O8_TEST_API: '1',
      KAKAPO_ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', data => { stderr += String(data) })
  const base = `http://127.0.0.1:${port}`
  if (!await waitHealth(base)) {
    try { child.kill('SIGKILL') } catch { /* best effort */ }
    throw new Error(`K3 test API did not start: ${stderr.slice(-1200)}`)
  }
  return { child, base }
}

async function stopApi(child) {
  if (!child || child.exitCode != null) return
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try { child.kill('SIGTERM') } catch { resolve() }
  })
}

function order(id, overrides = {}) {
  return {
    id,
    type: 'market',
    status: 'delivered',
    createdAtIso: '2026-10-07T10:00:00.000Z',
    deliveredAtIso: '2026-10-07T11:00:00.000Z',
    total: 25,
    goodsTotal: 20,
    deliveryFee: 5,
    payment_method: 'cash',
    pay: 'cash',
    comment: 'internal delivery note',
    distanceKm: 9,
    durationMin: 42,
    client: { name: 'Alice Customer', phone: ownPhone, addr: 'Private address', lat: 38.56, lng: 68.78 },
    courier: { name: 'Courier Secret', phone: '+992 91 000 00 00' },
    assembler: { name: 'Assembler Secret', id: 'A-1' },
    items: [{ name: 'Milk', e: '🥛', qty: 1, unit: 'pcs', grams: 1000, price: 20, product_id: 7, costPrice: 3, supplierName: 'Private supplier' }],
    ...overrides,
  }
}

function jsonHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', ...extra }
}

async function post(base, path, body, headers = {}) {
  return fetchJson(`${base}${path}`, {
    method: 'POST',
    headers: jsonHeaders(headers),
    body: JSON.stringify(body),
  })
}

const tempRoot = await mkdtemp(join(tmpdir(), 'kakapo-k3-g1-'))
const dataDir = join(tempRoot, 'data')
let api = null

try {
  const fixture = structuredClone(DEFAULT)
  fixture.users = [{ id: 1, login: 'admin', role: 'admin', name: 'Test Admin' }]
  fixture.restaurants = [{ id: 'R-1', name: 'Trusted Restaurant' }]
  fixture.orders = []
  for (let i = 1; i <= 21; i++) fixture.orders.push(order(`T-${String(i).padStart(2, '0')}`))
  fixture.orders.push(
    order('T-PENDING', { status: 'new' }),
    order('T-POS', { channel: 'pos', posSaleId: 'PS-1' }),
    order('T-FOREIGN', { client: { name: 'Foreign Customer', phone: foreignPhone, addr: 'Elsewhere' } }),
    order('T-REST', {
      type: 'restaurant',
      restId: 'R-1',
      restIds: ['R-1'],
      items: [{ name: 'Pilaf', qty: 1, unit: 'plate', price: 22, source: 'restaurant', restId: 'R-1' }],
    }),
    order('T-STAFF'),
  )
  await mkdir(dataDir, { recursive: true })
  await writeFile(join(dataDir, 'kakapo.json'), JSON.stringify(fixture), 'utf8')

  expect(matchRoutePolicy('POST', '/orders/track')?.access === 'PUBLIC_STORE', 'POST /orders/track explicitly PUBLIC_STORE')
  expect(matchRoutePolicy('GET', '/orders')?.access === 'STAFF', 'GET /orders remains STAFF')
  expect(matchRoutePolicy('GET', '/orders/T-01')?.access === 'STAFF', 'GET /orders/:id remains STAFF')
  expect(matchRoutePolicy('GET', '/orders/track')?.access === 'STAFF', 'GET /orders/track is not public')

  api = await startApi(dataDir)
  const { base } = api

  const tracked = await post(base, '/orders/track', { ids: ['T-01'], phone: ownPhone })
  expect(tracked.status === 200 && tracked.body?.length === 1 && tracked.body[0].id === 'T-01', 'anonymous POST tracks matching id + phone')
  const normalized = await post(base, '/orders/track', { ids: ['T-02'], phone: '901234567' })
  expect(normalized.status === 200 && normalized.body?.[0]?.id === 'T-02', 'Tajik phone formats normalize consistently')
  const wrongPhone = await post(base, '/orders/track', { ids: ['T-01'], phone: foreignPhone })
  expect(wrongPhone.status === 200 && Array.isArray(wrongPhone.body) && wrongPhone.body.length === 0, 'wrong phone discloses nothing')
  const unknown = await post(base, '/orders/track', { ids: ['T-UNKNOWN'], phone: ownPhone })
  expect(unknown.status === 200 && unknown.body?.length === 0, 'unknown id discloses nothing')
  const foreign = await post(base, '/orders/track', { ids: ['T-FOREIGN'], phone: ownPhone })
  expect(foreign.status === 200 && foreign.body?.length === 0, 'foreign order discloses nothing')
  const duplicate = await post(base, '/orders/track', { ids: ['T-03', 'T-03', 'T-03'], phone: ownPhone })
  expect(duplicate.status === 200 && duplicate.body?.length === 1, 'tracking ids are deduplicated')
  const cap = await post(base, '/orders/track', {
    ids: Array.from({ length: 21 }, (_, i) => `T-${String(i + 1).padStart(2, '0')}`),
    phone: ownPhone,
  })
  expect(cap.status === 200 && cap.body?.length === 20 && !cap.body.some(row => row.id === 'T-21'), 'tracking caps deduplicated ids at 20')
  const pos = await post(base, '/orders/track', { ids: ['T-POS'], phone: ownPhone })
  expect(pos.status === 200 && pos.body?.length === 0, 'POS-linked order is never guest tracked')
  const projectionText = JSON.stringify(tracked.body?.[0] || {})
  const privateValues = ['Alice Customer', ownPhone, 'Private address', 'Courier Secret', 'Assembler Secret', 'internal delivery note', 'Private supplier', 'costPrice', 'lat', 'lng', 'payment_method']
  expect(privateValues.every(value => !projectionText.includes(value)), 'guest tracking projection has no private/internal fields')

  const fullOrders = await fetchJson(`${base}/orders`)
  const fullOrder = await fetchJson(`${base}/orders/T-01`)
  const queryPhone = await fetchJson(`${base}/orders/track?phone=${encodeURIComponent(ownPhone)}`)
  expect(fullOrders.status === 401, 'anonymous GET /orders is protected')
  expect(fullOrder.status === 401, 'anonymous GET /orders/:id is protected')
  expect(queryPhone.status === 401, 'tracking has no public GET/query-phone route')

  await post(base, '/__o8/clear-auth-labs', {})
  let trackLimited = null
  for (let i = 0; i <= GUEST_TRACK_RATE_LIMIT.max; i++) {
    trackLimited = await post(base, '/orders/track', { ids: ['T-01'], phone: ownPhone }, { 'x-forwarded-for': '198.51.100.10' })
  }
  expect(trackLimited?.status === 429, 'guest tracking rate limit returns 429')

  const review = (body, headers = {}) => post(base, '/reviews', body, headers)
  const wrongReviewPhone = await review({ orderId: 'T-04', restId: 'STORE', phone: foreignPhone, rating: 5, text: 'x' })
  const unknownReview = await review({ orderId: 'T-UNKNOWN', restId: 'STORE', phone: ownPhone, rating: 5, text: 'x' })
  const pendingReview = await review({ orderId: 'T-PENDING', restId: 'STORE', phone: ownPhone, rating: 5, text: 'x' })
  const posReview = await review({ orderId: 'T-POS', restId: 'STORE', phone: ownPhone, rating: 5, text: 'x' })
  const unrelatedTarget = await review({ orderId: 'T-REST', restId: 'R-NOT-MINE', phone: ownPhone, rating: 5, text: 'x' })
  expect(wrongReviewPhone.status === 403, 'guest review rejects wrong phone')
  expect(unknownReview.status === 403, 'guest review rejects unknown order')
  expect(pendingReview.status === 403, 'guest review requires delivered order')
  expect(posReview.status === 403, 'guest review rejects POS-linked order')
  expect(unrelatedTarget.status === 403, 'guest review rejects unrelated restaurant target')

  const storeReview = await review({
    orderId: 'T-04', restId: 'STORE', phone: ownPhone, rating: 5, text: 'Great', client: 'Mallory', restName: 'Spoofed',
  })
  const restaurantReview = await review({ orderId: 'T-REST', restId: 'R-1', phone: ownPhone, rating: 4, text: 'Good food' })
  expect(storeReview.status === 200 && storeReview.body?.restId === 'STORE', 'valid delivered Store review is accepted')
  expect(restaurantReview.status === 200 && restaurantReview.body?.restId === 'R-1', 'valid represented restaurant review is accepted')
  expect(storeReview.body?.orderId === undefined && storeReview.body?.client === 'Customer', 'guest review response hides order linkage and identity')

  const login = await post(base, '/auth/login', { login: 'admin', password: adminPassword })
  expect(login.status === 200 && login.body?.access_token, 'admin login for staff review verification')
  const adminHeaders = { Authorization: `Bearer ${login.body?.access_token || ''}` }
  const staffReviews = await fetchJson(`${base}/reviews`, { headers: adminHeaders })
  const storedStoreReview = (staffReviews.body || []).find(row => row.orderId === 'T-04' && row.restId === 'STORE')
  expect(staffReviews.status === 200 && storedStoreReview?.orderId === 'T-04', 'staff review response retains order workflow fields')
  expect(storedStoreReview?.client === 'Alice Customer' && storedStoreReview?.client !== 'Mallory', 'caller identity spoofing is ignored')
  expect(!Object.prototype.hasOwnProperty.call(storedStoreReview || {}, 'phone'), 'ownership phone is never persisted in review')
  const staffCreate = await review({ orderId: 'T-STAFF', restId: 'STORE', rating: 5, text: 'Back office', client: 'Staff Curated' }, adminHeaders)
  expect(staffCreate.status === 200 && staffCreate.body?.orderId === 'T-STAFF' && staffCreate.body?.client === 'Staff Curated', 'staff review workflow remains full and ungated')
  const publicReviews = await fetchJson(`${base}/reviews`)
  expect(publicReviews.status === 200 && (publicReviews.body || []).every(row => row.orderId === undefined && row.client === 'Customer'), 'public review serialization hides order ids and customer identity')

  await post(base, '/__o8/clear-auth-labs', {})
  let reviewLimited = null
  for (let i = 0; i <= GUEST_REVIEW_RATE_LIMIT.max; i++) {
    reviewLimited = await review({ orderId: 'T-UNKNOWN', restId: 'STORE', phone: ownPhone, rating: 5, text: 'x' }, { 'x-forwarded-for': '198.51.100.11' })
  }
  expect(reviewLimited?.status === 429, 'guest review rate limit returns 429')
} finally {
  await stopApi(api?.child)
  await rm(tempRoot, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
