'use client'

import LabelCanvasEditor from './LabelCanvasEditor'
import LabelCard from './LabelCard'
import {
  applyPaperPreset,
  DEFAULT_LABEL_DESIGN,
  DEFAULT_LABEL_ELEMENTS,
  LABEL_BLOCK_LABELS,
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
    <div className="k-modal-bg" style={{ zIndex: 1300 }} onClick={onClose}>
      <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 920, maxHeight: '94vh' }}>
        <div className="k-modal-h">
          <b>Дизайн этикетки</b>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <div className="k-modal-b" style={{ padding: 16, overflow: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>Макет</div>
          <div className="k-field" style={{ marginBottom: 16 }}>
            <label>Стиль</label>
            <select
              className="k-sel"
              value={design.layout || 'retail'}
              onChange={e => onChange({
                ...design,
                layout: e.target.value as LabelLayoutId,
                elements: design.elements?.length ? design.elements : DEFAULT_LABEL_ELEMENTS.map(x => ({ ...x })),
              })}
            >
              <option value="retail">Магазин — графический редактор (58×40)</option>
              <option value="blocks">Свободный — список блоков</option>
            </select>
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>Бумага</div>
          <div className="k-grid2" style={{ marginBottom: 16 }}>
            <div className="k-field" style={{ gridColumn: '1 / -1' }}>
              <label>Формат</label>
              <select className="k-sel" value={design.paperPreset} onChange={e => setPaperPreset(e.target.value as PaperPresetId)}>
                {(Object.keys(PAPER_PRESETS) as Array<keyof typeof PAPER_PRESETS>).map(id => (
                  <option key={id} value={id}>{PAPER_PRESETS[id].label}</option>
                ))}
                <option value="custom">Свой размер</option>
              </select>
            </div>
            <div className="k-field">
              <label>Ширина этикетки (мм)</label>
              <input className="k-inp" type="number" min="20" value={design.labelWidthMm} onChange={e => onChange({ ...design, paperPreset: 'custom', labelWidthMm: Number(e.target.value) || 40 })} />
            </div>
            <div className="k-field">
              <label>Высота этикетки (мм)</label>
              <input className="k-inp" type="number" min="15" value={design.labelHeightMm} onChange={e => onChange({ ...design, paperPreset: 'custom', labelHeightMm: Number(e.target.value) || 30 })} />
            </div>
          </div>

          {isRetail ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>
                Графический редактор (как Paint — перетаскивание)
              </div>
              <LabelCanvasEditor design={design} onChange={onChange} />
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>Расположение элементов</div>
              <div style={{ marginBottom: 16 }}>
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
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                  Печать: {design.labelWidthMm}×{design.labelHeightMm} мм на {paperLabel}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', padding: 12, background: 'var(--card2)', borderRadius: 8 }}>
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
            </>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} onClick={onSave}>Применить</button>
            <button
              type="button"
              className="k-btn k-btn-s"
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
            <button type="button" className="k-btn k-btn-s" onClick={onClose}>Отмена</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_LABEL_DESIGN }
