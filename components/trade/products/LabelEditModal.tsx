'use client'

import type { LabelEdit } from './labelShared'

export default function LabelEditModal({
  open,
  edit,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean
  edit: LabelEdit
  onChange: (e: LabelEdit) => void
  onClose: () => void
  onSave: () => void
}) {
  if (!open) return null

  return (
    <div className="k-modal-bg" style={{ zIndex: 1300 }} onClick={onClose}>
      <div className="k-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="k-modal-h">
          <b>✏️ Редактирование этикетки</b>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <div className="k-modal-b" style={{ padding: 16 }}>
          <div className="k-field" style={{ marginBottom: 12 }}>
            <label>Бренд</label>
            <input className="k-inp" value={edit.brand} onChange={e => onChange({ ...edit, brand: e.target.value })} />
          </div>
          <div className="k-field" style={{ marginBottom: 12 }}>
            <label>Название</label>
            <input className="k-inp" value={edit.name} onChange={e => onChange({ ...edit, name: e.target.value })} />
          </div>
          <div className="k-field" style={{ marginBottom: 12 }}>
            <label>Цена (сом)</label>
            <input className="k-inp" type="number" step="0.01" value={edit.price} onChange={e => onChange({ ...edit, price: e.target.value })} />
          </div>
          <div className="k-field" style={{ marginBottom: 12 }}>
            <label>Подпись (вес, артикул, партия)</label>
            <input className="k-inp" value={edit.meta} onChange={e => onChange({ ...edit, meta: e.target.value })} />
          </div>
          <div className="k-field" style={{ marginBottom: 12 }}>
            <label>Штрихкод / PLU</label>
            <input className="k-inp" value={edit.barcode} onChange={e => onChange({ ...edit, barcode: e.target.value })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={edit.showBarcode} onChange={e => onChange({ ...edit, showBarcode: e.target.checked })} />
            <span>Показывать штрихкод на этикетке</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} onClick={onSave}>Сохранить</button>
            <button type="button" className="k-btn k-btn-s" onClick={onClose}>Отмена</button>
          </div>
        </div>
      </div>
    </div>
  )
}
