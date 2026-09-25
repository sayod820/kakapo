/**
 * Выбор протокола входящего синка кассы.
 *
 * v2 (changeSeq) — основной путь, когда есть курсор. v1 (время) — первый pull
 * сессии, полный pull, CURSOR_EXPIRED, ошибка v2 и страховка раз в V1_BACKSTOP_MS.
 * Курсор v2 берётся из v1 только если его ещё нет или pull полный.
 */
import { changesToDeltaBags } from './syncChangeLogCore.mjs'

export const V1_BACKSTOP_MS = 30 * 60 * 1000
export const V2_PAGE_LIMIT = 1000
export const V2_MAX_PAGES = 20

/**
 * @param {{
 *   forceFull?: boolean,
 *   now: number,
 *   lastV1At: number,
 *   getV1Cursor: () => Promise<string>,
 *   getV2Cursor: () => Promise<number>,
 *   fetchV1: (since?: string) => Promise<any>,
 *   fetchV2: (cursor: number, limit: number) => Promise<any>,
 * }} deps
 * @returns {Promise<{ delta: any, mode: 'v1'|'v1-full'|'v2', v2Cursor: number|null, v1Cursor: string|null, reason?: string }>}
 */
export async function fetchInboundDelta(deps) {
  const v2Cursor = deps.forceFull ? 0 : (Number(await deps.getV2Cursor()) || 0)
  const backstopDue = !(deps.lastV1At > 0) || deps.now - deps.lastV1At >= V1_BACKSTOP_MS

  if (!deps.forceFull && v2Cursor > 0 && !backstopDue) {
    let reason = ''
    try {
      const changes = []
      let cursor = v2Cursor
      let head = null
      for (let page = 0; page < V2_MAX_PAGES; page++) {
        const res = await deps.fetchV2(cursor, V2_PAGE_LIMIT)
        if (res && res.code === 'CURSOR_EXPIRED') { reason = 'cursor_expired'; break }
        if (!res || res.ok !== true || res.protocol !== 'changeSeq') { reason = 'bad_response'; break }
        for (const ev of res.changes || []) changes.push(ev)
        const next = Number(res.nextCursor)
        if (Number.isFinite(next) && next > cursor) cursor = next
        if (res.serverHeadCursor != null) head = Number(res.serverHeadCursor)
        if (!res.hasMore) break
      }
      if (!reason) {
        const bags = changesToDeltaBags(changes)
        return {
          delta: { ...bags, full: false, since: null, cursor: '', stockLayersReplace: false, protocol: 'changeSeq', serverHeadCursor: head },
          mode: 'v2',
          v2Cursor: cursor,
          v1Cursor: null,
        }
      }
    } catch {
      reason = 'v2_error'
    }
    if (reason === 'cursor_expired') {
      const delta = await deps.fetchV1(undefined)
      return { delta, mode: 'v1-full', v2Cursor: adoptable(delta), v1Cursor: delta?.cursor || null, reason }
    }
    const since = await deps.getV1Cursor()
    const delta = await deps.fetchV1(since || undefined)
    return { delta, mode: 'v1', v2Cursor: null, v1Cursor: delta?.cursor || null, reason }
  }

  const since = deps.forceFull ? '' : await deps.getV1Cursor()
  const delta = await deps.fetchV1(since || undefined)
  const full = !since || !!delta?.full
  return {
    delta,
    mode: full ? 'v1-full' : 'v1',
    v2Cursor: full || v2Cursor <= 0 ? adoptable(delta) : null,
    v1Cursor: delta?.cursor || null,
  }
}

function adoptable(delta) {
  const n = Number(delta?.changeSeqCursor)
  return Number.isFinite(n) && n > 0 ? n : null
}
