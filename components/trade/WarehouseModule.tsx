'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { useProducts } from '@/lib/store'
import type { Product } from '@/lib/types'
import WarehouseStockPanel from './warehouse/WarehouseStockPanel'
import WarehouseExpiryPanel from './warehouse/WarehouseExpiryPanel'
import WarehouseReceiptsPanel from './warehouse/WarehouseReceiptsPanel'
import WarehouseRevisionsPanel from './warehouse/WarehouseRevisionsPanel'
import WarehouseWriteoffsPanel from './warehouse/WarehouseWriteoffsPanel'
import { WAREHOUSE_TABS, type WarehouseTab } from './warehouse/warehouseShared'

export default function WarehouseModule({ products }: { products: Product[] }) {
  const [tab, setTab] = useState<WarehouseTab>('stock')
  const [expiryDays, setExpiryDays] = useState(14)
  const [expiry, setExpiry] = useState<ReturnType<typeof usePosStore.getState>['expiry']>([])
  const [expiryLoading, setExpiryLoading] = useState(false)

  const receipts = usePosStore(s => s.receipts)
  const writeoffs = usePosStore(s => s.writeoffs)
  const revisions = usePosStore(s => s.revisions)
  const suppliers = usePosStore(s => s.suppliers)
  const apiSyncing = usePosStore(s => s.apiSyncing)
  const apiError = usePosStore(s => s.apiError)
  const fetchProducts = useProducts(s => s.fetchProducts)

  const totalStock = useMemo(() => products.reduce((s, p) => s + (Number(p.stock) || 0), 0), [products])
  const low = useMemo(() => products.filter(p => Number(p.stock) > 0 && Number(p.stock) <= 5).length, [products])
  const out = useMemo(() => products.filter(p => Number(p.stock) <= 0).length, [products])

  const refreshAll = useCallback(async () => {
    await Promise.all([syncPosFromApi(), fetchProducts()])
  }, [fetchProducts])

  const loadExpiry = useCallback(async (days: number) => {
    if (!USE_API) {
      setExpiry([])
      return
    }
    setExpiryLoading(true)
    try {
      const rows = await api.getStockExpiry(days)
      setExpiry(rows)
    } catch {
      setExpiry([])
    } finally {
      setExpiryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'expiry') void loadExpiry(expiryDays)
  }, [tab, expiryDays, loadExpiry])

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>🏬 Склад</h1>
          <div className="sub">Остатки, приход, списание, инвентаризация и сроки годности</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {apiSyncing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Обновление…</span>}
          <button type="button" className="k-btn k-btn-s" onClick={() => void refreshAll()}>↻ Обновить</button>
        </div>
      </div>

      {!USE_API && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a2414', color: 'var(--gold)', border: '1px solid #5a4020' }}>
          Складские операции доступны только при подключении к API
        </div>
      )}

      {apiError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
          {apiError}
        </div>
      )}

      <div className="k-kpis">
        <div className="k-kpi"><div className="kl">Позиций в каталоге</div><div className="kv">{products.length}</div></div>
        <div className="k-kpi"><div className="kl">Суммарный остаток</div><div className="kv">{totalStock}</div></div>
        <div className="k-kpi"><div className="kl">Мало на складе</div><div className="kv" style={{ color: 'var(--gold)' }}>{low}</div></div>
        <div className="k-kpi"><div className="kl">Нет в наличии</div><div className="kv" style={{ color: 'var(--red)' }}>{out}</div></div>
      </div>

      <div className="k-subtabs">
        {WAREHOUSE_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`k-subtab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
            {t.id === 'receipts' && receipts.length > 0 && ` (${receipts.length})`}
            {t.id === 'writeoffs' && writeoffs.length > 0 && ` (${writeoffs.length})`}
            {t.id === 'revisions' && revisions.length > 0 && ` (${revisions.length})`}
            {t.id === 'expiry' && expiry.length > 0 && ` (${expiry.length})`}
          </button>
        ))}
      </div>

      {tab === 'stock' && <WarehouseStockPanel products={products} />}
      {tab === 'receipts' && (
        <WarehouseReceiptsPanel
          receipts={receipts}
          suppliers={suppliers}
          products={products}
          onRefresh={refreshAll}
        />
      )}
      {tab === 'writeoffs' && (
        <WarehouseWriteoffsPanel
          writeoffs={writeoffs}
          products={products}
          onRefresh={refreshAll}
        />
      )}
      {tab === 'revisions' && (
        <WarehouseRevisionsPanel
          revisions={revisions}
          products={products}
          onRefresh={refreshAll}
        />
      )}
      {tab === 'expiry' && (
        expiryLoading
          ? <div className="k-empty">Загрузка…</div>
          : (
            <WarehouseExpiryPanel
              expiry={expiry}
              days={expiryDays}
              onDaysChange={setExpiryDays}
            />
          )
      )}

    </div>
  )
}
