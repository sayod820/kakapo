// ════════════════════════════════════════════════
// KAKAPO — первая установка локальной базы (один раз)
// Дальше работа из локалки; при интернете — тихий синк.
// ════════════════════════════════════════════════
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { isOnline, readCachedProducts } from './offline'
import { getApiUrl } from './config'

export type BootstrapStepId =
  | 'products'
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

const STEPS: { id: BootstrapStepId; label: string }[] = [
  { id: 'products', label: 'Товары и остатки' },
  { id: 'pos', label: 'Кассы, смены, сотрудники' },
  { id: 'clients', label: 'Клиенты' },
  { id: 'cards', label: 'Карты лояльности' },
]

/** Установка уже была: флаг на диске ИЛИ каталог уже скачан */
export async function isLocalBootstrapComplete(): Promise<boolean> {
  if (!isKakapoDesktop()) return true
  const desk = getKakapoDesktop()
  try {
    const info = await desk?.localDbInfo?.()
    if (info?.bootstrapComplete) return true
    if ((info as { hasCatalog?: boolean } | undefined)?.hasCatalog) return true
    const meta = await desk?.localDbMetaGet?.()
    if (meta?.bootstrapComplete || meta?.installComplete) return true
    // запасной путь: товары уже в локальном KV
    const products = await readCachedProducts()
    if (products && products.length > 0) {
      await markLocalBootstrapComplete()
      return true
    }
    return false
  } catch {
    try {
      const products = await readCachedProducts()
      return !!(products && products.length > 0)
    } catch {
      return false
    }
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

export async function pingApiForBootstrap(timeoutMs = 6000): Promise<boolean> {
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

/**
 * Один раз при установке/первом запуске — качает всё на диск ПК.
 */
export async function runLocalBootstrap(
  onProgress?: (p: BootstrapProgress) => void,
): Promise<{ ok: boolean; error?: string }> {
  const total = STEPS.length
  const report = (i: number, step: BootstrapStepId, label: string, error?: string) => {
    onProgress?.({ step, label, done: i, total, error })
  }

  if (!isKakapoDesktop()) return { ok: true }

  const alive = await pingApiForBootstrap()
  if (!alive) {
    return { ok: false, error: 'Нет интернета. Для первой установки подключите сеть.' }
  }

  try {
    const [{ useProducts }, { syncPosFromApi }, { syncClientsFromApi }, { syncCardsFromApi }] = await Promise.all([
      import('./store'),
      import('./posStore'),
      import('./clientStore'),
      import('./cardStore'),
    ])

    report(0, 'products', STEPS[0].label)
    await useProducts.getState().fetchProducts()
    report(1, 'products', STEPS[0].label)

    report(1, 'pos', STEPS[1].label)
    await syncPosFromApi()
    report(2, 'pos', STEPS[1].label)

    report(2, 'clients', STEPS[2].label)
    await syncClientsFromApi()
    report(3, 'clients', STEPS[2].label)

    report(3, 'cards', STEPS[3].label)
    await syncCardsFromApi()
    report(4, 'cards', STEPS[3].label)

    await markLocalBootstrapComplete()
    await markLocalSyncAt()
    report(total, 'done', 'Готово')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка загрузки'
    // если хоть товары успели лечь на диск — не считаем полный провал
    const products = await readCachedProducts()
    if (products && products.length > 0) {
      await markLocalBootstrapComplete()
      return { ok: true }
    }
    report(0, 'products', 'Ошибка', msg)
    return { ok: false, error: msg }
  }
}

/** Тихий синк при появлении интернета (остатки, цены, товары…) */
export async function silentSyncFromServer(): Promise<void> {
  if (!isOnline()) return
  const alive = await pingApiForBootstrap(4000)
  if (!alive) return
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
  ])
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
