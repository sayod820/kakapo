import type { StockRevision } from './types'

/** После pull — подтянуть остатки, если ревизия стала done на сервере */
export async function refreshStockAfterRevisionsDone(
  prev: StockRevision[],
  next: StockRevision[],
): Promise<boolean> {
  const prevMap = new Map(prev.map(r => [r.id, r.status]))
  let becameDone = false
  for (const r of next) {
    const was = prevMap.get(r.id)
    if (r.status === 'done' && was && was !== 'done') becameDone = true
  }
  if (!becameDone) return false
  try {
    const { useProducts } = await import('./store')
    await useProducts.getState().fetchProducts()
  } catch { /* ignore */ }
  try {
    const { pullStockLayersFromServer } = await import('./stockLayersLocal')
    await pullStockLayersFromServer({ bumpProducts: true })
  } catch { /* ignore */ }
  return true
}
