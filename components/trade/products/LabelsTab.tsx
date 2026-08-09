'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { getKakapoDesktop, isKakapoDesktop, type DesktopPrinter } from '@/lib/desktopBridge'
import { pickLabelPrinter, pickReceiptPrinter, XP235B_LABEL_HEIGHT_MM, XP235B_LABEL_WIDTH_MM } from '@/lib/printerPresets'
import { productMatchesSearch } from '@/lib/productBarcodes'
import type { Product, ProductStockLayer } from '@/lib/types'
import MobileBarcodeScanner from '@/components/shared/MobileBarcodeScanner'
import LabelCard from './LabelCard'
import LabelDesignModal from './LabelDesignModal'
import LabelEditModal from './LabelEditModal'
import { buildSingleLabelThermalDocument } from './labelPrintHtml'
import {
  applyXP235BDesign,
  applyPaperPreset,
  buildLabelPick,
  buildPrintCss,
  DEFAULT_LABEL_DESIGN,
  defaultLabelEdit,
  formatLabelMoney,
  labelPickKey,
  layerShortLabel,
  LABEL_EDITOR_PREVIEW_EDIT,
  loadLabelDesign,
  loadLabelDesignPersistent,
  previewCardStyle,
  previewGridStyle,
  PAPER_PRESETS,
  saveLabelDesign,
  type LabelDesign,
  type LabelEdit,
  type LabelPick,
} from './labelShared'

const LABEL_CSS = `
  .k-label-pick{border:1px solid var(--border);border-radius:8px;margin-bottom:4px;background:var(--card2);overflow:hidden}
  .k-label-pick-head{display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer}
  .k-label-pick-head input{accent-color:var(--green)}
  .k-label-pick-head:hover{background:rgba(31,215,96,.06)}
  .k-label-layer{padding:5px 8px 5px 32px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:11px;cursor:pointer}
  .k-label-layer:hover{background:rgba(31,215,96,.04)}
  .k-label-layer input{accent-color:var(--green)}
`

const EMPTY_EDIT: LabelEdit = {
  brand: 'KAKAPO', name: '', price: '0', meta: '', size: '', barcode: '', plu: '',
  showBarcode: true, showPlu: false,
}

export default function LabelsTab({
  products,
  search,
}: {
  products: Product[]
  search: string
}) {
  const [labelSearch, setLabelSearch] = useState('')
  const [labelScanOpen, setLabelScanOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, LabelEdit>>({})
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [layersByProduct, setLayersByProduct] = useState<Record<number, ProductStockLayer[]>>({})
  const [loadingLayers, setLoadingLayers] = useState<Set<number>>(new Set())
  const [design, setDesign] = useState<LabelDesign>(() => (
    typeof window !== 'undefined' ? loadLabelDesign() : DEFAULT_LABEL_DESIGN
  ))
  const [draftDesign, setDraftDesign] = useState<LabelDesign>(DEFAULT_LABEL_DESIGN)
  const [designOpen, setDesignOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftEdit, setDraftEdit] = useState<LabelEdit | null>(null)
  const loadingRef = useRef<Set<number>>(new Set())
  const labelSearchRef = useRef<HTMLInputElement | null>(null)
  const [deskPrinters, setDeskPrinters] = useState<DesktopPrinter[]>([])
  const [labelPrinterName, setLabelPrinterName] = useState('')
  const [labelPrintBusy, setLabelPrintBusy] = useState(false)
  const [printerPanelOpen, setPrinterPanelOpen] = useState(false)

  function focusLabelSearch() {
    const el = labelSearchRef.current
    if (!el || el.disabled) return false
    try { el.focus({ preventScroll: true }) } catch { el.focus() }
    return document.activeElement === el
  }

  function labelSearchBlocked() {
    if (designOpen || editingKey || printerPanelOpen || labelScanOpen) return true
    if (document.querySelector('.k-modal-bg, .modal-card')) return true
    return false
  }

  useEffect(() => {
    let cancelled = false
    void loadLabelDesignPersistent().then(d => {
      if (!cancelled) setDesign(d)
    })
    if (!isKakapoDesktop()) return () => { cancelled = true }
    const desk = getKakapoDesktop()
    void Promise.all([
      desk?.getPrinters().catch(() => [] as DesktopPrinter[]),
      desk?.getPrinterSettings().catch(() => ({ labelPrinterName: '', printerName: '' })),
    ]).then(([printers, settings]) => {
      if (cancelled) return
      setDeskPrinters(printers || [])
      const saved = settings?.labelPrinterName || ''
      const auto = pickLabelPrinter(printers || [])
      setLabelPrinterName(saved || auto || pickReceiptPrinter(printers || []))
    })
    return () => { cancelled = true }
  }, [])

  // Сразу при входе + повторно (клик по вкладке часто оставляет фокус на кнопке)
  useEffect(() => {
    if (designOpen || editingKey || printerPanelOpen) return
    let cancelled = false
    const tryFocus = () => {
      if (cancelled || labelSearchBlocked()) return
      focusLabelSearch()
    }
    tryFocus()
    const timers = [0, 30, 80, 160, 320].map(ms => window.setTimeout(tryFocus, ms))
    return () => {
      cancelled = true
      timers.forEach(id => window.clearTimeout(id))
    }
  }, [designOpen, editingKey, printerPanelOpen])

  // Этикетки: курсор всегда в поиске (сканер / клик по окну)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (labelSearchBlocked()) return
      const active = document.activeElement as HTMLElement | null
      if (active && active !== labelSearchRef.current && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
        return
      }
      if (e.key.length === 1 || e.key === 'Backspace') {
        focusLabelSearch()
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (labelSearchBlocked()) return
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('.k-modal-bg, .modal-card')) return
      // Не трогаем другие поля ввода (кроме чекбоксов — после них снова поиск)
      const inp = t.closest('input, textarea, select, [contenteditable="true"]') as HTMLElement | null
      if (inp && inp !== labelSearchRef.current) {
        const type = (inp as HTMLInputElement).type
        if (inp.tagName !== 'INPUT' || (type !== 'checkbox' && type !== 'radio')) return
      }
      window.setTimeout(() => {
        if (labelSearchBlocked()) return
        const active = document.activeElement as HTMLElement | null
        if (active && active !== labelSearchRef.current && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
          const type = (active as HTMLInputElement).type
          if (active.tagName !== 'INPUT' || (type !== 'checkbox' && type !== 'radio')) return
        }
        focusLabelSearch()
      }, 0)
    }

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerup', onPointerUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [designOpen, editingKey, printerPanelOpen])

  const printCss = useMemo(() => buildPrintCss(design), [design])
  const previewGrid = useMemo(() => previewGridStyle(design), [design])
  const previewCard = useMemo(() => previewCardStyle(design), [design])
  const paperInfo = design.paperPreset === 'custom'
    ? `${design.paperWidthMm}×${design.paperHeightMm || '∞'} мм`
    : PAPER_PRESETS[design.paperPreset]?.label || 'Свой'

  const q = labelSearch.trim() || search.trim()
  const filtered = useMemo(
    () => products.filter(p => productMatchesSearch(p, q)),
    [products, q],
  )

  const picksByKey = useMemo(() => {
    const map = new Map<string, LabelPick>()
    for (const p of products) {
      const layers = layersByProduct[p.id] || []
      if (layers.length) {
        for (const layer of layers) {
          const pick = buildLabelPick(p, layer)
          map.set(pick.key, pick)
        }
      } else {
        map.set(buildLabelPick(p, null).key, buildLabelPick(p, null))
      }
    }
    return map
  }, [products, layersByProduct])

  const chosenPicks = useMemo(() => {
    const list: LabelPick[] = []
    for (const key of selected) {
      const pick = picksByKey.get(key)
      if (pick) list.push(pick)
    }
    return list
  }, [selected, picksByKey])

  const previewPicks = chosenPicks.length
    ? chosenPicks
    : filtered.slice(0, 6).map(p => {
      const layers = layersByProduct[p.id] || []
      const active = layers.find(l => l.isActive) || layers[0]
      return buildLabelPick(p, active ?? null)
    })

  const loadLayers = useCallback(async (productId: number) => {
    if (!USE_API || loadingRef.current.has(productId)) return
    let skip = false
    setLayersByProduct(prev => {
      if (prev[productId] !== undefined) { skip = true; return prev }
      return prev
    })
    if (skip) return
    loadingRef.current.add(productId)
    setLoadingLayers(prev => new Set(prev).add(productId))
    try {
      const layers = await api.getProductStockLayers(productId)
      setLayersByProduct(prev => ({ ...prev, [productId]: layers }))
    } catch {
      setLayersByProduct(prev => ({ ...prev, [productId]: [] }))
    } finally {
      loadingRef.current.delete(productId)
      setLoadingLayers(prev => { const n = new Set(prev); n.delete(productId); return n })
    }
  }, [])

  useEffect(() => {
    if (!USE_API) return
    void Promise.all(filtered.slice(0, 30).map(p => loadLayers(p.id)))
  }, [filtered, loadLayers])

  function getEdit(pick: LabelPick): LabelEdit {
    const base = defaultLabelEdit(pick.product, pick.layer)
    const saved = edits[pick.key]
    if (!saved) return base
    // Только текст товара — макет (позиции блоков) всегда из общего design
    return {
      ...base,
      name: saved.name?.trim() ? saved.name : base.name,
      price: saved.price?.trim() ? saved.price : base.price,
      size: saved.size?.trim() ? saved.size : base.size,
      barcode: saved.barcode?.trim() ? saved.barcode : base.barcode,
      plu: saved.plu?.trim() ? saved.plu : base.plu,
      brand: saved.brand?.trim() ? saved.brand : base.brand,
      meta: saved.meta?.trim() ? saved.meta : base.meta,
      showBarcode: saved.showBarcode ?? base.showBarcode,
      showPlu: saved.showPlu ?? base.showPlu,
    }
  }

  function ensureEdit(key: string, pick: LabelPick) {
    if (!edits[key]) setEdits(prev => ({ ...prev, [key]: defaultLabelEdit(pick.product, pick.layer) }))
  }

  function toggleKey(key: string, pick: LabelPick, on: boolean) {
    ensureEdit(key, pick)
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function toggleProduct(product: Product, on: boolean) {
    const layers = layersByProduct[product.id] || []
    const active = layers.find(l => l.isActive) || layers[0]
    const pick = picksByKey.get(labelPickKey(product.id, active?.receiptId ?? null)) || buildLabelPick(product, active ?? null)
    toggleKey(pick.key, pick, on)
  }

  function isProductChecked(product: Product) {
    const layers = layersByProduct[product.id] || []
    if (!layers.length) return selected.has(labelPickKey(product.id, null))
    return layers.some(l => selected.has(labelPickKey(product.id, l.receiptId)))
  }

  function toggleExpand(productId: number) {
    void loadLayers(productId)
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function selectAll() {
    const next = new Set<string>()
    const nextEdits = { ...edits }
    for (const p of filtered) {
      const layers = layersByProduct[p.id] || []
      const active = layers.find(l => l.isActive) || layers[0]
      const pick = buildLabelPick(p, active ?? null)
      next.add(pick.key)
      if (!nextEdits[pick.key]) nextEdits[pick.key] = defaultLabelEdit(pick.product, pick.layer)
    }
    setEdits(nextEdits)
    setSelected(next)
  }

  function openDesign() {
    setDraftDesign({ ...design })
    setDesignOpen(true)
  }

  function saveDesign() {
    const next = {
      ...draftDesign,
      labelWidthMm: XP235B_LABEL_WIDTH_MM,
      labelHeightMm: XP235B_LABEL_HEIGHT_MM,
      paperWidthMm: XP235B_LABEL_WIDTH_MM,
      elements: draftDesign.elements?.length ? draftDesign.elements : design.elements,
    }
    setDesign(next)
    saveLabelDesign(next)
    setDesignOpen(false)
  }

  async function setupXP235B() {
    const next = applyXP235BDesign(design)
    setDesign(next)
    saveLabelDesign(next)
    setPrinterPanelOpen(true)
    if (isKakapoDesktop()) {
      const desk = getKakapoDesktop()
      const printers = await desk?.getPrinters().catch(() => [] as DesktopPrinter[]) || []
      setDeskPrinters(printers)
      const auto = pickLabelPrinter(printers)
      if (auto) setLabelPrinterName(auto)
    }
  }

  async function saveLabelPrinter() {
    const desk = getKakapoDesktop()
    if (!desk) return
    const cur = await desk.getPrinterSettings()
    await desk.savePrinterSettings({ ...cur, labelPrinterName })
  }

  async function testLabelPrinter() {
    const desk = getKakapoDesktop()
    if (!desk) return
    setLabelPrintBusy(true)
    try {
      await saveLabelPrinter()
      const sampleEdit = {
        brand: 'KAKAPO',
        name: 'Брокколи свежая',
        price: '42.50',
        meta: '',
        size: '500 г',
        barcode: '4601234567890',
        plu: '6403',
        showBarcode: true,
        showPlu: true,
      }
      const sample = buildSingleLabelThermalDocument(sampleEdit, {
        ...design,
        layout: 'retail',
        labelWidthMm: XP235B_LABEL_WIDTH_MM,
        labelHeightMm: XP235B_LABEL_HEIGHT_MM,
      })
      await desk.printHtml(sample, {
        role: 'label',
        printerName: labelPrinterName || undefined,
        pageWidthMm: XP235B_LABEL_WIDTH_MM,
        pageHeightMm: XP235B_LABEL_HEIGHT_MM,
        gapMm: 2,
      })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка печати')
    } finally {
      setLabelPrintBusy(false)
    }
  }

  async function printLabels() {
    if (!chosenPicks.length) return

    if (isKakapoDesktop()) {
      const desk = getKakapoDesktop()
      if (!desk) return
      try {
        await saveLabelPrinter()
        const w = XP235B_LABEL_WIDTH_MM
        const h = XP235B_LABEL_HEIGHT_MM
        const printDesign = {
          ...design,
          layout: (design.layout === 'blocks' ? 'blocks' : 'retail') as typeof design.layout,
          labelWidthMm: w,
          labelHeightMm: h,
          paperWidthMm: w,
          elements: design.elements,
        }
        // Пакет: захват по 1 разу на товар, копии через PRINT n, одно RAW-задание
        const batchItems = chosenPicks.map(pick => ({
          html: buildSingleLabelThermalDocument(getEdit(pick), printDesign),
          copies: 1,
        }))
        if (typeof desk.printLabelsBatch === 'function') {
          await desk.printLabelsBatch(batchItems, {
            role: 'label',
            printerName: labelPrinterName || undefined,
            pageWidthMm: w,
            pageHeightMm: h,
            gapMm: 2,
          })
        } else {
          for (const item of batchItems) {
            await desk.printHtml(item.html, {
              role: 'label',
              printerName: labelPrinterName || undefined,
              pageWidthMm: w,
              pageHeightMm: h,
              gapMm: 2,
              copies: 1,
            })
          }
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Не удалось напечатать этикетки')
      }
      return
    }

    const root = document.getElementById('k-label-print')
    if (!root) return
    window.print()
  }

  return (
    <div className="k-labels-shell">
      <style>{LABEL_CSS}{printCss}</style>
      <div className="k-catalog-bar" style={{ marginBottom: 6, flexShrink: 0 }}>
        <div className="k-catalog-meta">
          <b>{selected.size}</b>
          <span>
            этикеток · {filtered.length} тов.
            {' · '}{design.labelWidthMm}×{design.labelHeightMm} мм · {paperInfo}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto', alignItems: 'center' }}>
          {isKakapoDesktop() && (
            <>
              <button type="button" className="k-btn k-btn-g" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => void setupXP235B()}>
                ⚙ XP-235B
              </button>
              <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setPrinterPanelOpen(v => !v)}>
                🖨{printerPanelOpen ? ' ▲' : ''}
              </button>
            </>
          )}
          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={openDesign}>🎨</button>
          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={selectAll}>Все</button>
          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setSelected(new Set())}>Сброс</button>
          <button
            type="button"
            className="k-btn k-btn-g"
            style={{ padding: '6px 12px', fontSize: 12 }}
            disabled={!chosenPicks.length || labelPrintBusy}
            onClick={() => void printLabels()}
          >
            🖨️ Печать ({chosenPicks.length})
          </button>
        </div>
      </div>

      {printerPanelOpen && isKakapoDesktop() && (
        <div className="k-card" style={{ marginBottom: 8, flexShrink: 0 }}>
          <div className="k-card-h" style={{ padding: '8px 12px' }}>
            <b>Настройка XP-235B</b>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Товары → Этикетки</span>
          </div>
          <div className="k-card-b" style={{ display: 'grid', gap: 10, maxWidth: 520, padding: 12 }}>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
              <li>В Windows: драйвер XP-235B, принтер виден в списке</li>
              <li>Ролик <b>58×40 мм</b>. В свойствах принтера бумага тоже <b>58×40</b></li>
              <li>Ниже выберите <b>XP-235B</b> → Сохранить → Тест</li>
            </ol>
            <select
              className="k-sel"
              value={labelPrinterName}
              onChange={e => setLabelPrinterName(e.target.value)}
            >
              <option value="">Выберите Xprinter XP-235B</option>
              {deskPrinters.map(p => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}{p.isDefault ? ' · default' : ''}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="k-btn k-btn-s" disabled={labelPrintBusy} onClick={() => void saveLabelPrinter()}>
                Сохранить
              </button>
              <button type="button" className="k-btn k-btn-g" disabled={labelPrintBusy || !labelPrinterName} onClick={() => void testLabelPrinter()}>
                {labelPrintBusy ? 'Печать…' : 'Тест этикетки'}
              </button>
              <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={openDesign}>
                Дизайн
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="k-label-layout">
        <section className="k-card k-label-panel">
          <div className="k-card-h">
            <b>Товары</b>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.size} выбрано</span>
          </div>
          <div className="k-card-b">
            <div className="k-label-search-row">
              <input
                ref={labelSearchRef}
                className="k-inp"
                data-label-search
                autoFocus
                value={labelSearch}
                onChange={e => setLabelSearch(e.target.value)}
                onFocus={e => e.currentTarget.select()}
                placeholder="Поиск: штрихкод, название, артикул…"
              />
              <button
                type="button"
                className="k-btn k-btn-s k-cam-scan-btn"
                title="Сканер камеры"
                aria-label="Сканер камеры"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setLabelScanOpen(true)}
                style={{ flexShrink: 0, minWidth: 44, minHeight: 44, padding: '0 10px', fontSize: 18, lineHeight: 1 }}
              >
                📷
              </button>
            </div>
            <div className="k-label-list">
              {filtered.map(p => {
                const layers = layersByProduct[p.id]
                const isOpen = expanded.has(p.id)
                const loading = loadingLayers.has(p.id)
                return (
                  <div key={p.id} className="k-label-pick">
                    <div className="k-label-pick-head">
                      <input type="checkbox" checked={isProductChecked(p)} onChange={e => toggleProduct(p, e.target.checked)} />
                      <span style={{ fontSize: 15 }}>{p.e || '📦'}</span>
                      <span style={{ flex: 1, minWidth: 0 }} onClick={() => toggleExpand(p.id)}>
                        <div style={{ fontWeight: 800, fontSize: 12, lineHeight: 1.2 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {p.art} · {formatLabelMoney(p.price)}
                          {layers?.length ? ` · ${layers.length} парт.` : ''}
                        </div>
                      </span>
                      <button type="button" className="k-btn k-btn-s" style={{ padding: '2px 6px', fontSize: 10, minHeight: 0 }} onClick={() => toggleExpand(p.id)}>
                        {loading ? '…' : isOpen ? '▲' : '▼'}
                      </button>
                    </div>
                    {isOpen && (
                      <div>
                        {loading && layers === undefined && (
                          <div style={{ padding: '6px 32px', fontSize: 11, color: 'var(--muted)' }}>Загрузка партий…</div>
                        )}
                        {(layers || []).length === 0 && layers !== undefined && (
                          <label className="k-label-layer">
                            <input
                              type="checkbox"
                              checked={selected.has(labelPickKey(p.id, null))}
                              onChange={e => toggleKey(labelPickKey(p.id, null), buildLabelPick(p, null), e.target.checked)}
                            />
                            <span>Без партии · {formatLabelMoney(p.price)}</span>
                          </label>
                        )}
                        {(layers || []).map(layer => {
                          const key = labelPickKey(p.id, layer.receiptId)
                          const pick = buildLabelPick(p, layer)
                          return (
                            <label key={key} className="k-label-layer">
                              <input type="checkbox" checked={selected.has(key)} onChange={e => toggleKey(key, pick, e.target.checked)} />
                              <span>{layerShortLabel(layer, p.unit || 'шт')}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              {!filtered.length && <div className="k-empty">Товары не найдены</div>}
            </div>
          </div>
        </section>

        <section className="k-card k-label-panel">
          <div className="k-card-h">
            <b>Предпросмотр</b>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              {design.labelWidthMm}×{design.labelHeightMm} мм · {paperInfo}
            </span>
          </div>
          <div className="k-card-b">
            <div className="k-label-preview-scroll">
              <div id="k-label-print" style={previewGrid}>
                {previewPicks.map(pick => (
                  <LabelCard
                    key={pick.key}
                    edit={getEdit(pick)}
                    design={design}
                    sizeStyle={previewCard}
                    onEdit={() => {
                      setEditingKey(pick.key)
                      setDraftEdit({ ...getEdit(pick) })
                    }}
                  />
                ))}
              </div>
              {!chosenPicks.length && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                  Отметьте товары слева · ✏️ текст · 🎨 дизайн
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <LabelEditModal
        open={!!editingKey && !!draftEdit}
        edit={draftEdit || EMPTY_EDIT}
        onChange={setDraftEdit}
        onClose={() => { setEditingKey(null); setDraftEdit(null) }}
        onSave={() => {
          if (editingKey && draftEdit) setEdits(prev => ({ ...prev, [editingKey]: draftEdit }))
          setEditingKey(null)
          setDraftEdit(null)
        }}
      />

      <LabelDesignModal
        open={designOpen}
        design={draftDesign}
        onChange={setDraftDesign}
        onClose={() => setDesignOpen(false)}
        onSave={saveDesign}
        onReset={() => setDraftDesign({
          ...DEFAULT_LABEL_DESIGN,
          elements: DEFAULT_LABEL_DESIGN.elements.map(e => ({ ...e })),
        })}
      />

      <MobileBarcodeScanner
        open={labelScanOpen}
        onClose={() => setLabelScanOpen(false)}
        onDetect={code => {
          const trimmed = String(code || '').trim()
          setLabelScanOpen(false)
          if (!trimmed) return
          setLabelSearch(trimmed)
          window.setTimeout(() => focusLabelSearch(), 0)
        }}
        title="Сканер этикеток"
        hint="Наведите камеру на штрихкод товара"
      />
    </div>
  )
}
