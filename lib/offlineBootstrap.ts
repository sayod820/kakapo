// ════════════════════════════════════════════════
// KAKAPO — первая установка локальной базы (один раз)
// Дальше работа из локалки; при интернете — тихий синк.
// ════════════════════════════════════════════════
import { isKakapoDesktop } from './desktopBridge'
import { isTradeAndroidNative } from './tradeAndroid'
import { getLocalDb } from './localDbClient'

function needsLocalInstall(): boolean {
  return isKakapoDesktop() || isTradeAndroidNative()
}
import { cacheEmployeesAuth, isOnline, readCachedEmployeesAuth, readCachedProducts } from './offline'
import { authRowFromServer, hashEmployeePassword } from './employeePassword'
import { getApiUrl } from './config'
import { api } from './api'

const STEPS: { id: BootstrapStepId; label: string }[] = [
  { id: 'products', label: 'Товары и остатки' },
  { id: 'categories', label: 'Категории' },
  { id: 'pos', label: 'Кассы, смены, сотрудники' },
  { id: 'clients', label: 'Клиенты' },
  { id: 'cards', label: 'Карты лояльности' },
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
  | 'categories'
  | 'pos'
  | 'clients'
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

/** Готово только если на диске есть товары И сотрудники с паролями */
export async function isLocalBootstrapComplete(): Promise<boolean> {
  if (!needsLocalInstall()) return true
  try {
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
  const desk = getLocalDb()
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
  const desk = getLocalDb()
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
 * Один раз при первом запуске после установки — качает всё на диск ПК.
 * Потом касса работает локально без интернета.
 * Логин не показывают, пока нет товаров + паролей сотрудников.
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
    const [{ useProducts }, { syncPosFromApi }, { syncClientsFromApi }, { syncCardsFromApi }] = await Promise.all([
      import('./store'),
      import('./posStore'),
      import('./clientStore'),
      import('./cardStore'),
    ])

    report(0, 'products', STEPS[0].label)
    await withRetries('products', () => useProducts.getState().fetchProducts())
    report(1, 'products', STEPS[0].label)

    report(1, 'categories', STEPS[1].label)
    await withRetries('categories', async () => {
      const { api } = await import('./api')
      const { applyCategoriesLocal } = await import('./useCategories')
      const { cacheCategories } = await import('./offline')
      const data = await api.getCategories()
      const list = Array.isArray(data) ? data : []
      applyCategoriesLocal(list)
      await cacheCategories(list)
    })
    report(2, 'categories', STEPS[1].label)

    report(2, 'pos', STEPS[2].label)
    await withRetries('pos', () => syncPosFromApi())
    report(3, 'pos', STEPS[2].label)

    report(3, 'clients', STEPS[3].label)
    await withRetries('clients', () => syncClientsFromApi())
    report(4, 'clients', STEPS[3].label)

    report(4, 'cards', STEPS[4].label)
    await withRetries('cards', () => syncCardsFromApi())
    report(5, 'cards', STEPS[4].label)

    try {
      const { api } = await import('./api')
      const { cacheStockLayers } = await import('./stockLayersLocal')
      const layers = await api.getAllStockLayers()
      await cacheStockLayers(layers || [])
    } catch { /* партии подтянутся при синке */ }

    // Сотрудники с паролями — обязательно до экрана логина
    try {
      await withRetries('employees', () => cacheEmployeesForOfflineLogin(), 3)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось скачать сотрудников'
      report(5, 'pos', 'Сотрудники')
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

    await markLocalBootstrapComplete()
    await markLocalSyncAt()
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

/** Тихий синк при появлении интернета (остатки, цены, товары…) */
export async function silentSyncFromServer(): Promise<void> {
  if (!isOnline()) return
  const alive = await pingApiForBootstrap(4000)
  if (!alive) return
  try {
    const { getPending } = await import('./offline')
    const pending = await getPending()
    if (pending.some(r => !r.failed)) return
  } catch { /* ignore */ }
  try {
    const { pullSyncChanges } = await import('./syncPull')
    const res = await pullSyncChanges()
    if (res.ok) {
      await markLocalSyncAt()
      return
    }
  } catch { /* fallback */ }
  const [{ useProducts }, { syncPosFromApi }, { syncClientsFromApi }, { syncCardsFromApi }] = await Promise.all([
    import('./store'),
    import('./posStore'),
    import('./clientStore'),
    import('./cardStore'),
  ])
  await Promise.allSettled([
    useProducts.getState().fetchProducts(),
    syncPosFromApi(),
    syncClientsFromApi(),
    syncCardsFromApi(),
    cacheEmployeesForOfflineLogin(),
    (async () => {
      try {
        const { api } = await import('./api')
        const { applyCategoriesLocal } = await import('./useCategories')
        const { cacheCategories } = await import('./offline')
        const data = await api.getCategories()
        const list = Array.isArray(data) ? data : []
        applyCategoriesLocal(list)
        await cacheCategories(list)
      } catch { /* ignore */ }
    })(),
    (async () => {
      try {
        const { api } = await import('./api')
        const { cacheStockLayers } = await import('./stockLayersLocal')
        const layers = await api.getAllStockLayers()
        await cacheStockLayers(layers || [])
      } catch { /* ignore */ }
    })(),
  ])
  await markLocalSyncAt()
}

export async function savePosSessionState(state: unknown): Promise<void> {
  const desk = getLocalDb()
  if (desk?.localDbKvSet) {
    await desk.localDbKvSet('pos_session_state', state)
    return
  }
  try {
    localStorage.setItem('kakapo_offline_pos_session_state', JSON.stringify(state))
  } catch { /* ignore */ }
}

export async function loadPosSessionState<T>(): Promise<T | null> {
  const desk = getLocalDb()
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
