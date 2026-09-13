#!/usr/bin/env node
/**
 * ONE-SHOT Sayod/Holov identity+debt recovery operator.
 *
 * Default: DRY-RUN (no writes).
 *
 *   node scripts/sayod-holov-recovery-repair.mjs
 *   node scripts/sayod-holov-recovery-repair.mjs --source=api
 *   node scripts/sayod-holov-recovery-repair.mjs --fixture=path.json
 *   node scripts/sayod-holov-recovery-repair.mjs --apply --confirm=SAYOD_HOLOV_REPAIR_2026_09_13 --source=postgres
 *
 * Does NOT touch sales/finance/stock/loyalty/shifts.
 * Does NOT use PATCH /cards or cashier UI.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONFIRM_TOKEN,
  verifyCorruptedPreconditions,
  isAlreadyRepaired,
  buildRepairedEntities,
  applyRepairedToState,
  exportRollbackSnapshot,
  planSummary,
  findCard,
  findClient,
  openSum,
  SAYOD_ID,
  HOLOV_ID,
} from './sayod-holov-recovery-core.mjs'
import {
  loadStateFromApi,
  loadStateFromFixture,
  loadStateFromPostgres,
  applyRepairedPostgres,
  writeSnapshotFile,
} from './sayod-holov-recovery-persist.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = {
    apply: false,
    confirm: '',
    source: 'api', // api | postgres | fixture
    fixture: '',
    sayodLedger: '',
    holovLedger: '',
    failAt: '',
    snapshotOut: '',
  }
  for (const a of argv) {
    if (a === '--apply') out.apply = true
    else if (a === '--dry-run') out.apply = false
    else if (a.startsWith('--confirm=')) out.confirm = a.slice('--confirm='.length)
    else if (a.startsWith('--source=')) out.source = a.slice('--source='.length)
    else if (a.startsWith('--fixture=')) {
      out.fixture = a.slice('--fixture='.length)
      out.source = 'fixture'
    } else if (a.startsWith('--sayod-open-ledger=')) out.sayodLedger = a.slice('--sayod-open-ledger='.length)
    else if (a.startsWith('--holov-base-ledger=')) out.holovLedger = a.slice('--holov-base-ledger='.length)
    else if (a.startsWith('--fail-at=')) out.failAt = a.slice('--fail-at='.length)
    else if (a.startsWith('--snapshot-out=')) out.snapshotOut = a.slice('--snapshot-out='.length)
  }
  return out
}

async function loadState(args) {
  if (args.source === 'fixture') {
    if (!args.fixture) throw new Error('--fixture=path required')
    return loadStateFromFixture(args.fixture)
  }
  if (args.source === 'postgres') return loadStateFromPostgres()
  return loadStateFromApi()
}

function optionalJsonArray(file) {
  if (!file) return undefined
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return Array.isArray(raw) ? raw : raw.rows || raw.openLedger
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.apply ? 'APPLY' : 'DRY-RUN'

  if (args.apply) {
    if (args.confirm !== CONFIRM_TOKEN) {
      console.error(JSON.stringify({
        status: 'ABORT',
        reason: 'EXPLICIT_CONFIRM_REQUIRED',
        expected: `--confirm=${CONFIRM_TOKEN}`,
      }, null, 2))
      process.exit(2)
    }
    if (args.source === 'api') {
      console.error(JSON.stringify({
        status: 'ABORT',
        reason: 'APPLY_REQUIRES_POSTGRES_OR_FIXTURE',
        detail: 'Refuse apply via HTTP API. Use --source=postgres or --fixture=...',
      }, null, 2))
      process.exit(2)
    }
  }

  const state = await loadState(args)
  state.sayodOpenLedger = optionalJsonArray(args.sayodLedger)
  state.holovBaseOpenLedger = optionalJsonArray(args.holovLedger)

  if (isAlreadyRepaired(state)) {
    const report = {
      status: 'ALREADY_REPAIRED',
      mode,
      source: state.source,
      PRODUCTION_DATA_CHANGED: false,
    }
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const pre = verifyCorruptedPreconditions(state)
  if (!pre.ok) {
    console.error(JSON.stringify({
      status: 'ABORT',
      reason: 'PRECONDITION_MISMATCH',
      reasons: pre.reasons,
      mode,
      PRODUCTION_DATA_CHANGED: false,
    }, null, 2))
    process.exit(3)
  }

  const snapshot = exportRollbackSnapshot(state)
  let snapshotPath = null
  if (args.apply || args.snapshotOut) {
    snapshotPath = writeSnapshotFile(snapshot, args.snapshotOut || undefined)
  } else {
    // dry-run still writes a preview snapshot under _diag_out for review
    snapshotPath = writeSnapshotFile({ ...snapshot, dryRunPreview: true })
  }

  const repaired = buildRepairedEntities(state)
  const plan = planSummary(repaired)

  const report = {
    status: mode === 'DRY-RUN' ? 'DRY_RUN_OK' : 'APPLYING',
    mode,
    source: state.source,
    snapshotPath,
    preconditions: 'PASS',
    plan,
    WOULD_SET_SAYOD_DEBT: plan.WOULD_SET_SAYOD_DEBT,
    WOULD_SET_HOLOV_DEBT: plan.WOULD_SET_HOLOV_DEBT,
    WOULD_MOVE_CA_486_70: plan.WOULD_MOVE_CA_486_70,
    WOULD_RECREATE_K9649: plan.WOULD_RECREATE_K9649,
    WOULD_RECREATE_K9652: plan.WOULD_RECREATE_K9652,
    WOULD_TOUCH_STOCK: false,
    WOULD_TOUCH_SALES: false,
    WOULD_TOUCH_FINANCE: false,
    WOULD_TOUCH_LOYALTY: false,
    WOULD_TOUCH_SHIFT: false,
    target: {
      u01: { id: SAYOD_ID, name: repaired.u01.name, phone: repaired.u01.phone, card: repaired.u01.card, debt: repaired.u01.debt, openSum: openSum(repaired.u01.debtLedger) },
      u03: { id: HOLOV_ID, name: repaired.u03.name, phone: repaired.u03.phone, card: repaired.u03.card, debt: repaired.u03.debt, openSum: openSum(repaired.u03.debtLedger) },
      card0001: { num: repaired.c1.num, clientId: repaired.c1.clientId, debt: repaired.c1.debt, openSum: openSum(repaired.c1.debtLedger) },
      card0003: { num: repaired.c3.num, clientId: repaired.c3.clientId, status: repaired.c3.status, debt: repaired.c3.debt, openSum: openSum(repaired.c3.debtLedger) },
    },
  }

  if (!args.apply) {
    report.PRODUCTION_DATA_CHANGED = false
    report.SAFE_TO_APPLY_AFTER_REVIEW = true
    console.log(JSON.stringify(report, null, 2))
    return
  }

  // APPLY
  if (args.source === 'fixture') {
    applyRepairedToState(state, repaired, { failAt: args.failAt || undefined })
    // write back fixture if path provided (tests use in-memory; CLI may persist)
    if (args.fixture && process.env.SAYOD_HOLOV_WRITE_FIXTURE === '1') {
      fs.writeFileSync(args.fixture, JSON.stringify({
        clients: state.clients,
        cards: state.cards,
        moneyLedger: state.moneyLedger,
        posSales: state.posSales,
        financeMoves: state.financeMoves,
      }, null, 2))
    }
  } else if (args.source === 'postgres') {
    await applyRepairedPostgres(repaired, { failAt: args.failAt || undefined })
  } else {
    throw new Error('unsupported apply source')
  }

  // Post-verify from same in-memory state or reload PG
  let after = state
  if (args.source === 'postgres') after = await loadStateFromPostgres()

  if (!isAlreadyRepaired(after)) {
    console.error(JSON.stringify({
      status: 'VERIFY_FAILED',
      reason: 'post-apply state does not match repaired invariants',
      snapshotPath,
    }, null, 2))
    process.exit(4)
  }

  report.status = 'APPLIED_OK'
  report.PRODUCTION_DATA_CHANGED = args.source === 'postgres'
  report.postVerify = 'PASS'
  console.log(JSON.stringify(report, null, 2))
}

main().catch(e => {
  console.error(JSON.stringify({ status: 'ERROR', error: e.message || String(e) }, null, 2))
  process.exit(1)
})
