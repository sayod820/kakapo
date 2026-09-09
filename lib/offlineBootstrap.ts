// ════════════════════════════════════════════════
// KAKAPO — первая установка локальной базы (один раз)
// Дальше работа из локалки; при интернете — тихий синк.
// ════════════════════════════════════════════════
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { isTradeAndroidNative } from './tradeAndroid'

function needsLocalInstall(): boolean {
  return isKakapoDesktop() || isTradeAndroidNative()
}
import { cacheEmployeesAuth, isOnline, readCachedEmployeesAuth, readCachedProducts } from './offline'
import { authRowFromServer, hashEmployeePassword } from './employeePassword'
import { getApiUrl } from './config'
import { api } from './api'

const STEPS: { id: BootstrapStepId; label: string }[] = [
  { id: 'products', label: 'Каталог, склад, касса (полный снимок)' },
  { id: 'pos', label: 'Ящик / финансы / лояльность' },
  { id: 'clients', label: 'Сотрудники для входа' },
  { id: 'done', label: 'Готово' },
]

async function cacheEmployeesForOfflineLogin(): Promise<void> {
  const rows = await api.getEmployeesLocalAuth()
  const mapped = await Promise.all((rows || []).map(r => authRowFromServer(r)))
  const withPass = mapped.filter(r => r.active !== false && r.passwordHash.length >= 32)
  if (!withPass.length) {
    throw new Error('Сервер не отдал данные для офлайн-входа')
  }
  await cacheEmployeesAuth(mapped)
}

export type EmployeePasswordRow = {
  id: string
  name: string
  role: string
  roleLabel?: string
}

export type BootstrapResult =
  | { ok: true }
  | { ok: false; error: string; needEmployeePasswords?: EmployeePasswordRow[] }

/**
 * Если API ещё без /local-auth — проверяем пароли онлайн и сохраняем на диск.
 * Логин-экран откроется только после этого.
 */
export async function sealEmployeePasswordsForOffline(
  entries: Array<{ id: string; password: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const filled = entries.filter(e => e.id && String(e.password || '').trim().length >= 4)
  if (!filled.length) {
    return { ok: false, error: 'Введите пароль хотя бы одного сотрудника' }
  }
  const cached: Array<{
    id: string
    name: string
    role: string
    roleLabel?: string
    permissions: string[]
    active: boolean
    password: string
    passwordHash?: string
  }> = []
  const errors: string[] = []
  for (const e of filled) {
    try {
      const row = await api.loginEmployee({ id: e.id, password: e.password.trim() })
      cached.push({
        id: row.id,
        name: row.name,
        role: row.role,
        roleLabel: row.roleLabel,
        permissions: Array.isArray(row.permissions) ? row.permissions.map(String) : [],
        active: true,
        password: '',
        passwordHash: await hashEmployeePassword(e.password.trim()),
      })
    } catch (err) {
      const name = e.id
      errors.push(`${name}: ${err instanceof Error ? err.message : 'ошибка'}`)
    }
  }
  if (!cached.length) {
    return { ok: false, error: errors[0] || 'Неверный пароль' }
  }
  // подтянем остальных из directory без пароля — только успешно проверенных
  await cacheEmployeesAuth(cached)
  await markLocalBootstrapComplete()
  await markLocalSyncAt()
  return { ok: true }
}

export type BootstrapStepId =
  | 'products'
  | 'pos'
  | 'clients'
  | 'categories'
  | 'cards'
  | 'done'

export type BootstrapProgress = {
  step: BootstrapStepId
  label: string
  done: number
  total: number
  error?: string
}

/** Есть ли на диске сотрудники с паролями для офлайн-входа */
export async function hasOfflineEmployeeAuth(): Promise<boolean> {
  try {
    const rows = await readCachedEmployeesAuth()
    return !!(rows && rows.some(r => r.active !== false && (
      String(r.passwordHash || '').length >= 32 || String(r.password || '').length >= 4
    )))
  } catch {
    return false
  }
}

/** Готово: meta bootstrap ИЛИ (товары + пароли) на диске */
export async function isLocalBootstrapComplete(): Promise<boolean> {
  if (!needsLocalInstall()) return true
  try {
    const desk = getKakapoDesktop()
    if (desk?.localDbMetaGet) {
      try {
        const meta = await desk.localDbMetaGet()
        if (meta?.bootstrapComplete || meta?.installComplete) {
          const products = await readCachedProducts()
          if (products && products.length > 0 && (await hasOfflineEmployeeAuth())) return true
        }
      } catch { /* fall */ }
    }
    const products = await readCachedProducts()
    if (!products || products.length === 0) return false
    if (!(await hasOfflineEmployeeAuth())) return false
    await markLocalBootstrapComplete()
    return true
  } catch {
    return false
  }
}

export async function markLocalBootstrapComplete(): Promise<void> {
  const desk = getKakapoDesktop()
  try {
    if (desk?.localDbMarkInstalled) {
      await desk.localDbMarkInstalled()
      return
    }
    await desk?.localDbMetaPatch?.({
      bootstrapComplete: true,
      installComplete: true,
      lastBootstrapAt: new Date().toISOString(),
    })
  } catch { /* ignore */ }
}

export async function markLocalSyncAt(): Promise<void> {
  const desk = getKakapoDesktop()
  await desk?.localDbMetaPatch?.({
    lastSyncAt: new Date().toISOString(),
  })
}

export async function pingApiForBootstrap(timeoutMs = 20000): Promise<boolean> {
  if (!isOnline()) return false
  try {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${getApiUrl()}/health`, { cache: 'no-store', signal: ctrl.signal })
    window.clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

async function withRetries<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i >= tries) break
      await new Promise(r => window.setTimeout(r, Math.min(15000, 1500 * i)))
    }
  }
  throw last instanceof Error ? last : new Error(`${label}: не удалось загрузить`)
}

/**
 * Один раз после device-check: полный снимок сервера → SQLite.
 * Дальше UI только из SQLite; обмен — SYNC-канал.
 */
export async function runLocalBootstrap(
  onProgress?: (p: BootstrapProgress) => void,
): Promise<BootstrapResult> {
  const total = STEPS.length
  const report = (i: number, step: BootstrapStepId, label: string, error?: string) => {
    onProgress?.({ step, label, done: i, total, error })
  }

  if (!needsLocalInstall()) return { ok: true }

  const alive = await pingApiForBootstrap(25000)
  if (!alive) {
    return { ok: false, error: 'Нет интернета. Для первого запуска подключите сеть и нажмите «Скачать».' }
  }

  try {
    const { applySyncDeltaToSqlite } = await import('./applySyncToSqlite')
    const { api } = await import('./api')

    // 1) Один полный /sync/changes → SQLite (товары, категории, клиенты, карты, склад, POS…)
    report(0, 'products', STEPS[0].label)
    const delta = await withRetries('full-sync', () => api.getSyncChanges(undefined), 4)
    // force full apply even if server omitted full flag
    const payload = { ...delta, full: true }
    await applySyncDeltaToSqlite(payload)
    {
      const products = await readCachedProducts()
      if (!products?.length) {
        return {
          ok: false,
          error: 'Сервер не отдал каталог. Проверьте привязку устройства и нажмите «Повторить».',
        }
      }
    }
    report(1, 'products', STEPS[0].label)

    // 2) То, чего нет в /sync/changes: vault + loyalty
    report(1, 'pos', STEPS[1].label)
    await withRetries('extras', async () => {
      const { readCachedData, cacheData } = await import('./offline')
      const snap = (await readCachedData<Record<string, unknown>>('pos_snapshot')) || {}
      try {
        const vault = await api.getCashVault()
        if (vault) {
          const next = { ...snap, cashVault: vault }
          await cacheData('pos_snapshot', next)
          const desk = getKakapoDesktop()
          if (desk?.localDbKvSet) {
            try { await desk.localDbKvSet('pos_snapshot', next) } catch { /* ignore */ }
          }
        }
      } catch { /* optional */ }
      try {
        const { bootstrapLoyaltyConfigFromServer } = await import('./loyaltyStatusConfig')
        await bootstrapLoyaltyConfigFromServer()
      } catch { /* optional */ }
    }, 3)
    report(2, 'pos', STEPS[1].label)

    // 3) Сотрудники с паролями — обязательно до логина
    report(2, 'clients', STEPS[2].label)
    try {
      await withRetries('employees', () => cacheEmployeesForOfflineLogin(), 3)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось скачать сотрудников'
      return {
        ok: false,
        error: `${msg}. Проверьте привязку устройства и интернет, затем «Повторить».`,
      }
    }
    if (!(await hasOfflineEmployeeAuth())) {
      return {
        ok: false,
        error: 'Не удалось сохранить пароли сотрудников. Повторите загрузку.',
      }
    }
    report(3, 'clients', STEPS[2].label)

    await markLocalBootstrapComplete()
    await markLocalSyncAt()

    // UI сторы из SQLite (force)
    try {
      const { reloadStoresFromSqlite } = await import('./reloadFromSqlite')
      await reloadStoresFromSqlite(['all'])
    } catch { /* ignore */ }

    // После bootstrap — обычный softSync / очередь (SYNC-канал выкл)
    try {
      const { useOfflineSync } = await import('./offlineSync')
      void useOfflineSync.getState().syncNow()
    } catch { /* ignore */ }
    try {
      const { softSyncPosAfterSale, softSyncWarehouse, softSyncFinance } = await import('./posStore')
      void softSyncPosAfterSale({ force: true })
      void softSyncWarehouse()
      void softSyncFinance()
    } catch { /* ignore */ }

    report(total, 'done', 'Готово')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка загрузки'
    if (await isLocalBootstrapComplete()) {
      report(total, 'done', 'Готово')
      return { ok: true }
    }
    report(0, 'products', 'Ошибка', msg)
    return { ok: false, error: `${msg}. На слабом интернете нажмите «Повторить».` }
  }
}

/** После bootstrap: softSync / очередь (SYNC-канал выкл) */
export async function silentSyncFromServer(): Promise<void> {
  if (!isOnline()) return
  const alive = await pingApiForBootstrap(4000)
  if (!alive) return
  try {
    const { useOfflineSync } = await import('./offlineSync')
    void useOfflineSync.getState().syncNow()
  } catch { /* ignore */ }
  try {
    const { softSyncPosAfterSale, softSyncWarehouse, softSyncFinance } = await import('./posStore')
    void softSyncPosAfterSale({ force: true })
    void softSyncWarehouse()
    void softSyncFinance()
  } catch { /* ignore */ }
  try {
    const { syncClientsFromApi } = await import('./clientStore')
    const { syncCardsFromApi } = await import('./cardStore')
    void syncClientsFromApi()
    void syncCardsFromApi()
  } catch { /* ignore */ }
  await markLocalSyncAt()
}

export async function savePosSessionState(state: unknown): Promise<void> {
  const desk = getKakapoDesktop()
  if (desk?.localDbKvSet) {
    await desk.localDbKvSet('pos_session_state', state)
    return
  }
  try {
    localStorage.setItem('kakapo_offline_pos_session_state', JSON.stringify(state))
  } catch { /* ignore */ }
}

export async function loadPosSessionState<T>(): Promise<T | null> {
  const desk = getKakapoDesktop()
  if (desk?.localDbKvGet) {
    try {
      const v = await desk.localDbKvGet('pos_session_state')
      return (v as T) || null
    } catch { /* fallback */ }
  }
  try {
    const raw = localStorage.getItem('kakapo_offline_pos_session_state')
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
