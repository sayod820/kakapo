'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
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

export function categoryDisplayLabel(categories: Category[], catId?: string, fallback = 'Прочее') {
  const cat = getCategoryBySlug(categories, catId)
  if (!cat) return fallback
  const parent = cat.parent_id != null
    ? categories.find(c => c.id === Number(cat.parent_id))
    : null
  return parent ? `${parent.name} · ${cat.name}` : cat.name
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const data = await api.getCategories()
      setCategories(Array.isArray(data) ? data : [])
      setError('')
    } catch (e) {
      setCategories(seedToCategories())
      setError(e instanceof Error ? e.message : 'Не удалось загрузить категории')
    } finally {
      setLoaded(true)
    }
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
