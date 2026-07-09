'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { POS_CATEGORIES } from '@/lib/posCategories'
import type { Category } from '@/lib/types'

function staticFallback(): Category[] {
  return POS_CATEGORIES.map((c, i) => ({
    id: -(i + 1),
    name: c.name,
    slug: c.id,
    parent_id: null,
    emoji: c.e,
  }))
}

export function categorySlug(cat: Pick<Category, 'slug' | 'id'>) {
  return cat.slug || String(cat.id)
}

export function findCategoryName(categories: Category[], catId?: string, fallback = 'Прочее') {
  if (!catId) return fallback
  const hit = categories.find(c => c.slug === catId || String(c.id) === catId)
  return hit?.name || POS_CATEGORIES.find(c => c.id === catId)?.name || fallback
}

export function useTradeCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const data = await api.getCategories()
      setCategories(Array.isArray(data) && data.length ? data : staticFallback())
      setError('')
    } catch (e) {
      setCategories(staticFallback())
      setError(e instanceof Error ? e.message : 'Не удалось загрузить категории')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const roots = useMemo(() => categories.filter(c => c.parent_id == null), [categories])
  const childrenOf = useCallback((parentId: number) => (
    categories.filter(c => c.parent_id === parentId)
  ), [categories])

  const createCategory = useCallback(async (data: {
    name: string
    parent_id?: number | null
    slug?: string
    emoji?: string
  }) => {
    const created = await api.createCategory(data)
    await reload()
    return created as Category
  }, [reload])

  const deleteCategory = useCallback(async (id: number) => {
    await api.deleteCategory(id)
    await reload()
  }, [reload])

  return {
    categories,
    loaded,
    error,
    roots,
    childrenOf,
    reload,
    createCategory,
    deleteCategory,
  }
}
