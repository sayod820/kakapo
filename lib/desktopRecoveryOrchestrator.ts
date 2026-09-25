/**
 * PC-5 — Desktop self-recovering upgrade orchestrator (live façade).
 * Runs after ensureRecoveryGateReady, before normal flushQueue can send.
 */
import { getApiUrl } from './config'
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { getPending, deletePending } from './offline'
import {
  ensureRecoveryGateReady,
  isRecoveryModeActive,
  setRecoveryMode,
  appendRecoveryAudit,
} from './desktopRecovery'
import {
  beginRecoverySession,
  saveDurableRecoverySession,
  loadDurableRecoverySession,
  disableRecoveryStrict,
  getRecoveryPhase,
  setRecoveryPhase,
  RECOVERY_PHASE,
} from './desktopRecoveryExecutor'
import { createRecoveryHttpAdapter } from './recoveryApiAdapterCore.mjs'
import {
  fingerprintSaleServerRow,
  businessPayloadFingerprint,
} from './desktopRecoveryEngineCore.mjs'
import {
  ORCH_STATUS,
  detectRecoveryNeed,
  canAutoExitStaleRecovery,
  buildServerByClientRefFromSales,
  buildClosedShiftIds,
  runAutomaticRecoveryPipeline,
  createDesktopOrchestratorProductionGate,
} from './desktopRecoveryOrchestratorCore.mjs'
import { getTradeDeviceIdSync } from './tradeDevice'

export { ORCH_STATUS, detectRecoveryNeed }

type OrchUiState = {
  active: boolean
  status: string
  message: string
  queueLeft: number
  queueTotal: number
  step?: string
  error?: string | null
  needsOperator?: boolean
}

let uiState: OrchUiState = {
  active: false,
  status: ORCH_STATUS.IDLE,
  message: '',
  queueLeft: 0,
  queueTotal: 0,
}
const listeners = new Set<(s: OrchUiState) => void>()
let running: Promise<{ ok: boolean; skipped?: boolean; error?: string }> | null = null

export function getRecoveryOrchestratorUiState(): OrchUiState {
  return { ...uiState }
}

export function subscribeRecoveryOrchestrator(fn: (s: OrchUiState) => void): () => void {
  listeners.add(fn)
  fn({ ...uiState })
  return () => { listeners.delete(fn) }
}

function setUi(patch: Partial<OrchUiState>) {
  uiState = { ...uiState, ...patch }
  for (const fn of listeners) {
    try { fn({ ...uiState }) } catch { /* ignore */ }
  }
}

function normalizeQueueRow(raw: any) {
  const nested = raw?.payload && typeof raw.payload === 'object' ? raw.payload : {}
  return {
    clientRef: String(raw?.clientRef || ''),
    kind: String(raw?.kind || 'unknown'),
    seq: raw?.seq,
    localId: raw?.localId,
    createdAtIso: raw?.createdAtIso || nested.createdAtIso,
    failed: !!raw?.failed,
    lastError: raw?.lastError || '',
    payload: { ...nested, clientRef: nested.clientRef || raw?.clientRef },
  }
}

async function createImmutableBackup(): Promise<{
  ok: boolean
  manifest?: Record<string, unknown>
  error?: string
}> {
  const desk = getKakapoDesktop()
  if (typeof (desk as any)?.localDbRecoveryBackup === 'function') {
    try {
      const r = await (desk as any).localDbRecoveryBackup()
      if (r?.ok && r?.manifest) return { ok: true, manifest: r.manifest }
      return { ok: false, error: r?.error || 'backup_ipc_failed' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { ok: false, error: 'backup_ipc_unavailable' }
}

async function fetchServerClassificationContext(api: ReturnType<typeof createRecoveryHttpAdapter>) {
  let sales: any[] = []
  let shifts: any[] = []
  try {
    if (typeof (api as any).listPosSales === 'function') {
      sales = await (api as any).listPosSales()
    }
  } catch { /* offline — classify without server index */ }
  try {
    const rows = await (api as any).listAllShifts?.() || []
    shifts = Array.isArray(rows) ? rows : []
  } catch {
    try {
      shifts = await api.listOpenShifts()
    } catch { /* ignore */ }
  }
  const serverByClientRef = buildServerByClientRefFromSales(sales)
  const serverClosedIds = buildClosedShiftIds(shifts)
  const serverShiftById = new Map<string, { status: string }>()
  for (const s of shifts) {
    serverShiftById.set(String(s.id), { status: String(s.status || '') })
  }
  return { sales, shifts, serverByClientRef, serverClosedIds, serverShiftById }
}

/**
 * Boot entry: detect → backup → arm → classify → ACK → remap → replay → NORMAL.
 * Safe to call multiple times; concurrent calls coalesce.
 */
export async function maybeRunAutomaticDesktopRecovery(opts: {
  appVersion?: string
  force?: boolean
} = {}): Promise<{ ok: boolean; skipped?: boolean; error?: string; report?: unknown }> {
  if (!isKakapoDesktop() && !opts.force) {
    return { ok: true, skipped: true, error: 'not_desktop' }
  }
  if (running) return running

  running = (async () => {
    await ensureRecoveryGateReady()
    const desk = getKakapoDesktop()
    const meta = desk?.localDbMetaGet ? await desk.localDbMetaGet() : {}
    const pending = (await getPending()).map(normalizeQueueRow)
    const appVersion = opts.appVersion
      || (typeof window !== 'undefined' && (window as any).__KAKAPO_DESKTOP_VERSION__)
      || meta?.appVersion
      || ''
    const previousAppVersion = String(meta?.lastSeenAppVersion || '')

    const detect = detectRecoveryNeed({
      queue: pending,
      meta: meta || {},
      appVersion,
      previousAppVersion,
    })

    // Always stamp seen version (even if no recovery)
    if (appVersion && desk?.localDbMetaPatch) {
      try {
        await desk.localDbMetaPatch({ lastSeenAppVersion: appVersion })
      } catch { /* ignore */ }
    }

    const onlyStaleArm = detect.need && detect.reasons.every(r =>
      r === 'recoveryMode' || r === 'durable_session_incomplete' || r === 'recoveryRequiredAfterUpgrade')
    if (onlyStaleArm) {
      const exit = canAutoExitStaleRecovery({ queue: pending, meta: meta || {} })
      if (exit.ok) {
        const sess = meta?.recoverySession
        if (sess && typeof sess === 'object' && desk?.localDbMetaPatch) {
          try {
            await desk.localDbMetaPatch({
              recoverySession: { ...sess, status: 'ABORTED', stoppedReason: 'auto_exit_stale' },
            })
          } catch { /* ignore */ }
        }
        const off = await setRecoveryMode(false, 'auto_exit_stale', { force: true })
        if (off.ok) {
          await setRecoveryPhase(RECOVERY_PHASE.COMPLETE, 'auto_exit_stale')
          await appendRecoveryAudit({
            action: 'RECOVERY_DISABLED',
            reason: 'auto_exit_stale',
            before: { reasons: detect.reasons, queue: pending.length },
          })
          setUi({ active: false, status: ORCH_STATUS.IDLE, message: '', queueLeft: 0, queueTotal: 0 })
          return { ok: true, skipped: true }
        }
      }
    }

    if (!detect.need) {
      setUi({ active: false, status: ORCH_STATUS.IDLE, message: '', queueLeft: 0, queueTotal: 0 })
      return { ok: true, skipped: true }
    }

    setUi({
      active: true,
      status: ORCH_STATUS.BACKING_UP,
      message: 'Проверяем синхронизацию…',
      queueLeft: pending.length,
      queueTotal: pending.length,
      needsOperator: false,
      error: null,
    })

    // Fail-closed: arm recovery BEFORE any mutation / adapter
    if (!isRecoveryModeActive()) {
      await setRecoveryMode(true, 'pc5_auto_detect')
      await setRecoveryPhase(RECOVERY_PHASE.PREPARE, 'pc5_auto')
    }

    const backup = await createImmutableBackup()
    if (!backup.ok) {
      setUi({
        active: true,
        status: ORCH_STATUS.ERROR,
        message: 'Требуется проверка: не удалось создать резервную копию',
        error: backup.error || 'backup_failed',
        needsOperator: true,
        queueLeft: pending.length,
        queueTotal: pending.length,
      })
      await appendRecoveryAudit({
        action: 'SNAPSHOT',
        reason: `backup_failed:${backup.error}`,
      })
      return { ok: false, error: backup.error || 'backup_failed' }
    }

    await appendRecoveryAudit({
      action: 'SNAPSHOT',
      reason: 'pc5_auto_backup',
      after: backup.manifest,
    })

    const baseUrl = getApiUrl().replace(/\/$/, '')
    // Read-only adapter first (GET classification). Production mutations only after gates.
    let api: ReturnType<typeof createRecoveryHttpAdapter>
    try {
      if (/kakappo\.shop|kakapo\.shop/i.test(baseUrl)) {
        api = createRecoveryHttpAdapter({
          baseUrl,
          allowProductionHost: true,
          allowProductionGetClassify: true,
        })
      } else {
        api = createRecoveryHttpAdapter({ baseUrl })
      }
    } catch (e) {
      setUi({
        active: true,
        status: ORCH_STATUS.ERROR,
        message: 'Требуется проверка: адаптер восстановления',
        error: e instanceof Error ? e.message : String(e),
        needsOperator: true,
        queueLeft: pending.length,
        queueTotal: pending.length,
      })
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    setUi({ status: ORCH_STATUS.CLASSIFYING, message: 'Проверяем сервер…' })
    const ctx = await fetchServerClassificationContext(api)

    let session = await loadDurableRecoverySession()
    if (!session) {
      const begun = await beginRecoverySession({
        deviceId: getTradeDeviceIdSync() || undefined,
        snapshotManifestHash: String(backup.manifest?.sqliteSha256 || backup.manifest?.sha256 || 'backup'),
        sourceSyncCursor: meta?.syncCursor ?? null,
        queue: pending,
      })
      if (!begun.ok || !begun.session) {
        return { ok: false, error: begun.error || 'begin_session_failed' }
      }
      session = begun.session
    }

    const world = {
      recoveryMode: true,
      isDesktop: true,
      serverReachable: true,
      queue: pending.map(r => ({ ...r, payload: { ...r.payload } })),
      sales: pending.filter(r => r.kind === 'sale').map(r => ({
        id: r.localId,
        clientRef: r.clientRef,
        shiftId: r.payload?.shiftId,
        paidCash: r.payload?.paidCash,
        paidCard: r.payload?.paidCard,
        debtAdded: r.payload?.debtAdded,
      })),
      stock: {},
      debt: {},
      networkPostCount: 0,
      classifyCtx: {
        serverByClientRef: ctx.serverByClientRef,
        serverClosedIds: ctx.serverClosedIds,
        serverShiftById: ctx.serverShiftById,
      },
      ghostIds: [...ctx.serverClosedIds].length
        ? pending
          .filter(r => r.kind === 'sale' && /^off-/i.test(String(r.payload?.shiftId || '')))
          .map(r => String(r.payload.shiftId))
          .filter((v, i, a) => a.indexOf(v) === i)
        : pending
          .filter(r => r.kind === 'sale' && /^off-/i.test(String(r.payload?.shiftId || '')))
          .map(r => String(r.payload.shiftId))
          .filter((v, i, a) => a.indexOf(v) === i),
    }

    setUi({
      status: ORCH_STATUS.REPLAYING,
      message: `Восстанавливаем ${world.queue.length} операций…`,
      queueTotal: world.queue.length,
      queueLeft: world.queue.length,
    })

    const result = await runAutomaticRecoveryPipeline({
      session,
      world,
      api,
      backupManifestPresent: true,
      onProgress: (p) => {
        const msg =
          p.status === ORCH_STATUS.ACKING ? 'Подтверждаем уже отправленные операции…'
            : p.status === ORCH_STATUS.REMAPPING ? 'Переносим продажи на смену восстановления…'
              : p.status === ORCH_STATUS.REPLAYING ? `Восстанавливаем ${p.queueLeft ?? world.queue.length} операций…`
                : p.status === ORCH_STATUS.VERIFYING ? 'Проверяем сервер…'
                  : p.status === ORCH_STATUS.PULLING ? 'Обновляем данные…'
                    : p.status === ORCH_STATUS.COMPLETE ? 'Синхронизация восстановлена'
                      : 'Проверяем синхронизацию…'
        setUi({
          active: true,
          status: String(p.status || uiState.status),
          message: msg,
          queueLeft: Number(p.queueLeft ?? world.queue.length),
          step: p.step,
        })
      },
      options: {
        allowAdoptUnexpected: false,
        cashierId: 'RECOVERY',
        batchLimit: 30,
        serverSales: ctx.sales,
        serverSnapshot: { sales: ctx.sales, shifts: ctx.shifts },
        requirePull: false,
        createProductionAdapter: (gate: any) => {
          api.setProductionReplayGate(gate)
          return api
        },
      },
    })

    await saveDurableRecoverySession(result.session || session)

    // Persist queue deletions done in world back to SQLite
    const remaining = new Set((world.queue || []).map((r: any) => r.clientRef))
    for (const row of pending) {
      if (!remaining.has(row.clientRef)) {
        try { await deletePending(row.clientRef) } catch { /* ignore */ }
      }
    }

    if (result.ok && result.canDisable) {
      await disableRecoveryStrict(result.session!, { queue: world.queue, ghostIds: world.ghostIds })
      setUi({
        active: false,
        status: ORCH_STATUS.COMPLETE,
        message: 'Синхронизация восстановлена',
        queueLeft: 0,
        queueTotal: pending.length,
        needsOperator: false,
        error: null,
      })
      await appendRecoveryAudit({
        action: 'RECOVERY_DISABLED',
        reason: 'pc5_auto_complete',
        after: { ack: result.ack, remapped: result.remapped, replayed: result.replayed },
      })
      return { ok: true, report: result }
    }

    const needsOp = result.status === ORCH_STATUS.NEEDS_OPERATOR
    setUi({
      active: true,
      status: String(result.status),
      message: needsOp
        ? 'Требуется проверка — данные сохранены локально'
        : `Ошибка восстановления: ${result.error || 'unknown'}`,
      error: result.error,
      needsOperator: needsOp,
      queueLeft: (world.queue || []).length,
      queueTotal: pending.length,
    })
    return {
      ok: false,
      error: result.error || 'recovery_incomplete',
      report: result,
    }
  })().finally(() => { running = null })

  return running
}

/** True when REPLAY freeze should block new sales in UI */
export async function isRecoveryReplayBlockingSales(): Promise<boolean> {
  if (!isKakapoDesktop()) return false
  if (!isRecoveryModeActive()) return false
  const phase = await getRecoveryPhase()
  return phase === RECOVERY_PHASE.REPLAY
}

// silence unused import warnings in some bundlers
void businessPayloadFingerprint
void fingerprintSaleServerRow
void createDesktopOrchestratorProductionGate
