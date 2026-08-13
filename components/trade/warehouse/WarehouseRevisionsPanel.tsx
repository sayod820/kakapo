'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import {
  createStockRevisionSafe,
  deleteStockRevisionSafe,
  updateStockRevisionSafe,
} from '@/lib/offlineWarehouseOps'
import { useProducts } from '@/lib/store'
import { useCategories } from '@/lib/useCategories'
import type { Product, ProductStockLayer, StockRevision } from '@/lib/types'
import WarehousePeriodFilter from './WarehousePeriodFilter'
import WarehouseProductSelect from './WarehouseProductSelect'
import RevisionScopePanel from './RevisionScopePanel'
import RevisionStepBar from './RevisionStepBar'
import ProductEditModal from '@/components/trade/products/ProductEditModal'
import {
  clearRevisionDraft,
  defaultRevisionDraft,
  emptyRevisionLine,
  loadRevisionDraft,
  revisionToDraft,
  saveRevisionDraft,
  type RevisionDraft,
  type RevisionDraftLine,
} from './revisionDraftStorage'
import { filterProductsBySearch } from '@/lib/productBarcodes'
import {
  fmtDateTime,
  fmtMoney,
  formatQty,
  isGramLabel,
  isKgLabel,
  liveProductStock,
  matchesDateRange,
  packInputUnitLabel,
  packRealWorld,
  parsePackUnit,
  sanitizeDecimalInput,
} from './warehouseShared'

function diffStyle(diff: number) {
  if (diff === 0) return { color: 'var(--muted)' }
  if (diff > 0) return { color: 'var(--green)' }
  return { color: 'var(--red)' }
}

function formatDiff(diff: number) {
  const rounded = Math.round(diff * 1000) / 1000
  if (rounded === 0) return '0'
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

function formatMoneyDiff(n: number) {
  if (n === 0) return fmtMoney(0)
  return `${n > 0 ? '+' : '−'}${fmtMoney(Math.abs(n))}`
}

/** Закупочная цена, а если её нет — розничная (чтобы сумма расхождения считалась всегда). */
function moneyBasisPrice(product: Product | undefined | null): number {
  if (!product) return 0
  const cost = Number(product.costPrice) || 0
  if (cost > 0) return cost
  return Number(product.price) || 0
}

/**
 * Остаток «в системе»:
 * - редактирование сохранённой ревизии → зафиксированный systemStock;
 * - новая ревизия → живой остаток по партиям (не устаревший product.stock).
 */
function lineSystemStock(
  line: RevisionDraftLine,
  product: Product | null | undefined,
  liveStock: number,
  freezeSystem: boolean,
): number {
  if (freezeSystem && line.systemStock != null) return line.systemStock
  return liveStock
}

function isLineChecked(line: RevisionDraftLine): boolean {
  return line.checked === true
}

function RevisionLineCard({
  line,
  idx,
  product,
  liveStock,
  freezeSystem,
  active,
  canRemove,
  onRemove,
  onActivate,
  onCounted,
  onMatchSystem,
  onZero,
  onConfirm,
  onEditProduct,
  cardRef,
  countedRef,
}: {
  line: RevisionDraftLine
  idx: number
  product: Product
  liveStock: number
  freezeSystem: boolean
  active: boolean
  canRemove: boolean
  onRemove: () => void
  onActivate: () => void
  onCounted: (v: string) => void
  onMatchSystem: () => void
  onZero: () => void
  onConfirm: () => void
  onEditProduct: () => void
  cardRef: (el: HTMLDivElement | null) => void
  countedRef: (el: HTMLInputElement | null) => void
}) {
  const packInfo = parsePackUnit(product.unit)
  const isWeightUnit = product.sellType === 'weight' || isGramLabel(packInfo.label) || isKgLabel(packInfo.label)
  const inputUnitLabel = packInputUnitLabel(packInfo)
  const system = lineSystemStock(line, product, liveStock, freezeSystem)
  const counted = line.countedStock !== '' ? Number(line.countedStock) : null
  const checked = isLineChecked(line)
  const diff = counted != null ? counted - system : null
  const costPrice = Number(product.costPrice) || 0
  const basisPrice = moneyBasisPrice(product)
  const costDiff = diff != null && basisPrice > 0 ? diff * basisPrice : null
  const systemReal = packRealWorld(system, packInfo)
  const diffReal = diff != null ? packRealWorld(diff, packInfo) : null

  const tone =
    active ? 'on'
      : !checked ? 'pending'
        : diff != null && diff !== 0 ? (diff > 0 ? 'up' : 'down')
          : ''

  return (
    <div
      ref={cardRef}
      onClick={onActivate}
      className={`k-rev-line${tone ? ` is-${tone}` : ''}`}
    >
      <div className="k-rev-line-top">
        <span className="k-rev-line-n">{idx + 1}</span>
        <span className="k-rev-line-emo">{product.e || '📦'}</span>
        <div className="k-rev-line-txt">
          <b>{product.name}</b>
          <small>
            {product.art || '—'} · система <b>{system}</b>{packInfo.qty !== 1 && ' уп.'}
            {systemReal && <> ({formatQty(systemReal.value)} {systemReal.label})</>}
          </small>
        </div>
        <div className="k-rev-line-btns">
          <button type="button" className="k-btn k-btn-s" title="Редактор товара" onClick={e => { e.stopPropagation(); onEditProduct() }}>✎</button>
          {!checked && (
            <button type="button" className="k-btn k-btn-s" title="Подтвердить как есть" onClick={e => { e.stopPropagation(); onConfirm() }}>✓</button>
          )}
          <button type="button" className="k-btn k-btn-s" title={`Как в системе (${system})`} onClick={e => { e.stopPropagation(); onMatchSystem() }}>⟲</button>
          <button type="button" className="k-btn k-btn-s" title="Факт = 0" onClick={e => { e.stopPropagation(); onZero() }}>0</button>
          {canRemove && (
            <button type="button" className="k-btn k-btn-s k-rev-x" title="Удалить" onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>
          )}
        </div>
      </div>
      <div className="k-rev-line-grid">
        <div className="k-field">
          <label>Факт ({inputUnitLabel})</label>
          <input
            ref={countedRef}
            className="k-inp"
            type="text"
            inputMode={isWeightUnit ? 'decimal' : 'numeric'}
            value={line.countedStock}
            placeholder={`система ${system}`}
            onChange={e => onCounted(sanitizeDecimalInput(e.target.value))}
            onClick={e => e.stopPropagation()}
          />
        </div>
        <div className={`k-rev-line-diff${!checked ? ' pending' : diff != null && diff !== 0 ? (diff > 0 ? ' up' : ' down') : ' ok'}`}>
          {!checked ? (
            <b className="k-rev-pending">не посчитано</b>
          ) : diff != null && diff !== 0 ? (
            <>
              <b style={diffStyle(diff)}>{formatDiff(diff)} {inputUnitLabel}</b>
              {diffReal && (
                <span style={diffStyle(diffReal.value)}>= {formatDiff(diffReal.value)} {diffReal.label}</span>
              )}
              {basisPrice > 0 && (
                <span style={diffStyle(costDiff ?? 0)}>
                  {formatMoneyDiff(costDiff ?? 0)}
                  {costPrice <= 0 && ' · розн.'}
                </span>
              )}
            </>
          ) : (
            <b>✓ OK</b>
          )}
        </div>
      </div>
    </div>
  )
}

export default function WarehouseRevisionsPanel({
  revisions,
  products,
  onRefresh,
}: {
  revisions: StockRevision[]
  products: Product[]
  onRefresh: () => Promise<void>
}) {
  const fetchProducts = useProducts(s => s.fetchProducts)
  const { categories } = useCategories()
  const [draft, setDraft] = useState<RevisionDraft>(defaultRevisionDraft)
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [modalStep, setModalStep] = useState<'scope' | 'count'>('scope')
  const [scopeLabel, setScopeLabel] = useState('Все категории')
  const [countSearch, setCountSearch] = useState('')
  const [countFilter, setCountFilter] = useState<'all' | 'pending' | 'done' | 'diff'>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editProductId, setEditProductId] = useState<string | null>(null)
  const [layers, setLayers] = useState<ProductStockLayer[]>([])
  const [layersLoaded, setLayersLoaded] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const countedRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const { open, note, lines, activeLineKey } = draft
  const freezeSystem = Boolean(editingId)

  const layersByProduct = useMemo(() => {
    const map = new Map<number, ProductStockLayer[]>()
    for (const layer of layers) {
      const list = map.get(layer.productId) || []
      list.push(layer)
      map.set(layer.productId, list)
    }
    return map
  }, [layers])

  const stockOf = useCallback((product: Product | null | undefined) => {
    if (!product) return 0
    return liveProductStock(product, layersByProduct.get(product.id), layersLoaded)
  }, [layersByProduct, layersLoaded])

  const loadLayers = useCallback(async () => {
    try {
      const { loadStockLayersCacheFirst } = await import('@/lib/stockLayersLocal')
      const cached = await loadStockLayersCacheFirst(remote => {
        setLayers(remote)
        setLayersLoaded(true)
      })
      setLayers(cached)
    } catch {
      /* keep previous */
    } finally {
      setLayersLoaded(true)
    }
  }, [])

  useEffect(() => {
    void loadLayers()
  }, [loadLayers])

  useEffect(() => {
    if (open) void loadLayers()
  }, [open, loadLayers])

  useEffect(() => {
    const loaded = loadRevisionDraft()
    // В новой ревизии не держим устаревший systemStock из черновика
    if (!editingId && loaded.lines?.length) {
      loaded.lines = loaded.lines.map(l => ({ ...l, systemStock: undefined }))
    }
    setDraft(loaded)
    if (loaded.open && loaded.lines.some(l => l.productId)) {
      setModalStep('count')
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveRevisionDraft(draft)
  }, [draft, hydrated])

  const setDraftPatch = useCallback((patch: Partial<RevisionDraft>) => {
    setDraft(prev => ({ ...prev, ...patch }))
  }, [])

  const updateLine = useCallback((key: string, patch: Partial<RevisionDraftLine>) => {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => (l.key === key ? { ...l, ...patch } : l)),
    }))
  }, [])

  function resetForm() {
    clearRevisionDraft()
    setDraft(defaultRevisionDraft())
    setEditingId(null)
    setModalStep('scope')
    setScopeLabel('Все категории')
    setCountSearch('')
    setCountFilter('all')
    setAddOpen(false)
    setEditProductId(null)
    setMsg('')
  }

  function openForm() {
    setEditingId(null)
    setModalStep('scope')
    setScopeLabel('Все категории')
    setCountSearch('')
    setCountFilter('all')
    setAddOpen(false)
    setEditProductId(null)
    setDraft({ ...defaultRevisionDraft(), open: true })
    setMsg('')
  }

  function openEditForm(revision: StockRevision) {
    setEditingId(revision.id)
    setModalStep('count')
    setScopeLabel('Редактирование')
    setCountSearch('')
    setCountFilter('all')
    setAddOpen(false)
    setEditProductId(null)
    setDraft(revisionToDraft(revision))
    setMsg('')
  }

  function closeForm() {
    setAddOpen(false)
    setEditProductId(null)
    setDraft(prev => ({ ...prev, open: false }))
    if (editingId) {
      setEditingId(null)
      setModalStep('scope')
      setScopeLabel('Все категории')
    }
    setMsg('')
  }

  function fillLineFromProduct(line: RevisionDraftLine, product: Product): RevisionDraftLine {
    const stock = stockOf(product)
    const keepCounted = line.countedStock !== ''
    return {
      ...line,
      productId: product.id,
      countedStock: keepCounted ? line.countedStock : String(stock),
      checked: keepCounted ? isLineChecked(line) : false,
      // Новая ревизия всегда берёт живой остаток по партиям
      systemStock: undefined,
    }
  }

  async function startCountFromScope(toAdd: Product[], label: string) {
    if (!toAdd.length) return
    // Не ждём сеть — берём уже загруженный/кэшированный остаток
    let source = layers
    if (!layersLoaded || !source.length) {
      try {
        const { readCachedStockLayers } = await import('@/lib/stockLayersLocal')
        const cached = await readCachedStockLayers()
        if (cached.length) {
          source = cached
          setLayers(cached)
          setLayersLoaded(true)
        }
      } catch { /* ignore */ }
    }
    const byProduct = new Map<number, ProductStockLayer[]>()
    for (const layer of source) {
      const list = byProduct.get(layer.productId) || []
      list.push(layer)
      byProduct.set(layer.productId, list)
    }
    void loadLayers()
    setScopeLabel(label)
    setCountSearch('')
    setCountFilter('pending')
    setDraft(prev => ({
      ...prev,
      lines: [
        ...toAdd.map(p => ({
          key: `rev-${p.id}-${Math.random()}`,
          productId: p.id,
          countedStock: String(liveProductStock(p, byProduct.get(p.id), true)),
          checked: false,
        })),
        emptyRevisionLine(),
      ],
      activeLineKey: null,
    }))
    setModalStep('count')
    setMsg('')
  }

  function backToScope() {
    if (editingId) return
    if (filledLines.length && !confirm('Вернуться к выбору категорий? Текущий пересчёт будет сброшен.')) return
    setModalStep('scope')
    setDraft(prev => ({ ...prev, lines: [emptyRevisionLine()], activeLineKey: null }))
    setMsg('')
  }

  function selectProduct(key: string, product: Product | null) {
    if (!product) {
      updateLine(key, { productId: null, countedStock: '', checked: false, systemStock: undefined })
      return
    }
    const existing = lines.find(l => l.productId === product.id && l.key !== key)
    if (existing) {
      setDraftPatch({ activeLineKey: existing.key })
      setDraft(prev => ({
        ...prev,
        lines: prev.lines.filter(l => l.key !== key || l.productId !== null),
      }))
      setTimeout(() => countedRefs.current[existing.key]?.focus(), 80)
      return
    }
    const filled = fillLineFromProduct(lines.find(l => l.key === key)!, product)
    setDraft(prev => {
      const nextLines = prev.lines.map(l => (l.key === key ? filled : l))
      const hasEmpty = nextLines.some(l => !l.productId)
      return {
        ...prev,
        lines: hasEmpty ? nextLines : [...nextLines, emptyRevisionLine()],
        activeLineKey: key,
      }
    })
    setTimeout(() => countedRefs.current[key]?.focus(), 80)
  }

  function addProductFromFind(product: Product) {
    setAddOpen(false)
    setDraft(prev => {
      const existing = prev.lines.find(l => l.productId === product.id)
      if (existing) {
        return { ...prev, activeLineKey: existing.key }
      }
      let pending = prev.lines.find(l => !l.productId)
      let nextLines = prev.lines
      if (!pending) {
        pending = emptyRevisionLine()
        nextLines = [...nextLines, pending]
      }
      const filled = fillLineFromProduct(pending, product)
      const mapped = nextLines.map(l => (l.key === pending!.key ? filled : l))
      const hasEmpty = mapped.some(l => !l.productId)
      return {
        ...prev,
        lines: hasEmpty ? mapped : [...mapped, emptyRevisionLine()],
        activeLineKey: pending.key,
      }
    })
  }

  const onBodyScroll = useCallback(() => {
    if (bodyRef.current) setDraftPatch({ scrollTop: bodyRef.current.scrollTop })
  }, [setDraftPatch])

  const totals = useMemo(() => {
    let count = 0
    let matched = 0
    let surplus = 0
    let shortage = 0
    let netDiff = 0
    let costMoneyDiff = 0
    for (const l of lines) {
      if (!l.productId || l.countedStock === '') continue
      const product = products.find(p => p.id === l.productId)
      if (!product) continue
      const system = lineSystemStock(l, product, stockOf(product), freezeSystem)
      const counted = Number(l.countedStock) || 0
      const diff = counted - system
      count++
      netDiff += diff
      costMoneyDiff += diff * moneyBasisPrice(product)
      if (diff === 0) matched++
      else if (diff > 0) surplus += diff
      else shortage += Math.abs(diff)
    }
    return { count, matched, surplus, shortage, netDiff, costMoneyDiff, withProduct: lines.filter(l => l.productId).length }
  }, [lines, products, stockOf, freezeSystem])

  const listStats = useMemo(() => {
    let surplusDocs = 0
    let shortageDocs = 0
    let matchedDocs = 0
    let totalMoneyDiff = 0
    for (const rev of revisions) {
      const totalDiff = rev.items.reduce((s, it) => s + it.diff, 0)
      if (totalDiff > 0) surplusDocs++
      else if (totalDiff < 0) shortageDocs++
      else matchedDocs++
      for (const it of rev.items) {
        const product = products.find(p => p.id === it.productId)
        totalMoneyDiff += it.diff * moneyBasisPrice(product)
      }
    }
    return { surplusDocs, shortageDocs, matchedDocs, totalMoneyDiff }
  }, [revisions, products])

  const filtered = useMemo(() => {
    return revisions.filter(rev => matchesDateRange(rev.createdAtIso, dateFrom, dateTo))
  }, [revisions, dateFrom, dateTo])

  const editingRevision = editingId ? revisions.find(r => r.id === editingId) || null : null

  const filledLines = lines.filter(l => l.productId)
  const pendingCount = useMemo(
    () => filledLines.filter(l => !isLineChecked(l)).length,
    [filledLines],
  )
  const visibleFilledLines = useMemo(() => {
    let list = filledLines
    if (countFilter === 'pending') {
      list = list.filter(l => !isLineChecked(l))
    } else if (countFilter === 'done') {
      list = list.filter(l => isLineChecked(l))
    } else if (countFilter === 'diff') {
      list = list.filter(l => {
        if (!isLineChecked(l) || l.countedStock === '' || !l.productId) return false
        const product = products.find(p => p.id === l.productId)
        if (!product) return false
        const system = lineSystemStock(l, product, stockOf(product), freezeSystem)
        return (Number(l.countedStock) || 0) !== system
      })
    }
    if (!countSearch.trim()) return list
    const q = countSearch.trim()
    return list.filter(l => {
      const product = products.find(p => p.id === l.productId)
      return product && filterProductsBySearch([product], q).length > 0
    })
  }, [filledLines, countFilter, countSearch, products, stockOf, freezeSystem])
  const hasDraft = !editingId && lines.some(l => l.productId || l.countedStock)

  async function submit() {
    const items = lines
      .filter(l => l.productId != null && l.countedStock !== '')
      .map(l => ({ productId: l.productId!, countedStock: Number(l.countedStock) }))
    if (!items.length) {
      setMsg('Добавьте товары и укажите фактический остаток')
      return
    }
    const unchecked = filledLines.filter(l => !isLineChecked(l)).length
    if (unchecked > 0) {
      if (!confirm(
        `Не подтверждено: ${unchecked} из ${filledLines.length}.\n\nПровести ревизию по всем ${items.length} позициям (факт уже заполнен из системы)? Непроверенные войдут как есть.`,
      )) return
    }
    setSaving(true)
    setMsg('')
    try {
      const payload = { note: note.trim() || undefined, items }
      const res = editingId
        ? await updateStockRevisionSafe(editingId, payload)
        : await createStockRevisionSafe(payload)
      if (!res.offline) {
        void Promise.all([onRefresh(), fetchProducts(), loadLayers()])
      } else {
        setMsg('Ревизия сохранена локально · отправится при связи')
      }
      resetForm()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  async function removeRevision(id: string) {
    const revision = revisions.find(r => r.id === id)
    if (!revision) return
    if (!confirm(`Удалить ревизию от ${fmtDateTime(revision.createdAtIso)}?\n\nОстатки вернутся к значениям до ревизии.`)) return
    setDeletingId(id)
    try {
      const res = await deleteStockRevisionSafe(id)
      if (editingId === id) resetForm()
      if (expanded === id) setExpanded(null)
      if (!res.offline) {
        void Promise.all([onRefresh(), fetchProducts(), loadLayers()])
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить ревизию')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="k-wh-revisions">
      <div className="k-wh-panel-head">
        <div className="k-wh-meta">
          <span className="k-wh-meta-count"><b>{revisions.length}</b> ревизий</span>
          <div className="k-wh-money">
            <span>Излишек <b style={{ color: 'var(--green)' }}>{listStats.surplusDocs}</b></span>
            <span>Недостача <b style={{ color: 'var(--red)' }}>{listStats.shortageDocs}</b></span>
            <span>ОК <b style={{ color: 'var(--muted)' }}>{listStats.matchedDocs}</b></span>
            <span>
              {listStats.totalMoneyDiff < 0 ? 'Убыток' : 'Закуп'}{' '}
              <b style={diffStyle(listStats.totalMoneyDiff)}>
                {listStats.totalMoneyDiff !== 0 ? formatMoneyDiff(listStats.totalMoneyDiff) : '—'}
              </b>
            </span>
          </div>
        </div>

        <div className="k-wh-filters-row">
          <WarehousePeriodFilter
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            onClear={() => { setDateFrom(''); setDateTo('') }}
          />
          {(dateFrom || dateTo) && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              <b style={{ color: 'var(--text)' }}>{filtered.length}</b> / {revisions.length}
            </span>
          )}
          <div className="k-wh-cta" style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {hasDraft && !open && (
              <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700 }}>● Черновик</span>
            )}
            <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openForm}>
              + Новая ревизия
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="k-wh-fab"
        disabled={!USE_API || open}
        onClick={openForm}
        aria-label="Новая ревизия"
        title={hasDraft && !open ? 'Черновик ревизии' : 'Новая ревизия'}
      >
        +
      </button>

      {!filtered.length ? (
        <div className="k-empty">
          {revisions.length ? 'За выбранный период ревизий нет' : 'Ревизий пока нет — нажмите «Новая ревизия»'}
        </div>
      ) : (
        <>
          <div className="k-wh-cards">
            {filtered.map(rev => {
              const surplus = rev.items.reduce((s, it) => s + (it.diff > 0 ? it.diff : 0), 0)
              const shortage = rev.items.reduce((s, it) => s + (it.diff < 0 ? Math.abs(it.diff) : 0), 0)
              const totalDiff = rev.items.reduce((s, it) => s + it.diff, 0)
              const costMoneyDiff = rev.items.reduce((s, it) => {
                const product = products.find(p => p.id === it.productId)
                return s + it.diff * moneyBasisPrice(product)
              }, 0)
              const isOpen = expanded === rev.id
              return (
                <div key={rev.id} className="k-wh-card k-rev-card">
                  <div className="k-wh-card-top" onClick={() => setExpanded(isOpen ? null : rev.id)}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{fmtDateTime(rev.createdAtIso)}</div>
                      {rev.note ? (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rev.note}
                        </div>
                      ) : null}
                    </div>
                    <b style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{rev.items.length} поз.</b>
                  </div>
                  <div className="k-wh-card-meta" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                    <div>
                      <div className="l">Излишек</div>
                      <div className="v" style={{ color: surplus > 0 ? 'var(--green)' : 'var(--muted)' }}>
                        {surplus > 0 ? `+${formatQty(surplus)}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="l">Недостача</div>
                      <div className="v" style={{ color: shortage > 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {shortage > 0 ? formatQty(shortage) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="l">Δ</div>
                      <div className="v" style={diffStyle(totalDiff)}>{formatDiff(totalDiff)}</div>
                    </div>
                    <div>
                      <div className="l">Σ закуп</div>
                      <div className="v" style={diffStyle(costMoneyDiff)}>
                        {costMoneyDiff !== 0 ? formatMoneyDiff(costMoneyDiff) : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="k-wh-card-actions" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                    <button type="button" className="k-btn k-btn-s" disabled={!USE_API} onClick={() => openEditForm(rev)}>✎</button>
                    <button
                      type="button"
                      className="k-btn k-btn-s"
                      style={{ color: 'var(--red)' }}
                      disabled={!USE_API || deletingId === rev.id}
                      onClick={() => void removeRevision(rev.id)}
                    >
                      {deletingId === rev.id ? '…' : '🗑'}
                    </button>
                    <button type="button" className="k-btn k-btn-s" style={{ minWidth: 44 }} onClick={() => setExpanded(isOpen ? null : rev.id)}>
                      {isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="k-wh-card-detail k-rev-card-detail">
                      {rev.items.map((it, i) => {
                        const product = products.find(p => p.id === it.productId)
                        const barcode = product?.barcode || product?.barcodes?.[0] || ''
                        const costPrice = Number(product?.costPrice) || 0
                        const basisPrice = moneyBasisPrice(product)
                        const costDiff = it.diff * basisPrice
                        const packInfo = parsePackUnit(product?.unit)
                        const inputUnitLabel = packInputUnitLabel(packInfo)
                        const diffReal = packRealWorld(it.diff, packInfo)
                        return (
                          <div key={i} className="k-rev-item">
                            <span className="k-rev-item-emo">{product?.e || '📦'}</span>
                            <div className="k-rev-item-txt">
                              <b>{it.productName}</b>
                              <small>
                                {product?.art || '—'}
                                {barcode ? ` · ${barcode}` : ''}
                              </small>
                            </div>
                            <div className="k-rev-item-nums">
                              <span>{formatQty(it.systemStock)}→<b style={{ color: 'var(--text)' }}>{formatQty(it.countedStock)}</b></span>
                              <span className="k-rev-delta" style={diffStyle(it.diff)}>{formatDiff(it.diff)} {inputUnitLabel}</span>
                              {diffReal ? (
                                <span style={diffStyle(diffReal.value)}>({formatDiff(diffReal.value)} {diffReal.label})</span>
                              ) : null}
                              {basisPrice > 0 && it.diff !== 0 ? (
                                <span style={diffStyle(costDiff)}>
                                  {formatMoneyDiff(costDiff)}{costPrice <= 0 ? ' · розн.' : ''}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="k-wh-panel-body k-wh-desk-tbl">
            <table className="k-tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th className="num">Поз.</th>
                  <th className="num">Излишек</th>
                  <th className="num">Недостача</th>
                  <th className="num">Δ</th>
                  <th className="num">Σ закуп</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(rev => {
                  const surplus = rev.items.reduce((s, it) => s + (it.diff > 0 ? it.diff : 0), 0)
                  const shortage = rev.items.reduce((s, it) => s + (it.diff < 0 ? Math.abs(it.diff) : 0), 0)
                  const totalDiff = rev.items.reduce((s, it) => s + it.diff, 0)
                  const costMoneyDiff = rev.items.reduce((s, it) => {
                    const product = products.find(p => p.id === it.productId)
                    return s + it.diff * moneyBasisPrice(product)
                  }, 0)
                  const isOpen = expanded === rev.id
                  return (
                    <Fragment key={rev.id}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : rev.id)}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                          {fmtDateTime(rev.createdAtIso)}
                          {rev.note && (
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {rev.note}
                            </div>
                          )}
                        </td>
                        <td className="num">{rev.items.length}</td>
                        <td className="num" style={{ color: surplus > 0 ? 'var(--green)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {surplus > 0 ? `+${formatQty(surplus)}` : '—'}
                        </td>
                        <td className="num" style={{ color: shortage > 0 ? 'var(--red)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {shortage > 0 ? formatQty(shortage) : '—'}
                        </td>
                        <td className="num" style={{ fontWeight: 800, whiteSpace: 'nowrap', ...diffStyle(totalDiff) }}>
                          {formatDiff(totalDiff)}
                        </td>
                        <td className="num" style={{ fontWeight: 900, whiteSpace: 'nowrap', ...diffStyle(costMoneyDiff) }}>
                          {costMoneyDiff !== 0 ? formatMoneyDiff(costMoneyDiff) : '—'}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
                            <button type="button" className="k-btn k-btn-s" style={{ padding: '3px 8px', fontSize: 12, minHeight: 0 }} disabled={!USE_API} onClick={e => { e.stopPropagation(); openEditForm(rev) }} title="Редактировать">✎</button>
                            <button
                              type="button"
                              className="k-btn k-btn-s"
                              style={{ padding: '3px 8px', fontSize: 12, minHeight: 0, color: 'var(--red)' }}
                              disabled={!USE_API || deletingId === rev.id}
                              onClick={e => { e.stopPropagation(); void removeRevision(rev.id) }}
                              title="Удалить"
                            >
                              {deletingId === rev.id ? '…' : '🗑'}
                            </button>
                            <button type="button" className="k-btn k-btn-s" style={{ padding: '3px 8px', fontSize: 12, minHeight: 0 }} onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : rev.id) }}>
                              {isOpen ? '▲' : '▼'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--card2)', padding: '8px 10px' }}>
                            <div className="k-rev-card-detail" style={{ display: 'grid', gap: 6 }}>
                              {rev.items.map((it, i) => {
                                const product = products.find(p => p.id === it.productId)
                                const barcode = product?.barcode || product?.barcodes?.[0] || ''
                                const costPrice = Number(product?.costPrice) || 0
                                const basisPrice = moneyBasisPrice(product)
                                const costDiff = it.diff * basisPrice
                                const packInfo = parsePackUnit(product?.unit)
                                const inputUnitLabel = packInputUnitLabel(packInfo)
                                const diffReal = packRealWorld(it.diff, packInfo)
                                return (
                                  <div key={i} className="k-rev-item">
                                    <span className="k-rev-item-emo">{product?.e || '📦'}</span>
                                    <div className="k-rev-item-txt">
                                      <b>{it.productName}</b>
                                      <small>
                                        {product?.art || '—'}
                                        {barcode ? ` · ${barcode}` : ''}
                                      </small>
                                    </div>
                                    <div className="k-rev-item-nums">
                                      <span>{formatQty(it.systemStock)}→<b style={{ color: 'var(--text)' }}>{formatQty(it.countedStock)}</b></span>
                                      <span className="k-rev-delta" style={diffStyle(it.diff)}>{formatDiff(it.diff)} {inputUnitLabel}</span>
                                      {diffReal ? (
                                        <span style={diffStyle(diffReal.value)}>({formatDiff(diffReal.value)} {diffReal.label})</span>
                                      ) : null}
                                      {basisPrice > 0 && it.diff !== 0 ? (
                                        <span style={diffStyle(costDiff)}>
                                          {formatMoneyDiff(costDiff)}{costPrice <= 0 ? ' · розн.' : ''}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && (
        <div className="k-modal-bg k-receipt-modal-bg" onClick={closeForm}>
          <div className="k-modal k-receipt-modal k-rev-modal" onClick={e => e.stopPropagation()}>
            <div className="k-rcpt-head">
              <div className="k-rcpt-head-title">
                <div className="k-rcpt-head-ic" style={{ background: 'rgba(59,142,240,.15)', color: '#3B8EF0' }}>📋</div>
                <div>
                  <b>{editingId ? 'Редактирование' : 'Новая ревизия'}</b>
                  <div className="sub">
                    {modalStep === 'scope'
                      ? 'Категории → пересчёт'
                      : editingId
                        ? 'Измените факт · склад обновится'
                        : 'Факт по каждому товару → провести'}
                    {editingRevision ? ` · ${fmtDateTime(editingRevision.createdAtIso)}` : ''}
                  </div>
                </div>
              </div>
              <button type="button" className="k-rcpt-find-x" onClick={closeForm} aria-label="Закрыть">✕</button>
              {modalStep === 'count' && (
                <div className="k-rev-head-actions">
                  {editingId && (
                    <button
                      type="button"
                      className="k-btn k-btn-s k-btn-del"
                      style={{ color: 'var(--red)' }}
                      disabled={saving || deletingId === editingId}
                      onClick={() => void removeRevision(editingId)}
                    >
                      {deletingId === editingId ? '…' : 'Удалить'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="k-btn k-btn-s"
                    disabled={saving}
                    onClick={() => { if (confirm(editingId ? 'Отменить редактирование?' : 'Очистить черновик?')) resetForm() }}
                  >
                    {editingId ? 'Отмена' : 'Очистить'}
                  </button>
                  <button
                    type="button"
                    className="k-btn k-btn-g"
                    style={{ background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
                    disabled={saving || totals.count === 0}
                    onClick={() => void submit()}
                  >
                    {saving ? '…' : editingId
                      ? `Сохранить${totals.netDiff !== 0 ? ` · Δ ${formatDiff(totals.netDiff)}` : ''}`
                      : `Провести${totals.netDiff !== 0 ? ` · Δ ${formatDiff(totals.netDiff)}` : ''}`}
                  </button>
                </div>
              )}
            </div>

            {!editingId && <RevisionStepBar step={modalStep} />}

            {modalStep === 'scope' && !editingId ? (
              <RevisionScopePanel
                products={products}
                categories={categories}
                onStart={startCountFromScope}
                onCancel={closeForm}
              />
            ) : (
              <>
                <div ref={bodyRef} className="k-modal-b k-rev-scroll" onScroll={onBodyScroll}>
                  <div className="k-rev-note">
                    <div className="k-rev-note-row">
                      <input className="k-inp" value={note} onChange={e => setDraftPatch({ note: e.target.value })} placeholder="Комментарий…" />
                      {!editingId && (
                        <button type="button" className="k-btn k-btn-s" onClick={backToScope}>← Кат.</button>
                      )}
                    </div>
                    {!editingId && (
                      <div className="k-rev-scope-chip">
                        <span>📂 {scopeLabel} · {filledLines.length}</span>
                      </div>
                    )}
                  </div>

                  <div className="k-rev-summary">
                    <div><span>Поз.</span><b>{totals.withProduct}</b></div>
                    <div><span>Факт</span><b>{totals.count}</b></div>
                    <div><span>ОК</span><b style={{ color: 'var(--green)' }}>{totals.matched}</b></div>
                    <div><span>Изл.</span><b style={{ color: totals.surplus > 0 ? 'var(--green)' : 'var(--muted)' }}>{totals.surplus > 0 ? `+${totals.surplus}` : '—'}</b></div>
                    <div><span>Δ</span><b style={diffStyle(totals.netDiff)}>{totals.count ? formatDiff(totals.netDiff) : '—'}</b></div>
                    <div><span>Σ</span><b style={diffStyle(totals.costMoneyDiff)}>{totals.count ? formatMoneyDiff(totals.costMoneyDiff) : '—'}</b></div>
                  </div>

                  {filledLines.length > 0 && (
                    <div className="k-rev-count-bar">
                      <div className="k-rev-count-flt" role="group" aria-label="Фильтр пересчёта">
                        {([
                          { id: 'all' as const, label: 'Все' },
                          { id: 'pending' as const, label: 'Не посчитано' },
                          { id: 'done' as const, label: 'Посчитано' },
                          { id: 'diff' as const, label: 'Расхождение' },
                        ]).map(f => (
                          <button
                            key={f.id}
                            type="button"
                            className={`k-subtab${countFilter === f.id ? ' active' : ''}`}
                            onClick={() => setCountFilter(f.id)}
                          >
                            {f.label}
                            {f.id === 'pending' && pendingCount > 0 ? ` ${pendingCount}` : ''}
                          </button>
                        ))}
                      </div>
                      <div className={`k-rev-left${pendingCount > 0 ? ' warn' : ''}`}>
                        {pendingCount > 0
                          ? <>Осталось <b>{pendingCount}</b> из {filledLines.length}</>
                          : <>Всё посчитано · <b>{filledLines.length}</b></>}
                      </div>
                    </div>
                  )}

                  {(filledLines.length > 5 || countSearch.trim()) && (
                    <div className="k-rev-search">
                      <input
                        className="k-inp"
                        value={countSearch}
                        onChange={e => setCountSearch(e.target.value)}
                        placeholder="Поиск в списке…"
                      />
                    </div>
                  )}

                  {visibleFilledLines.length === 0 && (countSearch.trim() || countFilter !== 'all') && filledLines.length > 0 && (
                    <div className="k-rcpt-empty">
                      {countSearch.trim()
                        ? `По запросу «${countSearch}» ничего не найдено`
                        : countFilter === 'pending'
                          ? 'Все позиции уже посчитаны'
                          : countFilter === 'diff'
                            ? 'Расхождений нет'
                            : 'Нет посчитанных позиций'}
                    </div>
                  )}
                  {filledLines.length === 0 && !countSearch.trim() && (
                    <div className="k-rcpt-empty">Нажмите + чтобы добавить товар</div>
                  )}

                  {visibleFilledLines.map((line, idx) => {
                    const product = products.find(p => p.id === line.productId) || null
                    if (!product) return null
                    const realIdx = filledLines.indexOf(line)
                    return (
                      <RevisionLineCard
                        key={line.key}
                        line={line}
                        idx={realIdx >= 0 ? realIdx : idx}
                        product={product}
                        liveStock={stockOf(product)}
                        freezeSystem={freezeSystem}
                        active={activeLineKey === line.key}
                        canRemove={filledLines.length > 0}
                        onRemove={() => setDraft(prev => ({
                          ...prev,
                          lines: prev.lines.filter(l => l.key !== line.key),
                          activeLineKey: prev.activeLineKey === line.key ? null : prev.activeLineKey,
                        }))}
                        onActivate={() => setDraftPatch({ activeLineKey: line.key })}
                        onCounted={v => updateLine(line.key, { countedStock: v, checked: true })}
                        onMatchSystem={() => updateLine(line.key, { countedStock: String(stockOf(product)), checked: true })}
                        onZero={() => updateLine(line.key, { countedStock: '0', checked: true })}
                        onConfirm={() => updateLine(line.key, {
                          countedStock: line.countedStock !== '' ? line.countedStock : String(stockOf(product)),
                          checked: true,
                        })}
                        onEditProduct={() => setEditProductId(product.id)}
                        cardRef={el => { lineRefs.current[line.key] = el }}
                        countedRef={el => { countedRefs.current[line.key] = el }}
                      />
                    )
                  })}

                  <div className="k-rev-add-desk k-hide-mob">
                    {(() => {
                      const pending = [...lines].reverse().find(l => !l.productId)
                      if (!pending) return null
                      const pendingIdx = lines.filter(l => l.productId).length
                      return (
                        <div
                          ref={el => { lineRefs.current[pending.key] = el }}
                          className="k-rev-add"
                        >
                          <div className="k-rev-add-h">+ Товар вручную · поз. {pendingIdx + 1}</div>
                          <WarehouseProductSelect
                            products={products}
                            value={null}
                            onChange={p => { if (p) selectProduct(pending.key, p) }}
                            placeholder="Название, артикул или штрихкод…"
                          />
                        </div>
                      )
                    })()}
                  </div>

                  {msg && (
                    <div className="k-rcpt-msg" style={{ margin: '8px 0 0' }}>{msg}</div>
                  )}
                </div>

                <div className="k-receipt-modal-actions k-hide-mob">
                  <button
                    type="button"
                    className="k-btn k-btn-g k-btn-primary-wide"
                    style={{ background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
                    disabled={saving || totals.count === 0}
                    onClick={() => void submit()}
                  >
                    {saving ? 'Сохранение…' : editingId
                      ? `Сохранить${totals.netDiff !== 0 ? ` · Δ ${formatDiff(totals.netDiff)}` : ''}`
                      : `Провести ревизию${totals.netDiff !== 0 ? ` · Δ ${formatDiff(totals.netDiff)}` : ''}`}
                  </button>
                  <div className="k-btn-row">
                    <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={() => { if (confirm(editingId ? 'Отменить редактирование?' : 'Очистить черновик?')) resetForm() }}>{editingId ? 'Отмена' : 'Очистить'}</button>
                    {editingId && (
                      <button
                        type="button"
                        className="k-btn k-btn-s"
                        style={{ color: 'var(--red)' }}
                        disabled={saving || deletingId === editingId}
                        onClick={() => void removeRevision(editingId)}
                      >
                        {deletingId === editingId ? 'Удаление…' : 'Удалить'}
                      </button>
                    )}
                    <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={closeForm}>Закрыть</button>
                  </div>
                </div>

                <button
                  type="button"
                  className="k-wh-fab k-rev-fab k-hide-desk"
                  onClick={() => setAddOpen(true)}
                  aria-label="Добавить товар"
                  title="Добавить товар"
                >
                  +
                </button>

                {addOpen && (
                  <div className="k-rcpt-find-bg" onClick={() => setAddOpen(false)}>
                    <div className="k-rcpt-find-modal" onClick={e => e.stopPropagation()}>
                      <div className="k-rcpt-find-h">
                        <div>
                          <b>Найти товар</b>
                          <div className="sub">Поиск по базе · штрихкод · цена · остаток · PLU</div>
                        </div>
                        <button type="button" className="k-rcpt-find-x" onClick={() => setAddOpen(false)}>✕</button>
                      </div>
                      <div className="k-rcpt-find-body">
                        <WarehouseProductSelect
                          products={products}
                          value={null}
                          onChange={p => { if (p) addProductFromFind(p) }}
                          placeholder="Поиск или сканер: название, артикул, штрихкод…"
                          autoFocus
                          variant="panel"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {editProductId && (() => {
        const p = products.find(x => x.id === editProductId)
        if (!p) return null
        return (
          <ProductEditModal
            open
            product={p}
            onClose={() => setEditProductId(null)}
            onSaved={() => { void fetchProducts(); setEditProductId(null) }}
          />
        )
      })()}
    </div>
  )
}
