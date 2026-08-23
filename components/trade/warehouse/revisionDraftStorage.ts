export const REVISION_DRAFT_KEY = 'kakapo-revision-draft-v1'

import { revisionWaitDeviceKey } from '@/lib/revisionMeta'

export { revisionWaitDeviceKey }

export type RevisionMode = 'categories' | 'walk'

export type RevisionDraftLine = {
  key: string
  productId: number | null
  countedStock: string
  /** Остаток «в системе» на момент создания ревизии (для редактирования — иначе после
   *  сохранения товар уже получил новый остаток, и расхождение всегда показывало бы 0). */
  systemStock?: number
}

export type RevisionDraft = {
  open: boolean
  mode: RevisionMode
  note: string
  lines: RevisionDraftLine[]
  activeLineKey: string | null
  scrollTop: number
  /** posId::deviceId — кого ждать перед ± на сервере; null = дефолт из админки */
  waitDeviceKeys?: string[] | null
}

export function emptyRevisionLine(): RevisionDraftLine {
  return { key: String(Date.now() + Math.random()), productId: null, countedStock: '' }
}

export function defaultRevisionDraft(): RevisionDraft {
  return {
    open: false,
    mode: 'categories',
    note: '',
    lines: [emptyRevisionLine()],
    activeLineKey: null,
    scrollTop: 0,
  }
}

export function loadRevisionDraft(): RevisionDraft {
  if (typeof window === 'undefined') return defaultRevisionDraft()
  try {
    const raw = localStorage.getItem(REVISION_DRAFT_KEY)
    if (!raw) return defaultRevisionDraft()
    const parsed = JSON.parse(raw) as Partial<RevisionDraft>
    const mode: RevisionMode = parsed.mode === 'walk' ? 'walk' : 'categories'
    return {
      ...defaultRevisionDraft(),
      ...parsed,
      mode,
      activeLineKey: parsed.activeLineKey ?? null,
      scrollTop: Number(parsed.scrollTop) || 0,
      waitDeviceKeys: Array.isArray(parsed.waitDeviceKeys) ? parsed.waitDeviceKeys.map(String) : null,
      lines: Array.isArray(parsed.lines) && parsed.lines.length
        ? parsed.lines.map(l => ({ ...emptyRevisionLine(), ...l }))
        : [emptyRevisionLine()],
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
}

export function revisionToDraft(revision: import('@/lib/types').StockRevision): RevisionDraft {
  return {
    open: true,
    mode: 'categories',
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
  }
}
