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
