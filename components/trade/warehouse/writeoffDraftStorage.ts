export const WRITEOFF_DRAFT_KEY = 'kakapo-writeoff-draft-v1'

export type WriteoffDraftLine = {
  key: string
  productId: number | null
  qty: string
}

export type WriteoffDraft = {
  open: boolean
  reason: string
  customReason: string
  note: string
  lines: WriteoffDraftLine[]
  activeLineKey: string | null
  scrollTop: number
}

export function emptyWriteoffLine(): WriteoffDraftLine {
  return { key: String(Date.now() + Math.random()), productId: null, qty: '' }
}

export function defaultWriteoffDraft(): WriteoffDraft {
  return {
    open: false,
    reason: 'Порча',
    customReason: '',
    note: '',
    lines: [emptyWriteoffLine()],
    activeLineKey: null,
    scrollTop: 0,
  }
}

export function loadWriteoffDraft(): WriteoffDraft {
  if (typeof window === 'undefined') return defaultWriteoffDraft()
  try {
    const raw = localStorage.getItem(WRITEOFF_DRAFT_KEY)
    if (!raw) return defaultWriteoffDraft()
    const parsed = JSON.parse(raw) as Partial<WriteoffDraft>
    return {
      ...defaultWriteoffDraft(),
      ...parsed,
      activeLineKey: parsed.activeLineKey ?? null,
      scrollTop: Number(parsed.scrollTop) || 0,
      lines: Array.isArray(parsed.lines) && parsed.lines.length
        ? parsed.lines.map(l => ({ ...emptyWriteoffLine(), ...l }))
        : [emptyWriteoffLine()],
    }
  } catch {
    return defaultWriteoffDraft()
  }
}

export function saveWriteoffDraft(draft: WriteoffDraft) {
  if (typeof window === 'undefined') return
  localStorage.setItem(WRITEOFF_DRAFT_KEY, JSON.stringify(draft))
}

export function clearWriteoffDraft() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(WRITEOFF_DRAFT_KEY)
}

const KNOWN_WRITEOFF_REASONS = ['Порча', 'Брак', 'Просрочка', 'Подарок', 'Внутреннее использование', 'Другое']

export function writeoffToDraft(writeoff: import('@/lib/types').StockWriteoff): WriteoffDraft {
  const known = KNOWN_WRITEOFF_REASONS.includes(writeoff.reason)
  return {
    open: true,
    reason: known ? writeoff.reason : 'Другое',
    customReason: known ? '' : writeoff.reason,
    note: writeoff.note || '',
    lines: [
      ...writeoff.items.map(it => ({
        key: `edit-${it.productId}-${Math.random()}`,
        productId: it.productId,
        qty: String(it.qty),
      })),
      emptyWriteoffLine(),
    ],
    activeLineKey: null,
    scrollTop: 0,
  }
}
