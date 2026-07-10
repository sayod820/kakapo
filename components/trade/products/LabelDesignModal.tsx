'use client'

import type { LabelDesign } from './labelShared'

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

  return (
    <div className="k-modal-bg" style={{ zIndex: 1300 }} onClick={onClose}>
      <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="k-modal-h">
          <b>🎨 Дизайн этикетки</b>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <div className="k-modal-b" style={{ padding: 16 }}>
          <div className="k-grid2">
            <div className="k-field">
              <label>Фон</label>
              <input className="k-inp" type="color" value={design.bgColor} onChange={e => onChange({ ...design, bgColor: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Цвет текста</label>
              <input className="k-inp" type="color" value={design.textColor} onChange={e => onChange({ ...design, textColor: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Цвет цены</label>
              <input className="k-inp" type="color" value={design.accentColor} onChange={e => onChange({ ...design, accentColor: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Рамка</label>
              <input className="k-inp" type="color" value={design.borderColor} onChange={e => onChange({ ...design, borderColor: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Макет</label>
              <select className="k-sel" value={design.layout} onChange={e => onChange({ ...design, layout: e.target.value as LabelDesign['layout'] })}>
                <option value="classic">Классический</option>
                <option value="price-first">Цена сверху</option>
                <option value="compact">Компактный</option>
              </select>
            </div>
            <div className="k-field">
              <label>Стиль рамки</label>
              <select className="k-sel" value={design.borderStyle} onChange={e => onChange({ ...design, borderStyle: e.target.value as LabelDesign['borderStyle'] })}>
                <option value="dashed">Пунктир</option>
                <option value="solid">Сплошная</option>
                <option value="none">Без рамки</option>
              </select>
            </div>
            <div className="k-field">
              <label>Размер названия ({design.nameSize}px)</label>
              <input className="k-inp" type="range" min="10" max="22" value={design.nameSize} onChange={e => onChange({ ...design, nameSize: Number(e.target.value) })} />
            </div>
            <div className="k-field">
              <label>Размер цены ({design.priceSize}px)</label>
              <input className="k-inp" type="range" min="14" max="32" value={design.priceSize} onChange={e => onChange({ ...design, priceSize: Number(e.target.value) })} />
            </div>
            <div className="k-field">
              <label>Отступ ({design.padding}px)</label>
              <input className="k-inp" type="range" min="6" max="20" value={design.padding} onChange={e => onChange({ ...design, padding: Number(e.target.value) })} />
            </div>
            <div className="k-field">
              <label>Высота штрихкода ({design.barcodeHeight}px)</label>
              <input className="k-inp" type="range" min="28" max="64" value={design.barcodeHeight} onChange={e => onChange({ ...design, barcodeHeight: Number(e.target.value) })} />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={design.showBrand} onChange={e => onChange({ ...design, showBrand: e.target.checked })} />
              Бренд
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={design.showMeta} onChange={e => onChange({ ...design, showMeta: e.target.checked })} />
              Подпись
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={design.showPrice} onChange={e => onChange({ ...design, showPrice: e.target.checked })} />
              Цена
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={design.barcodeShowDigits} onChange={e => onChange({ ...design, barcodeShowDigits: e.target.checked })} />
              Цифры под штрихкодом
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} onClick={onSave}>Применить</button>
            <button type="button" className="k-btn k-btn-s" onClick={onReset}>Сброс</button>
            <button type="button" className="k-btn k-btn-s" onClick={onClose}>Отмена</button>
          </div>
        </div>
      </div>
    </div>
  )
}
