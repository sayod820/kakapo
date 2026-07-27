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

/** Общий кэш — все хуки видят одни и те же категории, без мигания seed→API */
let memoryCategories: Category[] | null = null
let memoryLoaded = false
let inflight: Promise<Category[]> | null = null
const listeners = new Set<() => void>()

function notifyCategories() {
  listeners.forEach(l => l())
}

async function fetchCategoriesShared(): Promise<Category[]> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      if (USE_API) {
        const data = await api.getCategories()
        const list = Array.isArray(data) ? data : []
        memoryCategories = list
        memoryLoaded = true
        notifyCategories()
        return list
      }
      const seed = seedToCategories()
      memoryCategories = seed
      memoryLoaded = true
      notifyCategories()
      return seed
    } catch (e) {
      // При API не подставляем seed — иначе мигание «старое → новое»
      if (!USE_API) {
        const seed = seedToCategories()
        memoryCategories = seed
        memoryLoaded = true
        notifyCategories()
        return seed
      }
      memoryLoaded = true
      notifyCategories()
      throw e
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>(() => memoryCategories || [])
  const [loaded, setLoaded] = useState(() => memoryLoaded)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const list = await fetchCategoriesShared()
      setCategories(list)
      setError('')
    } catch (e) {
      // оставляем уже показанные категории из memory, без seed-фоллбэка
      if (memoryCategories) setCategories(memoryCategories)
      setError(e instanceof Error ? e.message : 'Не удалось загрузить категории')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      setCategories(memoryCategories || [])
      setLoaded(memoryLoaded)
    }
    listeners.add(sync)
    return () => { listeners.delete(sync) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const onSync = () => { void reload() }
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
    const created = await api.createCategory(data)
    await reload()
    window.dispatchEvent(new CustomEvent('kakapo:categories'))
    return created as Category
  }, [reload])

  const updateCategory = useCallback(async (id: number, data: Partial<Category>) => {
    const updated = await api.updateCategory(id, data)
    await reload()
    window.dispatchEvent(new CustomEvent('kakapo:categories'))
    return updated as Category
  }, [reload])

  const deleteCategory = useCallback(async (id: number) => {
    try {
      await api.deleteCategory(id)
    } catch (e) {
      throw e instanceof Error ? e : new Error('Не удалось удалить категорию')
    }
    await reload()
    window.dispatchEvent(new CustomEvent('kakapo:categories'))
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
    deleteCategory,
  }
}

// совместимость со старым импортом
export const useTradeCategories = useCategories
