'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { seedToCategories } from '@/lib/marketCategoriesSeed'
import type { Category } from '@/lib/types'

export function categorySlug(cat: Pick<Category, 'slug' | 'id'>) {
  return cat.slug || String(cat.id)
}

export function findCategoryName(categories: Category[], catId?: string, fallback = 'Прочее') {
  if (!catId) return fallback
  const hit = categories.find(c => c.slug === catId || String(c.id) === catId)
  return hit?.name || fallback
}

export function getCategoryBySlug(categories: Category[], slug?: string) {
  if (!slug) return null
  return categories.find(c => c.slug === slug || String(c.id) === slug) || null
}

/** slug категории + все подкатегории */
export function getDescendantSlugs(categories: Category[], slug: string): string[] {
  const cat = getCategoryBySlug(categories, slug)
  if (!cat) return [slug]
  const slugs = [categorySlug(cat)]
  for (const child of categories.filter(c => Number(c.parent_id) === cat.id)) {
    slugs.push(...getDescendantSlugs(categories, categorySlug(child)))
  }
  return slugs
}

export function productMatchesCategoryFilter(
  catId: string | undefined,
  filterSlug: string,
  categories: Category[],
) {
  if (filterSlug === 'all') return true
  return getDescendantSlugs(categories, filterSlug).includes(catId || '')
}

export function countProductsInCategory(
  products: { catId?: string }[],
  slug: string,
  categories: Category[],
) {
  const allowed = getDescendantSlugs(categories, slug)
  return products.filter(p => allowed.includes(p.catId || '')).length
}

export function getRootSlug(categories: Category[], slug?: string): string | null {
  if (!slug) return null
  const cat = getCategoryBySlug(categories, slug)
  if (!cat) return slug
  if (cat.parent_id == null) return categorySlug(cat)
  const parent = categories.find(c => c.id === Number(cat.parent_id))
  return parent ? categorySlug(parent) : categorySlug(cat)
}

export function buildAdminRootCats(roots: Category[]) {
  return roots.map(c => ({
    id: categorySlug(c),
    e: c.emoji || '📦',
    name: c.name,
  }))
}

export function buildAdminSelectCats(categories: Category[]) {
  const byId = new Map(categories.map(c => [c.id, c]))
  return categories
    .slice()
    .sort((a, b) => {
      const pa = a.parent_id != null ? byId.get(Number(a.parent_id)) : null
      const pb = b.parent_id != null ? byId.get(Number(b.parent_id)) : null
      const rootA = pa ? categorySlug(pa) : categorySlug(a)
      const rootB = pb ? categorySlug(pb) : categorySlug(b)
      if (rootA !== rootB) return rootA.localeCompare(rootB)
      if (a.parent_id == null && b.parent_id != null) return -1
      if (a.parent_id != null && b.parent_id == null) return 1
      return (a.order || 0) - (b.order || 0)
    })
    .map(c => {
      const parent = c.parent_id != null ? byId.get(Number(c.parent_id)) : null
      const prefix = parent ? `${parent.name} · ` : ''
      return {
        id: categorySlug(c),
        e: c.emoji || '📦',
        name: `${prefix}${c.name}`,
      }
    })
}

export function categoryDisplayLabel(categories: Category[], catId?: string, fallback = 'Прочее') {
  const cat = getCategoryBySlug(categories, catId)
  if (!cat) return fallback
  const parent = cat.parent_id != null
    ? categories.find(c => c.id === Number(cat.parent_id))
    : null
  return parent ? `${parent.name} · ${cat.name}` : cat.name
}

/** Общий кэш для торговли / магазина / админки — API источник правды */
export const CATEGORIES_CACHE_KEY = 'kakapo_categories_cache_v3'
const CACHE_KEY = CATEGORIES_CACHE_KEY
/** null = ещё не инициализировали; [] = с сервера реально пусто */
let memoryCategories: Category[] | null = null
let memoryLoaded = false
/** Успешный ответ API (в т.ч. пустой) — больше не подмешиваем seed */
let memoryFromApi = false
let inflight: Promise<Category[]> | null = null
const listeners = new Set<() => void>()

function notifyCategories() {
  listeners.forEach(l => l())
}

function readPersistedCategories(): Category[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY) || localStorage.getItem(CACHE_KEY)
    if (raw == null) return null
    const parsed = JSON.parse(raw)
    // Пустой массив тоже валиден (все категории удалены)
    return Array.isArray(parsed) ? parsed as Category[] : null
  } catch {
    return null
  }
}

function persistCategories(list: Category[]) {
  if (typeof window === 'undefined') return
  try {
    const raw = JSON.stringify(list)
    sessionStorage.setItem(CACHE_KEY, raw)
    localStorage.setItem(CACHE_KEY, raw)
  } catch { /* quota */ }
}

function setMemoryCategories(list: Category[], fromApi: boolean) {
  memoryCategories = list
  memoryLoaded = true
  if (fromApi) memoryFromApi = true
  if (fromApi || !USE_API) persistCategories(list)
  notifyCategories()
}

/** Локальная замена списка категорий (офлайн V2) */
export function applyCategoriesLocal(list: Category[]) {
  setMemoryCategories(list, memoryFromApi || USE_API)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kakapo:categories'))
  }
}

/** Текущий снимок категорий из памяти/кэша */
export function peekCategories(): Category[] {
  return memoryCategories ?? readPersistedCategories() ?? bootstrapCategories()
}

function bootstrapCategories(): Category[] {
  if (memoryCategories !== null) return memoryCategories
  const cached = readPersistedCategories()
  if (cached !== null) {
    memoryCategories = cached
    memoryLoaded = true
    // Кэш мог быть с API — не форсим seed поверх
    return cached
  }
  // Мгновенный показ до ответа сервера; после GET seed не вернётся
  const seed = seedToCategories()
  memoryCategories = seed
  memoryLoaded = true
  return seed
}

async function fetchCategoriesShared(opts?: { force?: boolean }): Promise<Category[]> {
  if (inflight && !opts?.force) return inflight
  if (opts?.force) inflight = null
  inflight = (async () => {
    try {
      if (USE_API) {
        const data = await api.getCategories()
        const list = Array.isArray(data) ? data : []
        // Важно: пустой список с сервера принимаем — иначе удалённые «воскресают» из seed
        setMemoryCategories(list, true)
        return list
      }
      const seed = seedToCategories()
      setMemoryCategories(seed, false)
      return seed
    } catch (e) {
      if (!USE_API) {
        const seed = seedToCategories()
        setMemoryCategories(seed, false)
        return seed
      }
      memoryLoaded = true
      notifyCategories()
      if (memoryCategories !== null) return memoryCategories
      throw e
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Мгновенно убрать категории из общего кэша (торговля + магазин + админка) */
export function applyCategoryDeletion(payload: {
  ids?: Array<number | string>
  slugs?: string[]
}) {
  const idSet = new Set((payload.ids || []).map(Number).filter(n => Number.isFinite(n)))
  const slugSet = new Set((payload.slugs || []).filter(Boolean))
  if (!idSet.size && !slugSet.size) return
  const cur = memoryCategories ?? readPersistedCategories() ?? []
  const next = cur.filter(c => {
    if (idSet.has(Number(c.id))) return false
    if (slugSet.has(c.slug) || slugSet.has(categorySlug(c))) return false
    return true
  })
  setMemoryCategories(next, memoryFromApi || USE_API)
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>(() => bootstrapCategories())
  const [loaded, setLoaded] = useState(() => true)
  const [error, setError] = useState('')

  const reload = useCallback(async (force = false) => {
    try {
      const list = await fetchCategoriesShared({ force })
      setCategories(list)
      setError('')
    } catch (e) {
      if (memoryCategories !== null) setCategories(memoryCategories)
      else setCategories(bootstrapCategories())
      setError(e instanceof Error ? e.message : 'Не удалось загрузить категории')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      setCategories(memoryCategories !== null ? memoryCategories : [])
      setLoaded(memoryLoaded)
    }
    listeners.add(sync)
    return () => { listeners.delete(sync) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const onSync = () => { void reload(true) }
    window.addEventListener('kakapo:categories', onSync)
    return () => window.removeEventListener('kakapo:categories', onSync)
  }, [reload])

  const roots = useMemo(
    () => categories.filter(c => c.parent_id == null).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [categories],
  )

  const childrenOf = useCallback((parentId: number) => (
    categories
      .filter(c => c.parent_id != null && Number(c.parent_id) === parentId)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  ), [categories])

  const createCategory = useCallback(async (data: {
    name: string
    parent_id?: number | null
    slug?: string
    emoji?: string
    desc?: string
    order?: number
    active?: boolean
  }) => {
    const { createCategorySafe } = await import('./offlineCategoryOps')
    const res = await createCategorySafe(data)
    if (!res.offline) await reload(true)
    window.dispatchEvent(new CustomEvent('kakapo:categories'))
    return res.data
  }, [reload])

  const updateCategory = useCallback(async (id: number, data: Partial<Category>) => {
    const { updateCategorySafe } = await import('./offlineCategoryOps')
    const res = await updateCategorySafe(id, data)
    if (!res.offline) await reload(true)
    window.dispatchEvent(new CustomEvent('kakapo:categories'))
    return res.data
  }, [reload])

  const reorderCategories = useCallback(async (items: { id: number; order: number }[]) => {
    if (!items.length) return
    const { reorderCategoriesSafe } = await import('./offlineCategoryOps')
    const res = await reorderCategoriesSafe(items)
    if (!res.offline) await reload(true)
    window.dispatchEvent(new CustomEvent('kakapo:categories'))
  }, [reload])

  const deleteCategory = useCallback(async (id: number) => {
    const { deleteCategorySafe } = await import('./offlineCategoryOps')
    try {
      const res = await deleteCategorySafe(id)
      if (!res.offline) await reload(true)
      window.dispatchEvent(new CustomEvent('kakapo:categories'))
    } catch (e) {
      throw e instanceof Error ? e : new Error('Не удалось удалить категорию')
    }
  }, [reload])

  const deleteCategories = useCallback(async (ids: number[]) => {
    const { deleteCategoriesSafe } = await import('./offlineCategoryOps')
    try {
      const res = await deleteCategoriesSafe(ids)
      if (!res.offline) await reload(true)
      window.dispatchEvent(new CustomEvent('kakapo:categories'))
      return res.data
    } catch (e) {
      throw e instanceof Error ? e : new Error('Не удалось удалить категории')
    }
  }, [reload])

  return {
    categories,
    loaded,
    error,
    roots,
    childrenOf,
    reload,
    createCategory,
    updateCategory,
    reorderCategories,
    deleteCategory,
    deleteCategories,
  }
}

// совместимость со старым импортом
export const useTradeCategories = useCategories
