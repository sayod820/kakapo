#!/usr/bin/env node
/**
 * Rollback Sayod/Holov recovery from exported snapshot JSON.
 *
 * Default: DRY-RUN.
 *
 *   node scripts/sayod-holov-recovery-rollback.mjs --snapshot=path.json
 *   node scripts/sayod-holov-recovery-rollback.mjs --snapshot=path.json --apply --confirm=SAYOD_HOLOV_ROLLBACK_2026_09_13 --source=postgres
 */
import fs from 'node:fs'
import {
  ROLLBACK_CONFIRM_TOKEN,
  verifyRepairedPreconditions,
  verifyCorruptedPreconditions,
  applyRollbackSnapshotToState,
  isAlreadyRepaired,
  findClient,
  findCard,
  SAYOD_ID,
  HOLOV_ID,
} from './sayod-holov-recovery-core.mjs'
import {
  loadStateFromApi,
  loadStateFromFixture,
  loadStateFromPostgres,
  applyRollbackPostgres,
} from './sayod-holov-recovery-persist.mjs'

function parseArgs(argv) {
  const out = { apply: false, confirm: '', source: 'api', fixture: '', snapshot: '' }
  for (const a of argv) {
    if (a === '--apply') out.apply = true
    else if (a === '--dry-run') out.apply = false
    else if (a.startsWith('--confirm=')) out.confirm = a.slice('--confirm='.length)
    else if (a.startsWith('--source=')) out.source = a.slice('--source='.length)
    else if (a.startsWith('--fixture=')) {
      out.fixture = a.slice('--fixture='.length)
      out.source = 'fixture'
    } else if (a.startsWith('--snapshot=')) out.snapshot = a.slice('--snapshot='.length)
  }
  return out
}

async function loadState(args) {
  if (args.source === 'fixture') return loadStateFromFixture(args.fixture)
  if (args.source === 'postgres') return loadStateFromPostgres()
  return loadStateFromApi()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.snapshot) {
    console.error(JSON.stringify({ status: 'ABORT', reason: '--snapshot=path required' }, null, 2))
    process.exit(2)
  }
  const snapshot = JSON.parse(fs.readFileSync(args.snapshot, 'utf8'))
  if (snapshot.kind !== 'sayod-holov-recovery-rollback-v1' && !snapshot.clients?.['U-01']) {
    console.error(JSON.stringify({ status: 'ABORT', reason: 'invalid snapshot kind' }, null, 2))
    process.exit(2)
  }

  if (args.apply) {
    if (args.confirm !== ROLLBACK_CONFIRM_TOKEN) {
      console.error(JSON.stringify({
        status: 'ABORT',
        reason: 'EXPLICIT_CONFIRM_REQUIRED',
        expected: `--confirm=${ROLLBACK_CONFIRM_TOKEN}`,
      }, null, 2))
      process.exit(2)
    }
    if (args.source === 'api') {
      console.error(JSON.stringify({ status: 'ABORT', reason: 'APPLY_REQUIRES_POSTGRES_OR_FIXTURE' }, null, 2))
      process.exit(2)
    }
  }

  const state = await loadState(args)
  const repaired = verifyRepairedPreconditions(state)
  if (!repaired.ok) {
    // Allow rollback only from repaired state (safety)
    console.error(JSON.stringify({
      status: 'ABORT',
      reason: 'CURRENT_NOT_REPAIRED',
      detail: 'Refuse rollback unless current state matches repaired invariants',
      reasons: repaired.reasons,
      PRODUCTION_DATA_CHANGED: false,
    }, null, 2))
    process.exit(3)
  }

  const report = {
    status: args.apply ? 'APPLYING_ROLLBACK' : 'DRY_RUN_OK',
    mode: args.apply ? 'APPLY' : 'DRY-RUN',
    snapshot: args.snapshot,
    wouldRestore: {
      u01Debt: snapshot.clients?.[SAYOD_ID]?.debt,
      u03Debt: snapshot.clients?.[HOLOV_ID]?.debt,
      card0001Debt: snapshot.cards?.['КАКАПО-0001']?.debt,
      card0003Debt: snapshot.cards?.['КАКАПО-0003']?.debt,
      card0001ClientId: snapshot.cards?.['КАКАПО-0001']?.clientId,
      card0003Status: snapshot.cards?.['КАКАПО-0003']?.status,
    },
    WOULD_TOUCH_STOCK: false,
    WOULD_TOUCH_SALES: false,
    WOULD_TOUCH_FINANCE: false,
    WOULD_TOUCH_LOYALTY: false,
    WOULD_TOUCH_SHIFT: false,
  }

  if (!args.apply) {
    report.PRODUCTION_DATA_CHANGED = false
    console.log(JSON.stringify(report, null, 2))
    return
  }

  if (args.source === 'fixture') {
    applyRollbackSnapshotToState(state, snapshot)
  } else {
    await applyRollbackPostgres(snapshot)
  }

  let after = state
  if (args.source === 'postgres') after = await loadStateFromPostgres()
  const corr = verifyCorruptedPreconditions(after)
  if (!corr.ok) {
    console.error(JSON.stringify({
      status: 'VERIFY_FAILED',
      reason: 'rollback did not restore expected corrupted incident shape',
      reasons: corr.reasons,
    }, null, 2))
    process.exit(4)
  }

  report.status = 'ROLLBACK_APPLIED_OK'
  report.PRODUCTION_DATA_CHANGED = args.source === 'postgres'
  report.postVerify = 'PASS_CORRUPTED_SHAPE_RESTORED'
  console.log(JSON.stringify(report, null, 2))
}

main().catch(e => {
  console.error(JSON.stringify({ status: 'ERROR', error: e.message || String(e) }, null, 2))
  process.exit(1)
})
