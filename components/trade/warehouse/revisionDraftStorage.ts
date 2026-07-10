export const REVISION_DRAFT_KEY = 'kakapo-revision-draft-v1'

export type RevisionDraftLine = {
  key: string
  productId: number | null
  countedStock: string
}

export type RevisionDraft = {
  open: boolean
  note: string
  lines: RevisionDraftLine[]
  activeLineKey: string | null
  scrollTop: number
}

export function emptyRevisionLine(): RevisionDraftLine {
  return { key: String(Date.now() + Math.random()), productId: null, countedStock: '' }
}

export function defaultRevisionDraft(): RevisionDraft {
  return {
    open: false,
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
    return {
      ...defaultRevisionDraft(),
      ...parsed,
      activeLineKey: parsed.activeLineKey ?? null,
      scrollTop: Number(parsed.scrollTop) || 0,
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
    note: revision.note || '',
    lines: [
      ...revision.items.map(it => ({
        key: `edit-${it.productId}-${Math.random()}`,
        productId: it.productId,
        countedStock: String(it.countedStock),
      })),
      emptyRevisionLine(),
    ],
    activeLineKey: null,
    scrollTop: 0,
  }
}
