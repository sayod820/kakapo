// ════════════════════════════════════════════════
// KAKAPO — категории офлайн (Offline V2)
// ════════════════════════════════════════════════
import { api } from './api'
import { newClientRef } from './offline'
import { localFirstOp, type OfflineResult } from './localFirst'
import { isTradeLocalFirst, shadowMirrorPut } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import {
  applyCategoriesLocal,
  applyCategoryDeletion,
  peekCategories,
} from './useCategories'
import type { Category } from './types'

export type { OfflineResult }

/** Local-first: сразу локально, сервер в фоне. apiCall игнорируется. */
async function raceOp<T>(
  _apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  return localFirstOp(localApply)
}

function newLocalCategoryId(list: Category[]): number {
  let id = -Math.abs(Date.now() % 1_000_000_000)
  const used = new Set(list.map(c => Number(c.id)))
  while (used.has(id)) id -= 1
  return id
}

function isLocalCategoryId(id: number | undefined | null): boolean {
  const n = Number(id)
  return Number.isFinite(n) && n <= 0
}

function slugify(name: string, list: Category[], selfId?: number): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'cat'
  let slug = base
  let n = 2
  while (list.some(c => (c.slug === slug || String(c.id) === slug) && Number(c.id) !== selfId)) {
    slug = `${base}-${n}`
    n += 1
  }
  return slug
}

export type CategoryCreateInput = {
  name: string
  parent_id?: number | null
  slug?: string
  emoji?: string
  desc?: string
  order?: number
  active?: boolean
}

export async function createCategorySafe(data: CategoryCreateInput): Promise<OfflineResult<Category>> {
  if (!isTradeLocalFirst()) {
    const created = await api.createCategory(data) as Category
    shadowMirrorPut('product', `cat:${created.id}`, created)
    return { offline: false, data: created }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    const list = peekCategories()
    const localId = newLocalCategoryId(list)
    const cat: Category = {
      id: localId,
      name: String(data.name || '').trim() || 'Категория',
      slug: data.slug || slugify(data.name, list, localId),
      parent_id: data.parent_id ?? null,
      emoji: data.emoji || '📦',
      desc: data.desc || '',
      order: data.order ?? list.length,
      active: data.active !== false,
    }
    applyCategoriesLocal([...list, cat])
    await useOfflineSync.getState().queueOp(
      'category_upsert',
      { clientRef, localId: String(localId), category: { ...cat } },
      { localId: String(localId), clientRef },
    )
    shadowMirrorPut('product', `cat:${cat.id}`, cat)
    return cat
  }

  return raceOp(async () => {
    const created = await api.createCategory(data) as Category
    applyCategoriesLocal([...peekCategories().filter(c => c.id !== created.id), created])
    shadowMirrorPut('product', `cat:${created.id}`, created)
    return created
  }, applyLocal)
}

export async function updateCategorySafe(
  id: number,
  data: Partial<Category>,
): Promise<OfflineResult<Category>> {
  if (!isTradeLocalFirst()) {
    const updated = await api.updateCategory(id, data)
    shadowMirrorPut('product', `cat:${updated.id}`, updated)
    return { offline: false, data: updated }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    const list = peekCategories()
    const prev = list.find(c => Number(c.id) === id)
    if (!prev) throw new Error('Категория не найдена')
    const cat: Category = {
      ...prev,
      ...data,
      id,
      name: String(data.name ?? prev.name).trim() || prev.name,
      slug: data.slug || prev.slug,
    }
    applyCategoriesLocal(list.map(c => (Number(c.id) === id ? cat : c)))
    await useOfflineSync.getState().queueOp(
      'category_upsert',
      { clientRef, localId: String(id), category: { ...cat } },
      { localId: String(id), clientRef },
    )
    shadowMirrorPut('product', `cat:${cat.id}`, cat)
    return cat
  }

  if (isLocalCategoryId(id)) {
    const dataLocal = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data: dataLocal }
  }

  return raceOp(async () => {
    const updated = await api.updateCategory(id, data)
    applyCategoriesLocal(peekCategories().map(c => (Number(c.id) === updated.id ? updated : c)))
    shadowMirrorPut('product', `cat:${updated.id}`, updated)
    return updated
  }, applyLocal)
}

export async function reorderCategoriesSafe(
  items: { id: number; order: number }[],
): Promise<OfflineResult<{ ok: boolean }>> {
  if (!items.length) return { offline: false, data: { ok: true } }

  if (!isTradeLocalFirst()) {
    await api.reorderCategories(items)
    return { offline: false, data: { ok: true } }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    const orderMap = new Map(items.map(i => [Number(i.id), Number(i.order)]))
    applyCategoriesLocal(peekCategories().map(c => (
      orderMap.has(Number(c.id)) ? { ...c, order: orderMap.get(Number(c.id)) } : c
    )))
    await useOfflineSync.getState().queueOp(
      'category_reorder',
      { clientRef, items },
      { clientRef },
    )
    return { ok: true }
  }

  return raceOp(async () => {
    await api.reorderCategories(items)
    const orderMap = new Map(items.map(i => [Number(i.id), Number(i.order)]))
    applyCategoriesLocal(peekCategories().map(c => (
      orderMap.has(Number(c.id)) ? { ...c, order: orderMap.get(Number(c.id)) } : c
    )))
    return { ok: true }
  }, applyLocal)
}

export async function deleteCategorySafe(id: number): Promise<OfflineResult<{ id: number }>> {
  if (!isTradeLocalFirst()) {
    const res = await api.deleteCategory(id)
    applyCategoryDeletion({
      ids: res?.deleted?.length ? res.deleted : [id],
      slugs: res?.slugs,
    })
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    const list = peekCategories()
    const target = list.find(c => Number(c.id) === id)
    const childIds = list.filter(c => Number(c.parent_id) === id).map(c => Number(c.id))
    const ids = [id, ...childIds]
    applyCategoryDeletion({
      ids,
      slugs: target ? [target.slug] : undefined,
    })
    await useOfflineSync.getState().queueOp(
      'category_delete',
      { clientRef, id, ids },
      { clientRef },
    )
    return { id }
  }

  if (isLocalCategoryId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceOp(async () => {
    const res = await api.deleteCategory(id)
    applyCategoryDeletion({
      ids: res?.deleted?.length ? res.deleted : [id],
      slugs: res?.slugs,
    })
    return { id }
  }, applyLocal)
}

export async function deleteCategoriesSafe(
  ids: number[],
): Promise<OfflineResult<{ removed: number; movedProducts: number }>> {
  const unique = [...new Set((ids || []).map(Number).filter(n => Number.isFinite(n)))]
  if (!unique.length) return { offline: false, data: { removed: 0, movedProducts: 0 } }

  if (!isTradeLocalFirst()) {
    const res = await api.deleteCategories(unique.filter(id => id > 0))
    applyCategoryDeletion({
      ids: res?.deleted?.length ? res.deleted : unique,
      slugs: res?.slugs,
    })
    return {
      offline: false,
      data: {
        removed: Number(res?.removed) || unique.length,
        movedProducts: Number(res?.movedProducts) || 0,
      },
    }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    applyCategoryDeletion({ ids: unique })
    await useOfflineSync.getState().queueOp(
      'category_delete',
      { clientRef, ids: unique },
      { clientRef },
    )
    return { removed: unique.length, movedProducts: 0 }
  }

  if (unique.every(isLocalCategoryId)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceOp(async () => {
    const serverIds = unique.filter(id => id > 0)
    const res = serverIds.length
      ? await api.deleteCategories(serverIds)
      : { removed: 0, deleted: [] as number[], movedProducts: 0 }
    applyCategoryDeletion({
      ids: res?.deleted?.length ? res.deleted : unique,
      slugs: (res as any)?.slugs,
    })
    // локальные id тоже убрать
    applyCategoryDeletion({ ids: unique.filter(isLocalCategoryId) })
    return {
      removed: Number(res?.removed) || unique.length,
      movedProducts: Number((res as any)?.movedProducts) || 0,
    }
  }, applyLocal)
}
