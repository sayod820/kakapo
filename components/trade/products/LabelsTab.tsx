'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { getKakapoDesktop, isKakapoDesktop, type DesktopPrinter } from '@/lib/desktopBridge'
import { pickLabelPrinter, pickReceiptPrinter, XP235B_LABEL_HEIGHT_MM, XP235B_LABEL_WIDTH_MM } from '@/lib/printerPresets'
import { productMatchesSearch } from '@/lib/productBarcodes'
import type { Product, ProductStockLayer } from '@/lib/types'
import LabelCard from './LabelCard'
import LabelDesignModal from './LabelDesignModal'
import LabelEditModal from './LabelEditModal'
import { buildLabelsThermalPrintDocument } from './labelPrintHtml'
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
  loadLabelDesign,
  previewCardStyle,
  previewGridStyle,
  PAPER_PRESETS,
  saveLabelDesign,
  type LabelDesign,
  type LabelEdit,
  type LabelPick,
} from './labelShared'

const LABEL_CSS = `
  .k-label-pick{border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--card2);overflow:hidden}
  .k-label-pick-head{display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer}
  .k-label-pick-head input{accent-color:var(--green)}
  .k-label-pick-head:hover{background:rgba(31,215,96,.06)}
  .k-label-layer{padding:6px 10px 6px 38px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer}
  .k-label-layer:hover{background:rgba(31,215,96,.04)}
  .k-label-layer input{accent-color:var(--green)}
`

const EMPTY_EDIT: LabelEdit = {
  brand: 'KAKAPO', name: '', price: '0', meta: '', barcode: '', plu: '',
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, LabelEdit>>({})
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [layersByProduct, setLayersByProduct] = useState<Record<number, ProductStockLayer[]>>({})
  const [loadingLayers, setLoadingLayers] = useState<Set<number>>(new Set())
  const [design, setDesign] = useState<LabelDesign>(DEFAULT_LABEL_DESIGN)
  const [draftDesign, setDraftDesign] = useState<LabelDesign>(DEFAULT_LABEL_DESIGN)
  const [designOpen, setDesignOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftEdit, setDraftEdit] = useState<LabelEdit | null>(null)
  const loadingRef = useRef<Set<number>>(new Set())
  const [deskPrinters, setDeskPrinters] = useState<DesktopPrinter[]>([])
  const [labelPrinterName, setLabelPrinterName] = useState('')
  const [labelPrintBusy, setLabelPrintBusy] = useState(false)
  const [printerPanelOpen, setPrinterPanelOpen] = useState(false)

  useEffect(() => {
    setDesign(loadLabelDesign())
    if (!isKakapoDesktop()) return
    const desk = getKakapoDesktop()
    void Promise.all([
      desk?.getPrinters().catch(() => [] as DesktopPrinter[]),
      desk?.getPrinterSettings().catch(() => ({ labelPrinterName: '', printerName: '' })),
    ]).then(([printers, settings]) => {
      setDeskPrinters(printers || [])
      const saved = settings?.labelPrinterName || ''
      const auto = pickLabelPrinter(printers || [])
      setLabelPrinterName(saved || auto || pickReceiptPrinter(printers || []))
    })
  }, [])

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
    return edits[pick.key] ?? defaultLabelEdit(pick.product, pick.layer)
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
    setDesign(draftDesign)
    saveLabelDesign(draftDesign)
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
        name: 'Тест XP-235B',
        price: '1.00',
        meta: `${design.labelWidthMm}×${design.labelHeightMm} мм`,
        barcode: '4601234567890',
        plu: '',
        showBarcode: true,
        showPlu: false,
      }
      const sample = buildLabelsThermalPrintDocument([sampleEdit], design)
      await desk.printHtml(sample, {
        role: 'label',
        printerName: labelPrinterName || undefined,
        pageWidthMm: design.labelWidthMm || XP235B_LABEL_WIDTH_MM,
        pageHeightMm: design.labelHeightMm || XP235B_LABEL_HEIGHT_MM,
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
        const w = design.labelWidthMm || XP235B_LABEL_WIDTH_MM
        const h = design.labelHeightMm || XP235B_LABEL_HEIGHT_MM
        const edits = chosenPicks.map(pick => getEdit(pick))
        const html = buildLabelsThermalPrintDocument(edits, design)
        await desk.printHtml(html, {
          role: 'label',
          printerName: labelPrinterName || undefined,
          pageWidthMm: w,
          pageHeightMm: h,
          gapMm: 2,
        })
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
    <div>
      <style>{LABEL_CSS}{printCss}</style>
      <div className="k-page-h" style={{ marginTop: 0 }}>
        <div>
          <h1>🏷️ Этикетки</h1>
          <div className="sub">Поиск, партии, дизайн, штрихкод и печать</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isKakapoDesktop() && (
            <>
              <button type="button" className="k-btn k-btn-g" onClick={() => void setupXP235B()}>
                ⚙ Настроить XP-235B
              </button>
              <button type="button" className="k-btn k-btn-s" onClick={() => setPrinterPanelOpen(v => !v)}>
                🖨 Принтер{printerPanelOpen ? ' ▲' : ''}
              </button>
            </>
          )}
          <button type="button" className="k-btn k-btn-s" onClick={openDesign}>🎨 Дизайн</button>
          <button type="button" className="k-btn k-btn-s" onClick={selectAll}>Выбрать все</button>
          <button type="button" className="k-btn k-btn-s" onClick={() => setSelected(new Set())}>Сбросить</button>
          <button
            type="button"
            className="k-btn k-btn-g"
            disabled={!chosenPicks.length}
            onClick={() => void printLabels()}
          >
            🖨️ Печать ({chosenPicks.length})
          </button>
        </div>
      </div>

      {printerPanelOpen && isKakapoDesktop() && (
        <div className="k-card" style={{ marginBottom: 14 }}>
          <div className="k-card-h">
            <b>Настройка XP-235B</b>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Товары → Этикетки (не касса)</span>
          </div>
          <div className="k-card-b" style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
              <li>В Windows: драйвер XP-235B, принтер виден в списке</li>
              <li>Ролик <b>58×40 мм</b> в принтере</li>
              <li>Ниже выберите <b>XP-235B</b> → Сохранить</li>
              <li><b>Тест этикетки</b> — печать через TSPL (чёткий штрихкод)</li>
              <li>Выберите товары справа → <b>Печать</b></li>
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
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Размер: <b>{design.labelWidthMm}×{design.labelHeightMm} мм</b>
              {design.paperPreset === 'xp235b' ? ' · XP-235B' : ''}
              {' · '}
              <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 8px', fontSize: 11 }} onClick={openDesign}>
                изменить в Дизайн
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="k-btn k-btn-s" disabled={labelPrintBusy} onClick={() => void saveLabelPrinter()}>
                Сохранить
              </button>
              <button type="button" className="k-btn k-btn-g" disabled={labelPrintBusy || !labelPrinterName} onClick={() => void testLabelPrinter()}>
                {labelPrintBusy ? 'Печать…' : 'Тест этикетки'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="k-label-layout">
        <section className="k-card">
          <div className="k-card-h">
            <b>Выбор товаров</b>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.size} этикеток</span>
          </div>
          <div className="k-card-b">
            <input
              className="k-inp"
              value={labelSearch}
              onChange={e => setLabelSearch(e.target.value)}
              placeholder="Поиск: штрихкод, название, артикул…"
              style={{ marginBottom: 12 }}
            />
            <div className="k-tbl-scroll" style={{ maxHeight: '52vh' }}>
              {filtered.map(p => {
                const layers = layersByProduct[p.id]
                const isOpen = expanded.has(p.id)
                const loading = loadingLayers.has(p.id)
                return (
                  <div key={p.id} className="k-label-pick">
                    <div className="k-label-pick-head">
                      <input type="checkbox" checked={isProductChecked(p)} onChange={e => toggleProduct(p, e.target.checked)} />
                      <span style={{ fontSize: 18 }}>{p.e || '📦'}</span>
                      <span style={{ flex: 1, minWidth: 0 }} onClick={() => toggleExpand(p.id)}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {p.art} · {formatLabelMoney(p.price)}
                          {layers?.length ? ` · ${layers.length} парт.` : ''}
                        </div>
                      </span>
                      <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => toggleExpand(p.id)}>
                        {loading ? '…' : isOpen ? '▲' : '▼'}
                      </button>
                    </div>
                    {isOpen && (
                      <div>
                        {loading && layers === undefined && (
                          <div style={{ padding: '8px 38px', fontSize: 11, color: 'var(--muted)' }}>Загрузка партий…</div>
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

        <section className="k-card">
          <div className="k-card-h">
            <b>Предпросмотр</b>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              {design.labelWidthMm}×{design.labelHeightMm} мм · {paperInfo}
            </span>
          </div>
          <div className="k-card-b">
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
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
                ✏️ — текст этикетки · 🎨 — дизайн всех этикеток
              </div>
            )}
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
        onReset={() => setDraftDesign(DEFAULT_LABEL_DESIGN)}
      />
    </div>
  )
}
