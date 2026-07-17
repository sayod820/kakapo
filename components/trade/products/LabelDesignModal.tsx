'use client'

import { useEffect } from 'react'
import LabelCanvasEditor from './LabelCanvasEditor'
import LabelCard from './LabelCard'
import {
  applyPaperPreset,
  DEFAULT_LABEL_DESIGN,
  DEFAULT_LABEL_ELEMENTS,
  LABEL_BLOCK_LABELS,
  LABEL_EDITOR_PREVIEW_EDIT,
  moveBlock,
  PAPER_PRESETS,
  previewCardStyle,
  type LabelBlockConfig,
  type LabelBlockId,
  type LabelDesign,
  type LabelLayoutId,
  type PaperPresetId,
} from './labelShared'

export default function LabelDesignModal({
  open,
  design,
  onChange,
  onClose,
  onSave,
  onReset,
}: {
  open: boolean
  design: LabelDesign
  onChange: (d: LabelDesign) => void
  onClose: () => void
  onSave: () => void
  onReset: () => void
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  function setBlock(id: LabelBlockId, patch: Partial<LabelBlockConfig>) {
    onChange({
      ...design,
      blocks: design.blocks.map(b => (b.id === id ? { ...b, ...patch } : b)),
    })
  }

  function setPaperPreset(preset: PaperPresetId) {
    onChange(applyPaperPreset(preset, design))
  }

  const paperLabel = design.paperPreset === 'custom'
    ? `${design.paperWidthMm}×${design.paperHeightMm || '∞'} мм`
    : PAPER_PRESETS[design.paperPreset as keyof typeof PAPER_PRESETS]?.label || 'Свой'

  const isRetail = design.layout !== 'blocks'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        background: 'var(--bg, #0b0f0c)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          background: 'var(--card, #121812)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Дизайн этикетки — полный экран</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {design.labelWidthMm}×{design.labelHeightMm} мм · {paperLabel} · Esc — закрыть
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="k-sel"
            style={{ width: 220 }}
            value={design.layout || 'retail'}
            onChange={e => onChange({
              ...design,
              layout: e.target.value as LabelLayoutId,
              elements: design.elements?.length ? design.elements : DEFAULT_LABEL_ELEMENTS.map(x => ({ ...x })),
            })}
          >
            <option value="retail">Магазин — графический редактор</option>
            <option value="blocks">Свободный — список блоков</option>
          </select>
          <select
            className="k-sel"
            style={{ width: 200 }}
            value={design.paperPreset}
            onChange={e => setPaperPreset(e.target.value as PaperPresetId)}
          >
            {(Object.keys(PAPER_PRESETS) as Array<keyof typeof PAPER_PRESETS>).map(id => (
              <option key={id} value={id}>{PAPER_PRESETS[id].label}</option>
            ))}
            <option value="custom">Свой размер</option>
          </select>
          <button type="button" className="k-btn k-btn-s" onClick={onClose}>✕ Закрыть</button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
        {isRetail ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <LabelCanvasEditor
              design={design}
              onChange={onChange}
              edit={LABEL_EDITOR_PREVIEW_EDIT}
              editorMode
              fill
            />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>Расположение элементов</div>
            <div style={{ marginBottom: 16, maxWidth: 720 }}>
              {design.blocks.map((block, i) => (
                <div
                  key={block.id}
                  style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto',
                    gap: 8, alignItems: 'center', padding: '8px 10px', marginBottom: 6,
                    background: 'var(--card2)', borderRadius: 8, border: '1px solid var(--border)',
                  }}
                >
                  <input type="checkbox" checked={block.show} onChange={e => setBlock(block.id, { show: e.target.checked })} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{LABEL_BLOCK_LABELS[block.id]}</span>
                  <select className="k-sel" style={{ width: 90, padding: '4px 6px', fontSize: 11 }} value={block.align} onChange={e => setBlock(block.id, { align: e.target.value as LabelBlockConfig['align'] })}>
                    <option value="left">Слева</option>
                    <option value="center">Центр</option>
                    <option value="right">Справа</option>
                  </select>
                  <button type="button" className="k-btn k-btn-s" style={{ padding: '2px 8px' }} disabled={i === 0} onClick={() => onChange({ ...design, blocks: moveBlock(design.blocks, block.id, -1) })}>↑</button>
                  <button type="button" className="k-btn k-btn-s" style={{ padding: '2px 8px' }} disabled={i === design.blocks.length - 1} onClick={() => onChange({ ...design, blocks: moveBlock(design.blocks, block.id, 1) })}>↓</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24, background: 'var(--card2)', borderRadius: 12 }}>
              <LabelCard
                design={design}
                sizeStyle={previewCardStyle(design)}
                edit={{
                  brand: 'KAKAPO',
                  name: 'Пример товара',
                  price: '12.50',
                  meta: '500 гр · KAK-0001',
                  size: '500 г',
                  barcode: '4600123456789',
                  plu: '',
                  showBarcode: true,
                  showPlu: false,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          background: 'var(--card, #121812)',
        }}
      >
        <button type="button" className="k-btn k-btn-g" style={{ minWidth: 160, padding: '12px 18px', fontSize: 14 }} onClick={onSave}>
          Применить ко всем этикеткам
        </button>
        <button
          type="button"
          className="k-btn k-btn-s"
          style={{ padding: '12px 18px' }}
          onClick={() => {
            onReset()
            onChange({
              ...DEFAULT_LABEL_DESIGN,
              elements: DEFAULT_LABEL_ELEMENTS.map(e => ({ ...e })),
            })
          }}
        >
          Сброс
        </button>
        <button type="button" className="k-btn k-btn-s" style={{ padding: '12px 18px' }} onClick={onClose}>
          Отмена
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ alignSelf: 'center', fontSize: 12, color: 'var(--muted)' }}>
          Макет один на все товары · перетаскивание · угол — размер блока
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_LABEL_DESIGN }
