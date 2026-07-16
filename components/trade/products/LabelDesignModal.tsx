'use client'

import LabelCard from './LabelCard'
import {
  applyPaperPreset,
  DEFAULT_LABEL_DESIGN,
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

  return (
    <div className="k-modal-bg" style={{ zIndex: 1300 }} onClick={onClose}>
      <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, maxHeight: '92vh' }}>
        <div className="k-modal-h">
          <b>🎨 Дизайн и печать</b>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <div className="k-modal-b" style={{ padding: 16, overflow: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>🏷️ Макет этикетки</div>
          <div className="k-field" style={{ marginBottom: 16 }}>
            <label>Стиль</label>
            <select
              className="k-sel"
              value={design.layout || 'retail'}
              onChange={e => onChange({ ...design, layout: e.target.value as LabelLayoutId })}
            >
              <option value="retail">Магазин — цена крупно, вес под названием, мелкий штрихкод</option>
              <option value="blocks">Свободный — блоки вручную</option>
            </select>
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>📄 Бумага и размер этикетки</div>
          <div className="k-grid2" style={{ marginBottom: 16 }}>
            <div className="k-field" style={{ gridColumn: '1 / -1' }}>
              <label>Формат бумаги</label>
              <select className="k-sel" value={design.paperPreset} onChange={e => setPaperPreset(e.target.value as PaperPresetId)}>
                {(Object.keys(PAPER_PRESETS) as Array<keyof typeof PAPER_PRESETS>).map(id => (
                  <option key={id} value={id}>{PAPER_PRESETS[id].label}</option>
                ))}
                <option value="custom">Свой размер</option>
              </select>
            </div>
            <div className="k-field">
              <label>Ширина бумаги (мм)</label>
              <input className="k-inp" type="number" min="20" value={design.paperWidthMm} onChange={e => onChange({ ...design, paperPreset: 'custom', paperWidthMm: Number(e.target.value) || 58 })} />
            </div>
            <div className="k-field">
              <label>Высота бумаги (мм, 0 = лента)</label>
              <input className="k-inp" type="number" min="0" value={design.paperHeightMm} onChange={e => onChange({ ...design, paperPreset: 'custom', paperHeightMm: Number(e.target.value) || 0 })} />
            </div>
            <div className="k-field">
              <label>Ширина этикетки (мм)</label>
              <input className="k-inp" type="number" min="20" value={design.labelWidthMm} onChange={e => onChange({ ...design, paperPreset: 'custom', labelWidthMm: Number(e.target.value) || 40 })} />
            </div>
            <div className="k-field">
              <label>Высота этикетки (мм)</label>
              <input className="k-inp" type="number" min="15" value={design.labelHeightMm} onChange={e => onChange({ ...design, paperPreset: 'custom', labelHeightMm: Number(e.target.value) || 30 })} />
            </div>
            <div className="k-field">
              <label>Отступы (мм)</label>
              <input className="k-inp" type="number" min="0" value={design.marginMm} onChange={e => onChange({ ...design, marginMm: Number(e.target.value) || 0 })} />
            </div>
            <div className="k-field">
              <label>Зазор (мм)</label>
              <input className="k-inp" type="number" min="0" value={design.gapMm} onChange={e => onChange({ ...design, gapMm: Number(e.target.value) || 0 })} />
            </div>
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>↕ Расположение элементов</div>
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

          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>🎨 Цвета и шрифты</div>
          <div className="k-grid2" style={{ marginBottom: 12 }}>
            <div className="k-field"><label>Фон</label><input className="k-inp" type="color" value={design.bgColor} onChange={e => onChange({ ...design, bgColor: e.target.value })} /></div>
            <div className="k-field"><label>Текст</label><input className="k-inp" type="color" value={design.textColor} onChange={e => onChange({ ...design, textColor: e.target.value })} /></div>
            <div className="k-field"><label>Цена</label><input className="k-inp" type="color" value={design.accentColor} onChange={e => onChange({ ...design, accentColor: e.target.value })} /></div>
            <div className="k-field"><label>Рамка</label><input className="k-inp" type="color" value={design.borderColor} onChange={e => onChange({ ...design, borderColor: e.target.value })} /></div>
            <div className="k-field"><label>Название ({design.nameSize}px)</label><input className="k-inp" type="range" min="8" max="20" value={design.nameSize} onChange={e => onChange({ ...design, nameSize: Number(e.target.value) })} /></div>
            <div className="k-field"><label>Цена ({design.priceSize}px)</label><input className="k-inp" type="range" min="12" max="28" value={design.priceSize} onChange={e => onChange({ ...design, priceSize: Number(e.target.value) })} /></div>
            <div className="k-field"><label>Штрихкод ({design.barcodeHeight}px)</label><input className="k-inp" type="range" min="20" max="50" value={design.barcodeHeight} onChange={e => onChange({ ...design, barcodeHeight: Number(e.target.value) })} /></div>
            <div className="k-field">
              <label>Рамка</label>
              <select className="k-sel" value={design.borderStyle} onChange={e => onChange({ ...design, borderStyle: e.target.value as LabelDesign['borderStyle'] })}>
                <option value="solid">Сплошная</option>
                <option value="dashed">Пунктир</option>
                <option value="none">Нет</option>
              </select>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 16 }}>
            <input type="checkbox" checked={design.barcodeShowDigits} onChange={e => onChange({ ...design, barcodeShowDigits: e.target.checked })} />
            Цифры под штрихкодом
          </label>

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
                  barcode: '4600123456789',
                  plu: '',
                  showBarcode: true,
                  showPlu: false,
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} onClick={onSave}>Применить</button>
            <button type="button" className="k-btn k-btn-s" onClick={onReset}>Сброс</button>
            <button type="button" className="k-btn k-btn-s" onClick={onClose}>Отмена</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_LABEL_DESIGN }
