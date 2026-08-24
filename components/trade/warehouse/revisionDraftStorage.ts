export const REVISION_DRAFT_KEY = 'kakapo-revision-draft-v2'

import { revisionWaitDeviceKey } from '@/lib/revisionMeta'

export { revisionWaitDeviceKey }

export type RevisionMode = 'categories' | 'walk'
export type RevisionFlowStep = 'scope' | 'walk' | 'devices'
export type RevisionScopeStock = 'all' | 'in' | 'out'

export type RevisionDraftLine = {
  key: string
  productId: number | null
  countedStock: string
  /** Остаток «в системе» на момент создания ревизии */
  systemStock?: number
}

export type RevisionDraft = {
  open: boolean
  mode: RevisionMode
  flowStep: RevisionFlowStep
  note: string
  lines: RevisionDraftLine[]
  activeLineKey: string | null
  scrollTop: number
  /** posId::deviceId — кого ждать перед ± на сервере; null = дефолт из админки */
  waitDeviceKeys?: string[] | null
  scopeAllCats: boolean
  scopeCats: string[]
  scopeStock: RevisionScopeStock
  scopeLabel: string
}

export function emptyRevisionLine(): RevisionDraftLine {
  return { key: String(Date.now() + Math.random()), productId: null, countedStock: '' }
}

export function defaultRevisionDraft(): RevisionDraft {
  return {
    open: false,
    mode: 'walk',
    flowStep: 'scope',
    note: '',
    lines: [],
    activeLineKey: null,
    scrollTop: 0,
    scopeAllCats: true,
    scopeCats: [],
    scopeStock: 'all',
    scopeLabel: 'Все товары',
  }
}

function normalizeStock(v: unknown): RevisionScopeStock {
  if (v === 'in' || v === 'out') return v
  return 'all'
}

function normalizeFlowStep(v: unknown, hasLines: boolean): RevisionFlowStep {
  if (v === 'scope' || v === 'walk' || v === 'devices') return v
  return hasLines ? 'walk' : 'scope'
}

export function loadRevisionDraft(): RevisionDraft {
  if (typeof window === 'undefined') return defaultRevisionDraft()
  try {
    const raw = localStorage.getItem(REVISION_DRAFT_KEY)
      || localStorage.getItem('kakapo-revision-draft-v1')
    if (!raw) return defaultRevisionDraft()
    const parsed = JSON.parse(raw) as Partial<RevisionDraft>
    const lines = Array.isArray(parsed.lines) && parsed.lines.length
      ? parsed.lines.map(l => ({ ...emptyRevisionLine(), ...l }))
      : []
    const hasLines = lines.some(l => l.productId)
    return {
      ...defaultRevisionDraft(),
      ...parsed,
      mode: 'walk',
      flowStep: normalizeFlowStep(parsed.flowStep, hasLines),
      activeLineKey: parsed.activeLineKey ?? null,
      scrollTop: Number(parsed.scrollTop) || 0,
      waitDeviceKeys: Array.isArray(parsed.waitDeviceKeys) ? parsed.waitDeviceKeys.map(String) : null,
      scopeAllCats: parsed.scopeAllCats !== false,
      scopeCats: Array.isArray(parsed.scopeCats) ? parsed.scopeCats.map(String) : [],
      scopeStock: normalizeStock(parsed.scopeStock),
      scopeLabel: String(parsed.scopeLabel || 'Все товары'),
      lines,
    }
  } catch {
    return defaultRevisionDraft()
  }
}

export function saveRevisionDraft(draft: RevisionDraft) {
  if (typeof window === 'undefined') return
  localStorage.setItem(REVISION_DRAFT_KEY, JSON.stringify(draft))
}

export function clearRevisionDraft() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(REVISION_DRAFT_KEY)
  localStorage.removeItem('kakapo-revision-draft-v1')
}

export function revisionToDraft(revision: import('@/lib/types').StockRevision): RevisionDraft {
  return {
    open: true,
    mode: 'walk',
    flowStep: 'walk',
    note: revision.note || '',
    waitDeviceKeys: (revision.waitDevices || []).map(w => revisionWaitDeviceKey(w.posId, w.deviceId)),
    lines: [
      ...revision.items.map(it => ({
        key: `edit-${it.productId}-${Math.random()}`,
        productId: it.productId,
        countedStock: String(it.countedStock),
        systemStock: it.systemStock,
      })),
      emptyRevisionLine(),
    ],
    activeLineKey: null,
    scrollTop: 0,
    scopeAllCats: true,
    scopeCats: [],
    scopeStock: 'all',
    scopeLabel: 'Редактирование',
  }
}
