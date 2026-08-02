'use client'

import MarketCategoriesPanel from '@/components/shared/MarketCategoriesPanel'
import type { Category, Product } from '@/lib/types'

export default function CategoryTab({
  categories,
  loaded,
  products,
  roots,
  childrenOf,
  onCreate,
  onUpdate,
  onReorder,
  onDelete,
  onDeleteMany,
}: {
  categories: Category[]
  loaded: boolean
  products: Product[]
  roots: Category[]
  childrenOf: (parentId: number) => Category[]
  onCreate: (data: {
    name: string
    parent_id?: number | null
    emoji?: string
    desc?: string
    order?: number
  }) => Promise<void>
  onUpdate: (id: number, data: Partial<Category>) => Promise<void>
  onReorder?: (items: { id: number; order: number }[]) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onDeleteMany?: (ids: number[]) => Promise<{ removed?: number; movedProducts?: number } | void>
}) {
  return (
    <MarketCategoriesPanel
      theme="trade"
      showStatus={false}
      categories={categories}
      loaded={loaded}
      products={products}
      roots={roots}
      childrenOf={childrenOf}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onReorder={onReorder}
      onDelete={onDelete}
      onDeleteMany={onDeleteMany}
    />
  )
}
