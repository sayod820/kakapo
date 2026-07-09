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
  onDelete,
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
  }) => Promise<void>
  onUpdate: (id: number, data: Partial<Category>) => Promise<void>
  onDelete: (id: number) => Promise<void>
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
      onDelete={onDelete}
      headerExtra={(
        <div className="k-page-h" style={{ marginTop: 0, marginBottom: 12 }}>
          <div>
            <h1>📁 Категория</h1>
            <div className="sub">Те же категории, что в админке. Изменения синхронизируются автоматически.</div>
          </div>
        </div>
      )}
    />
  )
}
