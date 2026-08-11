'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import OfflineNotice from './OfflineNotice'
import { USE_API } from '@/lib/config'
import { createStockWriteoffSafe } from '@/lib/offlineWarehouseOps'
import { softSyncWarehouse, usePosStore } from '@/lib/posStore'
import { useProducts } from '@/lib/store'
import type { Product } from '@/lib/types'
import WarehouseStockPanel from './warehouse/WarehouseStockPanel'
import WarehouseExpiryPanel, { type ExpiryRow } from './warehouse/WarehouseExpiryPanel'
import WarehouseReceiptsPanel from './warehouse/WarehouseReceiptsPanel'
import WarehouseRevisionsPanel from './warehouse/WarehouseRevisionsPanel'
import WarehouseWriteoffsPanel from './warehouse/WarehouseWriteoffsPanel'
import { loadWarehouseTab, saveWarehouseTab } from './warehouse/receiptDraftStorage'
import { WAREHOUSE_TABS, type WarehouseTab } from './warehouse/warehouseShared'

export default function WarehouseModule({
  products,
  search = '',
}: {
  products: Product[]
  search?: string
}) {
  const [tab, setTab] = useState<WarehouseTab>(() => loadWarehouseTab() || 'stock')
  const [expiryDays, setExpiryDays] = useState(14)
  const [expiry, setExpiry] = useState<ExpiryRow[]>([])
  const [expiryLoading, setExpiryLoading] = useState(false)
  const [refreshGen, setRefreshGen] = useState(0)
  /** Сначала рисуем шапку/вкладки — тяжёлую таблицу после paint */
  const [bodyReady, setBodyReady] = useState(false)

  const receipts = usePosStore(s => s.receipts)
  const writeoffs = usePosStore(s => s.writeoffs)
  const revisions = usePosStore(s => s.revisions)
  const suppliers = usePosStore(s => s.suppliers)
  const storeExpiry = usePosStore(s => s.expiry)
  const apiSyncing = usePosStore(s => s.apiSyncing)
  const apiError = usePosStore(s => s.apiError)
  const fetchProducts = useProducts(s => s.fetchProducts)

  useEffect(() => {
    saveWarehouseTab(tab)
  }, [tab])

  useEffect(() => {
    let cancelled = false
    const raf = window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (!cancelled) setBodyReady(true)
      }, 0)
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
    }
  }, [])

  const { totalStock, low, out } = useMemo(() => {
    let totalStock = 0
    let low = 0
    let out = 0
    for (const p of products) {
      const s = Number(p.stock) || 0
      totalStock += s
      if (s <= 0) out += 1
      else if (s <= 5) low += 1
    }
    return { totalStock, low, out }
  }, [products])

  const refreshAll = useCallback(async () => {
    // Слабый интернет: лёгкий sync склада, без reconcile + 13 эндпоинтов
    await Promise.all([
      softSyncWarehouse({ expiryDays }),
      fetchProducts(),
    ])
    setRefreshGen(g => g + 1)
    // Тяжёлую сверку остатков — только в фоне, не блокируем кнопку
    if (USE_API) {
      void api.reconcileStock().catch(() => undefined)
    }
  }, [fetchProducts, expiryDays])

  const loadExpiry = useCallback(async (days: number) => {
    // Сразу показываем локальный снимок
    const local = usePosStore.getState().expiry || []
    if (local.length) {
      setExpiry(local.filter(r => Number(r.daysLeft) <= days) as ExpiryRow[])
    }
    if (!USE_API) {
      if (!local.length) setExpiry([])
      return
    }
    setExpiryLoading(!local.length)
    try {
      const rows = await api.getStockExpiry(days)
      setExpiry(rows)
      usePosStore.setState({ expiry: rows })
    } catch {
      if (!local.length) setExpiry([])
    } finally {
      setExpiryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!bodyReady) return
    if (tab === 'expiry') void loadExpiry(expiryDays)
  }, [bodyReady, tab, expiryDays, loadExpiry])

  // Подтянуть сроки из стора, если уже были в snapshot
  useEffect(() => {
    if (tab !== 'expiry') return
    if (expiry.length || !storeExpiry.length) return
    setExpiry(storeExpiry.filter(r => Number(r.daysLeft) <= expiryDays) as ExpiryRow[])
  }, [tab, storeExpiry, expiry.length, expiryDays])

  const writeOffExpiredBatch = useCallback(async (row: ExpiryRow) => {
    if (!USE_API) return
    const res = await createStockWriteoffSafe({
      reason: 'Просрочка',
      note: `Партия из прихода ${row.receiptId}, срок ${row.expiryDate}`,
      items: [{ productId: row.productId, qty: row.qty }],
    })
    if (!res.offline) {
      void refreshAll()
      void loadExpiry(expiryDays)
    } else {
      void loadExpiry(expiryDays)
      void refreshAll()
    }
  }, [refreshAll, loadExpiry, expiryDays])

  return (
    <div className="k-wh-shell">
      <div className="k-wh-head">
        <div className="k-catalog-bar k-hide-mob" style={{ marginBottom: 0 }}>
          <div className="k-catalog-meta">
            <b>Склад</b>
            <span>
              {products.length} поз. · ост. {totalStock}
              {' · '}
              <span style={{ color: 'var(--gold)', fontWeight: 800 }}>мало {low}</span>
              {' · '}
              <span style={{ color: 'var(--red)', fontWeight: 800 }}>нет {out}</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
            {apiSyncing && (
              <span className="k-hide-mob" style={{ fontSize: 11, color: 'var(--muted)' }}>Обновление…</span>
            )}
            <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => void refreshAll()}>
              ↻ Обновить
            </button>
          </div>
        </div>

        {!USE_API && (
          <div className="k-trade-banner" style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12, background: '#2a2414', color: 'var(--gold)', border: '1px solid #5a4020' }}>
            Складские операции доступны только при подключении к API
          </div>
        )}

        <div className="k-hide-mob k-trade-banner">
          <OfflineNotice section="склад" mode="queue" />
          {apiError && (
            <div className="k-trade-banner" style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
              {apiError}
            </div>
          )}
        </div>

        <div className="k-subtabs k-seg-tabs" style={{ marginBottom: 0 }} role="tablist" aria-label="Разделы склада">
          {WAREHOUSE_TABS.map(t => {
            const count =
              t.id === 'receipts' ? receipts.length
                : t.id === 'writeoffs' ? writeoffs.length
                  : t.id === 'revisions' ? revisions.length
                    : t.id === 'expiry' ? expiry.length
                      : 0
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`k-subtab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="ic">{t.icon}</span>
                <span className="lbl">{t.label}</span>
                {count > 0 ? <span className="cnt">{count}</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="k-wh-body">
        {!bodyReady ? (
          <div className="k-empty" style={{ padding: '20px 12px' }}>
            Загрузка раздела…
          </div>
        ) : (
          <>
            {tab === 'stock' && (
              <WarehouseStockPanel
                products={products}
                search={search}
                onRefresh={refreshAll}
                refreshGen={refreshGen}
              />
            )}
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
                    products={products}
                    onDaysChange={setExpiryDays}
                    onWriteOff={writeOffExpiredBatch}
                  />
                )
            )}
          </>
        )}
      </div>
    </div>
  )
}
