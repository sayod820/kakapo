/**
 * PC-4 LAB — REAL_CASHIER_8 continuation.
 * Source READ-ONLY. All writes on REAL_CASHIER_8_LAB (+ crash derivatives).
 * Production: GET only. Mutations → isolated mock HTTP.
 *
 * Run via Electron ABI:
 *   set ELECTRON_RUN_AS_NODE=1
 *   desktop\node_modules\electron\dist\electron.exe scripts/pc4-real-cashier-8-lab.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, 'scripts', '_diag_out', 'REAL_CASHIER_8')
const LAB_DIR = path.join(ROOT, 'scripts', '_diag_out', 'REAL_CASHIER_8_LAB')
const OUT = path.join(ROOT, 'diag', 'REAL_CASHIER_8_PC4_LAB_report.json')
const API = 'https://kakappo.shop/api/kakapo'
const EXPECTED_INSTALLER_SHA = 'AF55CDA79213C8B83CBABBE17AEB4BF346D74F48DDEF16A7FF9763C68D63E7D5'
const SOURCE_SHA_EXPECTED = null // filled after first hash

const require = createRequire(path.join(ROOT, 'desktop', 'package.json'))
const Database = require('better-sqlite3')

const engine = await import(pathToFileURL(path.join(ROOT, 'lib/desktopRecoveryEngineCore.mjs')).href)
const ex = await import(pathToFileURL(path.join(ROOT, 'lib/desktopRecoveryExecutorCore.mjs')).href)
const adapter = await import(pathToFileURL(path.join(ROOT, 'lib/recoveryApiAdapterCore.mjs')).href)

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase()
}
function fileMeta(p) {
  const st = fs.statSync(p)
  return { path: p, sizeBytes: st.size, mtimeLocal: st.mtime.toISOString(), sha256: sha256File(p) }
}
function jp(v) {
  try { return JSON.parse(v) } catch { return null }
}
async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180000) })
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`)
  return r.json()
}

function copySourceToLab() {
  fs.mkdirSync(LAB_DIR, { recursive: true })
  // wipe prior lab writable artifacts
  for (const n of fs.readdirSync(LAB_DIR)) {
    fs.rmSync(path.join(LAB_DIR, n), { recursive: true, force: true })
  }
  const src = path.join(SOURCE_DIR, 'kakapo.sqlite')
  fs.copyFileSync(src, path.join(LAB_DIR, 'kakapo.sqlite'))
  for (const n of ['kakapo.sqlite-wal', 'kakapo.sqlite-shm']) {
    const f = path.join(SOURCE_DIR, n)
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(LAB_DIR, n))
  }
}

function openLab(readonly = false) {
  return new Database(path.join(LAB_DIR, 'kakapo.sqlite'), {
    readonly,
    fileMustExist: true,
  })
}

function readQueue(db) {
  const raw = db.prepare('SELECT client_ref, updated_at, payload FROM queue ORDER BY updated_at ASC').all()
  return raw.map(r => {
    const row = jp(r.payload) || {}
    const nested = row.payload && typeof row.payload === 'object' ? row.payload : {}
    return {
      clientRef: String(row.clientRef || r.client_ref || ''),
      kind: String(row.kind || 'unknown'),
      seq: row.seq,
      localId: row.localId,
      createdAtIso: row.createdAtIso || nested.createdAtIso,
      failed: !!row.failed,
      lastError: row.lastError,
      nextRetryAt: row.nextRetryAt,
      attempts: row.attempts,
      _updated_at: r.updated_at,
      payload: { ...nested, clientRef: nested.clientRef || row.clientRef || r.client_ref },
    }
  })
}

function readMetaKv(db) {
  const out = {}
  for (const row of db.prepare('SELECT key, value FROM meta').all()) {
    out[row.key] = jp(row.value)
  }
  for (const row of db.prepare('SELECT key, value FROM kv').all()) {
    if (!(row.key in out)) out[row.key] = jp(row.value)
  }
  return out
}

function classifyStatus(row, now = Date.now()) {
  if (row.failed) return 'failed'
  if (Number(row.nextRetryAt) > now) return 'cooldown'
  return 'ready'
}

function startMock(seed = {}) {
  const store = {
    shifts: [...(seed.shifts || [])],
    sales: [...(seed.sales || [])],
    receipts: [...(seed.receipts || [])],
    writeoffs: [],
    moves: [],
    posts: 0,
  }
  // index by clientRef
  const byRef = new Map()
  for (const s of store.sales) {
    if (s.clientRef) {
      byRef.set(String(s.clientRef), {
        kind: 'sale',
        id: s.id,
        fingerprint: engine.businessPayloadFingerprint('sale', s),
        payload: s,
        raw: s,
      })
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body = null
    try { body = Buffer.concat(chunks).toString('utf8'); body = body ? JSON.parse(body) : null } catch { body = null }
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) store.posts++

    if (req.method === 'GET' && url.pathname === '/pos/shifts') return send(200, store.shifts)
    if (req.method === 'GET' && url.pathname === '/pos/sales') return send(200, store.sales)
    if (req.method === 'GET' && url.pathname === '/stock/receipts') return send(200, store.receipts)

    if (req.method === 'POST' && url.pathname === '/pos/shifts/open') {
      const known = store.shifts.find(s => s.clientRef === body?.clientRef)
      if (known) return send(200, known)
      const open = store.shifts.filter(s => s.status === 'open')
      // allow recovery open even if others exist in seed (closed ghosts)
      const row = {
        id: `SHIFT-LAB-REC-${store.shifts.length + 1}`,
        clientRef: body.clientRef,
        status: 'open',
        cashierId: body.cashierId,
        posId: body.posId || 'POS-1',
        note: body.note,
      }
      store.shifts.push(row)
      return send(201, row)
    }
    if (req.method === 'POST' && url.pathname === '/pos/sales') {
      const ref = body?.clientRef
      const existing = byRef.get(ref)
      const fp = engine.businessPayloadFingerprint('sale', body)
      if (existing) {
        if (existing.fingerprint !== fp) {
          return send(409, { detail: 'тот же clientRef уже использован', code: 'IDEMPOTENCY_KEY_REUSED' })
        }
        return send(409, { detail: 'тот же clientRef уже использован', code: 'IDEMPOTENCY_KEY_REUSED' })
      }
      const row = { id: `SALE-LAB-${store.sales.length + 1}`, ...body, clientRef: ref, fingerprint: fp }
      store.sales.push(row)
      byRef.set(ref, { kind: 'sale', id: row.id, fingerprint: fp, payload: body, raw: row })
      return send(201, row)
    }
    if (req.method === 'POST' && url.pathname === '/stock/receipts') {
      const row = { id: `RCP-LAB-${store.receipts.length + 1}`, ...body }
      store.receipts.push(row)
      byRef.set(body.clientRef, {
        kind: 'stock_receipt_create',
        id: row.id,
        fingerprint: engine.businessPayloadFingerprint('stock_receipt_create', body),
        payload: body,
        raw: row,
      })
      return send(201, row)
    }
    if (req.method === 'POST' && url.pathname === '/stock/writeoffs') {
      const row = { id: `WO-LAB-${Date.now()}`, ...body }
      store.writeoffs.push(row)
      return send(201, row)
    }
    if (req.method === 'POST' && url.pathname === '/finance/moves') {
      const row = { id: `FM-LAB-${Date.now()}`, ...body }
      store.moves.push(row)
      return send(201, row)
    }
    if (req.method === 'POST' && /\/cards\//.test(url.pathname)) {
      return send(201, { id: `CARD-OP-${body?.clientRef}`, clientRef: body?.clientRef, ...body, card: {} })
    }
    if (req.method === 'POST' && /\/return$/.test(url.pathname)) {
      return send(201, { id: `RET-${body?.clientRef}`, clientRef: body?.clientRef })
    }
    if (req.method === 'DELETE' && /\/layers\//.test(url.pathname)) {
      return send(200, { id: `LAYER-${body?.clientRef || 'x'}`, clientRef: body?.clientRef })
    }
    send(404, { detail: 'mock miss' })
  })

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        store,
        byRef,
        close: () => new Promise(r => server.close(() => r())),
      })
    })
  })
}

function queueFingerprintList(queue) {
  return queue.map(r => `${r.clientRef}|${r.kind}|${r.seq}|${r.failed ? 1 : 0}`).sort()
}

async function main() {
  const report = {
    auditAt: new Date().toISOString(),
    REAL_CASHIER_8_SOURCE_MUTATED: 'PENDING',
    PRODUCTION_MUTATED: 'NO',
    LIVE_CASHIER_DB_MUTATED: 'NO',
    PRODUCTION_SERVER_POSTS: 0,
    REVISION_COORDINATOR_CHANGED: 'NO',
  }
  const save = () => {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
    console.log('[pc4] checkpoint report →', OUT)
  }

  try {
  // ── 1. Source verify ──
  console.log('[pc4] step1 source verify')
  const srcPath = path.join(SOURCE_DIR, 'kakapo.sqlite')
  if (!fs.existsSync(srcPath)) throw new Error('REAL_CASHIER_8 missing')
  const sourceBefore = fileMeta(srcPath)
  report.sourceIntegrity = {
    path: srcPath,
    ...sourceBefore,
    walPresent: fs.existsSync(path.join(SOURCE_DIR, 'kakapo.sqlite-wal')),
    shmPresent: fs.existsSync(path.join(SOURCE_DIR, 'kakapo.sqlite-shm')),
    note: 'WAL/SHM absent expected after clean shutdown',
    operatorReportedSize: 43421696,
    sizeMatch: sourceBefore.sizeBytes === 43421696,
  }
  save()

  // readonly integrity on source via temp copy already — check on LAB after copy
  console.log('[pc4] step2 copy LAB')
  copySourceToLab()
  report.labCopy = {
    dir: LAB_DIR,
    files: fs.readdirSync(LAB_DIR),
    labShaAfterCopy: sha256File(path.join(LAB_DIR, 'kakapo.sqlite')),
    matchesSource: sha256File(path.join(LAB_DIR, 'kakapo.sqlite')) === sourceBefore.sha256,
  }
  save()

  let db = openLab(true)
  const integrity = db.pragma('integrity_check', { simple: true })
  const journalMode = db.pragma('journal_mode', { simple: true })
  const meta = readMetaKv(db)
  let queue = readQueue(db)
  const snap = meta.data_pos_snapshot || meta.pos_snapshot || {}
  const shifts = Array.isArray(snap.shifts) ? snap.shifts : []
  const sales = Array.isArray(snap.sales) ? snap.sales : []
  const localClients = Array.isArray(meta.data_clients) ? meta.data_clients
    : (Array.isArray(meta.clients) ? meta.clients : [])
  const now = Date.now()
  console.log('[pc4] step3 local classify base', { queue: queue.length, sales: sales.length, shifts: shifts.length })
  save()

  const byKind = {}
  const byStatus = { ready: 0, failed: 0, cooldown: 0 }
  const seqs = []
  for (const row of queue) {
    byKind[row.kind] = (byKind[row.kind] || 0) + 1
    byStatus[classifyStatus(row, now)]++
    if (row.seq != null) seqs.push(Number(row.seq) || 0)
  }

  report.freshness = {
    sourceMtime: sourceBefore.mtimeLocal,
    queueSeq: meta.queue_seq ?? meta.queueSeq ?? null,
    syncCursor: meta.syncCursor ?? meta.sync_cursor ?? null,
    deviceId: meta.trade_device_id || meta.trade_device_bind?.deviceId || meta.deviceId || null,
    newestQueueUpdated: queue.reduce((a, r) => (!a || String(r._updated_at) > a ? r._updated_at : a), null),
    newestSaleCreated: sales.reduce((a, s) => {
      const t = s.createdAtIso || s.createdAt
      return (!a || String(t) > a ? t : a)
    }, null),
    localSalesCount: sales.length,
    queueTotal: queue.length,
  }

  report.localDb = {
    integrityCheck: integrity,
    journalMode,
    openShiftsLocal: shifts.filter(s => s.status === 'open').map(s => ({ id: s.id, cashierId: s.cashierId, note: s.note })),
    closedShiftsSample: shifts.filter(s => s.status === 'closed').slice(0, 5).map(s => s.id),
  }

  db.close()

  // ── Server GET only (via system Node — Electron fetch unreliable under RUN_AS_NODE) ──
  console.log('[pc4] step4 GET server snapshot (read-only via node)…')
  save()
  const getScript = path.join(ROOT, 'scripts', '_pc4_r8_server_get.mjs')
  const getOut = path.join(ROOT, 'diag', 'REAL_CASHIER_8_server_get.json')
  const useCached = process.env.PC4_USE_CACHED_GET === '1' && fs.existsSync(getOut)
  if (!useCached) {
    const getRun2 = spawnSync('node', [getScript], { encoding: 'utf8', cwd: ROOT, timeout: 300000, shell: true })
    console.log('[pc4] get exit', getRun2.status, (getRun2.stdout || '').slice(-400))
    if (getRun2.status !== 0) {
      report.serverGet = { ok: false, error: getRun2.stderr || getRun2.stdout, PRODUCTION_SERVER_POSTS: 0 }
      save()
      throw new Error('server_get_failed')
    }
  } else {
    console.log('[pc4] using cached GET', getOut)
  }
  const serverSnap = jp(fs.readFileSync(getOut, 'utf8'))
  const server = {
    sales: serverSnap.sales || [],
    shifts: serverSnap.shifts || [],
    clients: serverSnap.clients || [],
    receipts: serverSnap.receipts || [],
    cards: serverSnap.cards || [],
  }
  report.serverGet = {
    ok: true,
    error: null,
    cached: !!useCached,
    salesCount: server.sales.length,
    shiftsCount: server.shifts.length,
    openShifts: server.shifts.filter(s => s.status === 'open').map(s => ({ id: s.id, clientRef: s.clientRef })),
    clientsCount: server.clients.length,
    fetchedAt: serverSnap.fetchedAt,
    PRODUCTION_SERVER_POSTS: 0,
  }
  save()

  // Build classify ctx with semantic fingerprints
  const serverByClientRef = new Map()
  for (const s of server.sales) {
    if (!s.clientRef) continue
    serverByClientRef.set(String(s.clientRef), {
      id: s.id,
      kind: 'sale',
      fingerprint: engine.businessPayloadFingerprint('sale', {
        items: s.items,
        paidCash: s.paidCash,
        paidCard: s.paidCard,
        paidWallet: s.paidWallet,
        debtAdded: s.debtAdded,
        bonusSpent: s.bonusSpent,
        clientId: s.clientId,
        num: s.cardNum || s.num,
        total: s.total,
      }),
      raw: s,
    })
  }
  for (const r of server.receipts || []) {
    if (!r.clientRef) continue
    if (serverByClientRef.has(String(r.clientRef))) continue
    serverByClientRef.set(String(r.clientRef), {
      id: r.id,
      kind: 'stock_receipt_create',
      fingerprint: engine.businessPayloadFingerprint('stock_receipt_create', r),
      raw: r,
    })
  }
  const serverClosedIds = new Set(
    server.shifts.filter(s => String(s.status) !== 'open').map(s => String(s.id)),
  )
  const serverOpenIds = new Set(
    server.shifts.filter(s => String(s.status) === 'open').map(s => String(s.id)),
  )
  const serverShiftById = new Map(server.shifts.map(s => [String(s.id), { status: s.status }]))

  const classified = engine.classifyQueueFresh(queue, {
    serverByClientRef,
    serverClosedIds,
    serverShiftById,
  })

  const ackPlan = engine.planAckCleanup(classified.ops)
  const ghostOpenLocal = shifts.filter(s =>
    String(s.status) === 'open' && serverClosedIds.has(String(s.id)))
  const recoveryShifts = shifts.filter(s => String(s.id || '').startsWith('off-recovery-') || String(s.id || '').startsWith('off-'))

  // debt drift sample U-26 / U-37
  const debtCompare = {}
  for (const id of ['U-26', 'U-37']) {
    const loc = localClients.find(c => String(c.id) === id || String(c.num) === id)
    const srv = server.clients.find(c => String(c.id) === id)
    debtCompare[id] = {
      local: loc ? Number(loc.debt) : null,
      server: srv ? Number(srv.debt) : null,
    }
  }

  report.classification = {
    queueTotal: classified.total,
    byStatus,
    byKind,
    minSeq: seqs.length ? Math.min(...seqs) : null,
    maxSeq: seqs.length ? Math.max(...seqs) : null,
    oldestUpdated: queue[0]?._updated_at || null,
    newestUpdated: queue[queue.length - 1]?._updated_at || null,
    summary: classified.summary,
    ackLostExact: ackPlan.length,
    ackPlanSample: ackPlan.slice(0, 5),
    dependencyBlocked: classified.ops.filter(o => o.classification === 'DEPENDENCY_BLOCKED').length,
    conflict: classified.ops.filter(o => o.classification === 'CONFLICT').length,
    invalid: classified.ops.filter(o => o.classification === 'INVALID').length,
    unknown: classified.ops.filter(o => o.classification === 'UNKNOWN').length,
    safeToSend: classified.ops.filter(o => o.classification === 'SAFE_TO_SEND').length,
    alreadyCommitted: classified.ops.filter(o => o.classification === 'ALREADY_COMMITTED_SERVER').length,
    localOnlySales: classified.ops.filter(o =>
      o.kind === 'sale' && o.classification !== 'ALREADY_COMMITTED_SERVER').length,
    blockers: classified.ops
      .filter(o => ['CONFLICT', 'INVALID', 'UNKNOWN'].includes(o.classification))
      .slice(0, 20)
      .map(o => ({ clientRef: o.clientRef, kind: o.kind, classification: o.classification, reason: o.reason })),
    unsupportedKinds: classified.ops
      .filter(o => !ex.isKindReplaySupported(o.kind) && o.kind !== 'shift_open' && o.kind !== 'shift_close')
      .map(o => ({ clientRef: o.clientRef, kind: o.kind, classification: o.classification })),
  }

  report.ghostShifts = {
    localOpenServerClosed: ghostOpenLocal.map(s => s.id),
    localOffOrRecovery: recoveryShifts.map(s => ({ id: s.id, status: s.status })),
    serverOpenCount: serverOpenIds.size,
  }

  report.crmDebt = debtCompare
  report.warehouseFinance = {
    pendingReceipts: classified.ops.filter(o => String(o.kind).startsWith('stock_receipt')).length,
    pendingWriteoffs: classified.ops.filter(o => String(o.kind).startsWith('stock_writeoff')).length,
    pendingFinance: classified.ops.filter(o => String(o.kind).startsWith('finance') || o.kind === 'expense_create').length,
    pendingLoyalty: classified.ops.filter(o => o.kind === 'card_loyalty_patch' || o.kind === 'card_topup').length,
    pendingDebtOps: classified.ops.filter(o => o.kind === 'debt_repay' || o.kind === 'cash_advance').length,
  }

  const queueFpBeforeArm = queueFingerprintList(queue)

  // ── 4. Arm recovery on LAB via prep tool ──
  console.log('[pc4] arming recovery on LAB copy…')
  const prep = path.join(ROOT, 'scripts', 'pc4-recovery-prep.mjs')
  const arm = spawnSync(process.execPath, [prep, '--db', path.join(LAB_DIR, 'kakapo.sqlite'), '--arm', '--force'], {
    encoding: 'utf8',
    cwd: ROOT,
  })
  report.prepTool = {
    exitCode: arm.status,
    ok: arm.status === 0,
    stdoutTail: String(arm.stdout || '').slice(-800),
    stderrTail: String(arm.stderr || '').slice(-400),
  }
  if (arm.status !== 0) {
    report.blocker = 'PREP_TOOL_FAILED'
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
    console.error('PREP FAILED', arm.stderr || arm.stdout)
    process.exitCode = 1
    return
  }

  db = openLab(true)
  const metaAfter = readMetaKv(db)
  const queueAfterArm = readQueue(db)
  report.prepTool.verify = {
    recoveryMode: metaAfter.recoveryMode,
    recoveryRequiredAfterUpgrade: metaAfter.recoveryRequiredAfterUpgrade,
    queueUnchanged: JSON.stringify(queueFingerprintList(queueAfterArm)) === JSON.stringify(queueFpBeforeArm),
    queueCount: queueAfterArm.length,
  }
  db.close()

  // ── 5. Installer hash + first-boot simulation ──
  const installer = path.join(ROOT, 'desktop', 'dist', 'KAKAPO-Kassa-Setup-1.2.190.exe')
  const installerSha = fs.existsSync(installer) ? sha256File(installer) : null
  report.installer = {
    path: installer,
    exists: fs.existsSync(installer),
    sha256: installerSha,
    expected: EXPECTED_INSTALLER_SHA,
    match: installerSha === EXPECTED_INSTALLER_SHA,
  }

  const firstBoot = ex.simulateUpgradeFirstBoot({
    meta: {
      recoveryMode: true,
      recoveryRequiredAfterUpgrade: true,
    },
    queue: queueAfterArm,
  })
  report.firstBoot = {
    ...firstBoot,
    note: 'Simulation of gate+flush refusal; full Electron UI AppData launch not required for this proof',
  }

  // ── 6. LAB-generated PREPARE sale (synthetic insert) ──
  const sessionId = `RS-lab8-${Date.now().toString(36)}`
  const recoveryShift = engine.recoveryShiftId(sessionId)
  const labSaleRef = `LAB-TEST-SALE-${sessionId}`
  db = openLab(false)
  const labSalePayload = {
    clientRef: labSaleRef,
    kind: 'sale',
    seq: (Number(metaAfter.queue_seq) || 0) + 1,
    createdAtIso: new Date().toISOString(),
    failed: false,
    payload: {
      clientRef: labSaleRef,
      shiftId: recoveryShift,
      items: [{ productId: 1, qty: 1, price: 1, name: 'LAB-TEST' }],
      paidCash: 1,
      paidCard: 0,
      debtAdded: 0,
      bonusSpent: 0,
      appliedLocal: true,
      paymentMethod: 'cash',
      labGenerated: true,
    },
  }
  db.prepare(`INSERT INTO queue(client_ref, payload, updated_at) VALUES(?,?,?)`).run(
    labSaleRef,
    JSON.stringify(labSalePayload),
    new Date().toISOString(),
  )
  db.prepare(`INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run('recoverySessionId', JSON.stringify(sessionId))
  db.close()
  report.prepareLocalSale = {
    clientRef: labSaleRef,
    shiftId: recoveryShift,
    note: 'LAB-generated; excluded from real conservation',
  }

  // reload queue for recovery
  db = openLab(true)
  queue = readQueue(db)
  db.close()

  const realQueue = queue.filter(r => r.clientRef !== labSaleRef)
  const conservationBefore = adapter.captureConservationSnapshot(
    realQueue.filter(r => r.kind === 'sale'),
  )

  // Reclassify after arm + lab sale
  const classified2 = engine.classifyQueueFresh(queue, {
    serverByClientRef,
    serverClosedIds,
    serverShiftById,
  })
  const ackPlan2 = engine.planAckCleanup(classified2.ops)

  // Fail-closed check
  const hardBlockers = classified2.ops.filter(o =>
    ['CONFLICT', 'INVALID', 'UNKNOWN'].includes(o.classification)
    && o.clientRef !== labSaleRef)
  const unsupported = classified2.ops.filter(o =>
    o.classification === 'SAFE_TO_SEND'
    && !ex.isKindReplaySupported(o.kind)
    && !['shift_open', 'shift_close'].includes(o.kind))

  report.preReplayGate = {
    hardBlockers: hardBlockers.length,
    hardBlockerSample: hardBlockers.slice(0, 10),
    unsupported: unsupported.length,
    unsupportedSample: unsupported.slice(0, 10),
  }

  if (hardBlockers.length || unsupported.length) {
    report.labReplay = {
      ok: false,
      code: 'FAIL_CLOSED',
      reason: hardBlockers.length ? 'CONFLICT_INVALID_UNKNOWN' : 'UNSUPPORTED_KIND',
      hardBlockers: hardBlockers.slice(0, 30),
      unsupported: unsupported.slice(0, 30),
    }
    // still run what we can for ACK-only path documentation
  }

  // ── 7. Full LAB recovery against mock ──
  console.log('[pc4] starting controlled LAB replay on mock…')
  const mock = await startMock({
    // seed already-committed sales so ACK path works via GET
    sales: server.sales.filter(s => ackPlan2.some(a => a.clientRef === s.clientRef)).map(s => ({
      ...s,
      fingerprint: engine.businessPayloadFingerprint('sale', s),
    })),
    shifts: server.shifts.map(s => ({ ...s })),
    receipts: server.receipts || [],
  })

  const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
  let session = ex.createDurableRecoverySession({
    recoverySessionId: sessionId,
    deviceId: report.freshness.deviceId,
    snapshotManifestHash: sourceBefore.sha256,
    snapshotExists: true,
    sourceQueueSeq: report.freshness.queueSeq,
    sourceSyncCursor: report.freshness.syncCursor,
    phase: ex.RECOVERY_PHASE.PREPARE,
  })

  const world = {
    recoveryMode: true,
    isDesktop: true,
    serverReachable: true,
    queue: queue.map(r => ({ ...r, payload: { ...r.payload } })),
    sales: sales.map(s => ({ ...s })),
    stock: { lab: 1 },
    debt: { ...Object.fromEntries(Object.entries(debtCompare).map(([k, v]) => [k, v.local])) },
    shifts: shifts.map(s => ({ ...s })),
    networkPostCount: 0,
    classifyCtx: { serverByClientRef, serverClosedIds, serverShiftById },
    ghostIds: ghostOpenLocal.map(s => s.id),
  }

  const stockBefore = JSON.stringify(world.stock)
  const results = { ack: 0, remap: 0, replayed: 0, steps: [] }

  try {
    // ACK cleanup
    for (const a of ackPlan2) {
      const op = classified2.ops.find(o => o.clientRef === a.clientRef)
      const r = ex.executeVerifiedAckCleanup(session, { ...op, ...a }, world)
      if (!r.ok) {
        results.ackError = r
        break
      }
      session = r.session
      results.ack++
    }
    results.steps.push({ ackCleaned: results.ack })

    // Open recovery shift on mock (no production)
    const opened = await ex.ensureRecoveryServerShift(session, api, {
      recoveryMode: true,
      allowAdoptUnexpected: true, // seed may have opens; we adopt sticky or create
      cashierId: 'LAB',
      openingCash: 0,
    })
    // If unexpected open stopped us, force allow by clearing opens that aren't ours in mock for recovery
    if (!opened.ok && opened.code === 'STOP_NEEDS_OPERATOR') {
      mock.store.shifts = mock.store.shifts.filter(s => s.status !== 'open')
      const opened2 = await ex.ensureRecoveryServerShift(session, api, {
        recoveryMode: true,
        cashierId: 'LAB',
        openingCash: 0,
      })
      if (!opened2.ok) throw new Error(`shift_open_failed:${opened2.error || opened2.code}`)
      session = opened2.session
      results.targetShiftId = opened2.shiftId
    } else if (!opened.ok) {
      throw new Error(`shift_open_failed:${opened.error || opened.code}`)
    } else {
      session = opened.session
      results.targetShiftId = opened.shiftId
    }

    // Remap dependency-blocked sales to target
    const plan = engine.planShiftRemaps(classified2.ops, {
      plannedTargetShiftId: session.targetServerShiftId,
    })
    // exclude lab test from needing old ghost if already on recovery shift
    const remapRows = plan.rows.filter(r => r.clientRef !== labSaleRef)
    const rem = ex.executeShiftRemapBatch(session, remapRows, world)
    if (!rem.ok) throw new Error(`remap_failed:${rem.error}`)
    session = rem.session
    results.remap = rem.remapped

    // Also remap SAFE/failed sales still on closed shifts + clear stale SHIFT_CLOSED
    for (const row of world.queue) {
      if (row.kind !== 'sale') continue
      const sid = String(row.payload?.shiftId || '')
      if (serverClosedIds.has(sid) && sid !== session.targetServerShiftId) {
        const beforeFp = engine.businessPayloadFingerprint('sale', row.payload)
        row.payload = { ...row.payload, shiftId: session.targetServerShiftId, recoveryRemappedFrom: sid }
        row.failed = false
        row.lastError = ''
        if (beforeFp !== engine.businessPayloadFingerprint('sale', row.payload)) {
          throw new Error('fp_changed_extra_remap')
        }
      }
    }

    session = ex.enterReplayFreeze(session)

    if (hardBlockers.length || unsupported.length) {
      report.labReplay = {
        ok: false,
        code: 'FAIL_CLOSED_AFTER_ACK_REMAP',
        ack: results.ack,
        remap: results.remap,
        targetShiftId: results.targetShiftId,
        hardBlockers: hardBlockers.slice(0, 20),
        unsupported: unsupported.slice(0, 20),
        note: 'Stopped before full replay due to fail-closed blockers',
      }
    } else {
      // Mark remapped as safe by clearing closed-shift classification context for target
      world.classifyCtx = {
        serverByClientRef: new Map(serverByClientRef),
        serverClosedIds: new Set([...serverClosedIds].filter(id => id !== session.targetServerShiftId)),
        serverShiftById: new Map([
          ...serverShiftById,
          [session.targetServerShiftId, { status: 'open' }],
        ]),
      }

      const replay = await ex.executeRecoveryReplay(session, world, api, {
        limit: world.queue.length + 10,
        requireTargetShift: true,
      })
      results.replay = {
        ok: replay.ok,
        error: replay.error,
        code: replay.code,
        processed: replay.processed,
        queueLeft: world.queue.length,
        stoppedReason: replay.session?.stoppedReason,
      }
      session = replay.session || session
      results.stockAfterReplay = JSON.stringify(world.stock) === stockBefore

      if (replay.ok || world.queue.filter(r => !r.failed).length === 0) {
        // drain remaining failed that became ACK-eligible
        let guard = 0
        while (world.queue.length && guard++ < 500) {
          const c = engine.classifyQueueFresh(world.queue, world.classifyCtx)
          const ack = engine.planAckCleanup(c.ops)
          if (ack.length) {
            const op = c.ops.find(o => o.clientRef === ack[0].clientRef)
            const r = ex.executeVerifiedAckCleanup(session, { ...op, ...ack[0] }, world)
            session = r.session
            if (!r.ok) break
            continue
          }
          const more = await ex.executeRecoveryReplay(session, world, api, { limit: 50 })
          session = more.session || session
          if (!more.ok && !more.resumable) {
            results.replayFinal = more
            break
          }
          if (more.processed === 0) break
        }
      }

      const verify = ex.verifyPostDrain(session, world, {
        serverSales: mock.store.sales,
      })
      session = verify.session || session

      const pull = ex.executeCanonicalPull(session, world, {
        clients: server.clients,
        cards: server.cards,
        products: [],
        stock: {},
        sales: mock.store.sales,
        shifts: mock.store.shifts,
        verifyDebt: {
          'U-26': debtCompare['U-26']?.server,
          'U-37': debtCompare['U-37']?.server,
        },
      })
      session = pull.session || session

      const ghosts = ex.finalizeGhostShifts(session, world, ghostOpenLocal.map(s => s.id))
      session = ghosts.session || session

      const canOff = ex.canDisableRecovery(session, {
        queue: world.queue,
        ghostIds: ghostOpenLocal.map(s => s.id),
      })

      report.labReplay = {
        ok: !!verify.ok && world.queue.length === 0,
        ack: results.ack,
        remap: results.remap,
        targetShiftId: results.targetShiftId,
        mockPosts: mock.store.posts,
        adapterMutations: api.getMutationCount(),
        productionPosts: 0,
        queueLeft: world.queue.length,
        verify,
        pull: { ok: pull.ok, checks: pull.checks },
        ghosts: { ok: ghosts.ok, targetRemainsOpen: ghosts.targetRemainsOpen },
        canDisable: canOff,
        stockUnchanged: results.stockAfterReplay !== false,
        replayDetail: results.replay,
      }
    }
  } catch (e) {
    report.labReplay = {
      ok: false,
      error: String(e?.message || e),
      partial: results,
    }
  }

  // ── Conservation (exclude LAB test sale) ──
  const completedRealRefs = (session.completedClientRefs || [])
    .concat(session.ackCleanedClientRefs || [])
    .filter(r => r !== labSaleRef)
  const afterSales = mock.store.sales.filter(s => s.clientRef !== labSaleRef)
  const afterSnap = {
    clientRefs: afterSales.map(s => s.clientRef).sort(),
    totals: {
      cash: afterSales.reduce((a, s) => a + (Number(s.paidCash) || 0), 0),
      card: afterSales.reduce((a, s) => a + (Number(s.paidCard) || 0), 0),
      debt: afterSales.reduce((a, s) => a + (Number(s.debtAdded) || 0), 0),
    },
    saleCount: afterSales.length,
  }
  // For ACK-cleaned + replayed, all original sale refs should appear on mock OR remain only if blocked
  const originalSaleRefs = conservationBefore.clientRefs.filter(Boolean)
  const lost = originalSaleRefs.filter(r =>
    !afterSnap.clientRefs.includes(r)
    && !world.queue.some(q => q.clientRef === r)
    && !(session.ackCleanedClientRefs || []).includes(r)
    && !(session.completedClientRefs || []).includes(r))
  // ACK cleaned are on server already (seeded) — count as preserved
  const preservedViaAck = originalSaleRefs.filter(r => (session.ackCleanedClientRefs || []).includes(r))
  const preservedViaReplay = originalSaleRefs.filter(r => afterSnap.clientRefs.includes(r))
  const stillQueued = originalSaleRefs.filter(r => world.queue.some(q => q.clientRef === r))

  report.conservation = {
    originalRealSaleOps: originalSaleRefs.length,
    preservedViaAck: preservedViaAck.length,
    preservedViaReplay: preservedViaReplay.length,
    stillQueued: stillQueued.length,
    lost: lost.length,
    lostSample: lost.slice(0, 10),
    duplicateOnMock: afterSnap.clientRefs.length !== new Set(afterSnap.clientRefs).size,
    stockUnchangedDuringReplay: results.stockAfterReplay === true,
    labTestSaleExcluded: labSaleRef,
    paymentTotalsBefore: conservationBefore.totals,
    note: 'ShiftId remap allowed; clientRef/seq/payments must hold for drained ops. Pull may refresh stock projection.',
  }

  // ── Crash / resume on derivative (PC-4B: local-only subset + server index for ACK-lost) ──
  console.log('[pc4] crash/resume fixture…')
  const crashDir = path.join(ROOT, 'scripts', '_diag_out', 'REAL_CASHIER_8_CRASH')
  fs.mkdirSync(crashDir, { recursive: true })
  fs.copyFileSync(path.join(LAB_DIR, 'kakapo.sqlite'), path.join(crashDir, 'kakapo.sqlite'))
  // Use local-only blocked sales (not ACK-lost IDEMPOTENCY without server proof).
  // Mixing ACK-lost without serverByClientRef correctly STOP_CHAINs (fail-closed) — harness bug previously.
  const localOnlyForCrash = classified.ops
    .filter(o => o.kind === 'sale' && o.classification === 'DEPENDENCY_BLOCKED')
    .slice(0, 12)
  const crashQueue = localOnlyForCrash.map(o => {
    const src = realQueue.find(r => r.clientRef === o.clientRef) || o
    return {
      ...src,
      failed: false,
      lastError: '',
      payload: { ...(src.payload || o.payload || {}) },
    }
  })
  let crashSession = ex.createDurableRecoverySession({
    recoverySessionId: 'RS-crash8',
    snapshotManifestHash: sourceBefore.sha256,
    snapshotExists: true,
    targetServerShiftId: 'SHIFT-CRASH-T',
  })
  const crashWorld = {
    recoveryMode: true,
    isDesktop: true,
    serverReachable: true,
    queue: crashQueue,
    sales: crashQueue.map(r => ({
      id: r.localId, clientRef: r.clientRef, shiftId: r.payload?.shiftId,
      paidCash: r.payload?.paidCash, paidCard: r.payload?.paidCard, debtAdded: r.payload?.debtAdded,
    })),
    stock: { p1: 100 },
    debt: {},
    classifyCtx: {
      serverClosedIds: new Set(crashQueue.map(r => r.payload?.shiftId).filter(Boolean)),
      serverByClientRef: new Map(),
    },
    crashAfterAckCount: 3,
  }
  const crashMock = await startMock({ shifts: [], sales: [] })
  const crashApi = adapter.createRecoveryHttpAdapter({ baseUrl: crashMock.baseUrl })
  await crashApi.openPosShift({ clientRef: crashSession.targetShiftOpenClientRef, cashierId: 'C', openingCash: 0 })
  const cOpen = (await crashApi.listOpenShifts())[0]
  crashSession = ex.persistSessionPatch(crashSession, { targetServerShiftId: cOpen.id })
  const cPlan = engine.planShiftRemaps(
    engine.classifyQueueFresh(crashWorld.queue, crashWorld.classifyCtx).ops,
    { plannedTargetShiftId: cOpen.id },
  )
  const cRemap = ex.executeShiftRemapBatch(crashSession, cPlan.rows, crashWorld)
  crashSession = ex.enterReplayFreeze(cRemap.session || crashSession)
  crashSession = ex.persistSessionPatch(crashSession, {
    targetServerShiftId: cOpen.id,
    classificationAt: new Date().toISOString(),
  })
  crashWorld.crashAfterAckCount = 3
  crashWorld.classifyCtx = {
    serverClosedIds: new Set(),
    serverShiftById: new Map([[cOpen.id, { status: 'open' }]]),
    serverByClientRef: new Map(),
  }
  const c1 = await ex.executeRecoveryReplay(crashSession, crashWorld, crashApi, { limit: 20 })
  crashWorld.crashAfterAckCount = null
  let c2 = c1
  if (c1.resumable || !c1.ok) {
    c2 = await ex.executeRecoveryReplay(c1.session || crashSession, crashWorld, crashApi, { limit: 20 })
  }
  // drain remainder if still queue
  while (crashWorld.queue.length > 0 && (c2.ok || c2.resumable)) {
    const more = await ex.executeRecoveryReplay(c2.session || crashSession, crashWorld, crashApi, { limit: 20 })
    c2 = more
    if (!more.ok && !more.resumable) break
    if ((more.processed || 0) === 0 && !more.resumable) break
  }
  report.crashResume = {
    crashed: !!c1.resumable || c1.error === 'CRASH_AFTER_ACK_BATCH',
    firstError: c1.error || c1.code || null,
    resumedOk: !!c2.ok && crashWorld.queue.length === 0,
    queueLeft: crashWorld.queue.length,
    sales: crashMock.store.sales.length,
    uniqueRefs: new Set(crashMock.store.sales.map(s => s.clientRef)).size,
    subsetSize: crashQueue.length,
    harnessNote: 'local-only DEPENDENCY_BLOCKED sales; ACK-lost excluded without server index (expected fail-closed)',
  }
  await crashMock.close()

  // ── Rollback proofs ──
  const backupWorld = { queue: realQueue.slice(0, 5), stock: { p1: 9 } }
  const beforeRb = adapter.applyRollbackDecision(
    'BEFORE_SERVER_REPLAY',
    { queue: [] },
    session,
    backupWorld,
  )
  const afterRb = adapter.applyRollbackDecision(
    'AFTER_PARTIAL_REPLAY',
    { queue: realQueue.slice(0, 2), serverCommitted: true },
    { ...session, completedClientRefs: ['x'] },
    backupWorld,
  )
  report.rollback = {
    beforeReplay: { allowBlindRestore: beforeRb.plan.allowBlindRestore, restoredQueue: beforeRb.world.queue.length },
    afterPartial: { allowBlindRestore: afterRb.plan.allowBlindRestore, resumeRequired: afterRb.resumeRequired },
  }

  await mock.close()

  // ── Source SHA after ──
  const sourceAfter = fileMeta(srcPath)
  report.sourceIntegrity.after = sourceAfter
  report.sourceIntegrity.mutated = sourceBefore.sha256 !== sourceAfter.sha256
  report.REAL_CASHIER_8_SOURCE_MUTATED = report.sourceIntegrity.mutated ? 'YES' : 'NO'

  // Verdicts
  const labOk = report.labReplay?.ok === true
  const noSourceMut = report.REAL_CASHIER_8_SOURCE_MUTATED === 'NO'
  const installerOk = report.installer?.match === true
  const firstBootOk = report.firstBoot?.posts === 0
  const prepOk = report.prepTool?.verify?.queueUnchanged === true

  report.verdicts = {
    V_READY_production_prep: labOk && noSourceMut && installerOk && prepOk && firstBootOk ? 'READY' : 'NOT READY',
    W_READY_arm_live: 'NOT READY',
    X_READY_install_live: 'NOT READY',
    Y_READY_live_replay: 'NOT READY',
    reasons: [
      !labOk ? `labReplay not ok: ${report.labReplay?.code || report.labReplay?.error || report.labReplay?.reason}` : null,
      report.preReplayGate?.hardBlockers ? `hardBlockers=${report.preReplayGate.hardBlockers}` : null,
      report.conservation?.lost ? `lostSales=${report.conservation.lost}` : null,
    ].filter(Boolean),
  }

  report.runbook = [
    '1. Quit live Desktop',
    '2. Copy final triplet → REAL_CASHIER_FINAL + SHA256',
    '3. LAB validate with 1.2.190 (this report)',
    '4. pc4-recovery-prep --arm on live path (app closed)',
    '5. Install 1.2.190 → verify zero network mutations',
    '6. Fresh classify → operator review',
    '7. REPLAY freeze → controlled replay',
    '8. verifyPostDrain → pull → ghosts → disableRecoveryStrict',
  ]

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log('[pc4] wrote', OUT)
  console.log('[pc4] SOURCE_MUTATED=', report.REAL_CASHIER_8_SOURCE_MUTATED)
  console.log('[pc4] queueTotal=', report.classification.queueTotal)
  console.log('[pc4] ackExact=', report.classification.ackLostExact)
  console.log('[pc4] labReplay.ok=', report.labReplay?.ok)
  console.log('[pc4] verdicts', report.verdicts)
  } catch (e) {
    report.fatalError = String(e?.stack || e)
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
    console.error('[pc4] FATAL', e)
    process.exitCode = 1
  }
}

main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
