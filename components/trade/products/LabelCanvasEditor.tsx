'use client'

import { useCallback, useRef, useState } from 'react'
import LabelBarcode from './LabelBarcode'
import {
  elementBoxStyle,
  isElementShown,
  labelPriceAmount,
  mmToLabelPx,
  retailLabelName,
} from './labelRetailLayout'
import {
  DEFAULT_LABEL_ELEMENTS,
  LABEL_ELEMENT_LABELS,
  getLabelElements,
  updateLabelElement,
  type LabelDesign,
  type LabelEdit,
  type LabelElement,
  type LabelElementId,
} from './labelShared'

const SAMPLE_EDIT: LabelEdit = {
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

type DragMode = 'move' | 'resize'

export default function LabelCanvasEditor({
  design,
  onChange,
  edit = SAMPLE_EDIT,
}: {
  design: LabelDesign
  onChange: (d: LabelDesign) => void
  edit?: LabelEdit
}) {
  const scale = 4
  const canvasRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<LabelElementId | null>('price')
  const dragRef = useRef<{
    id: LabelElementId
    mode: DragMode
    startX: number
    startY: number
    orig: LabelElement
  } | null>(null)

  const elements = getLabelElements(design)
  const selectedEl = elements.find(e => e.id === selected) || null

  const clampEl = useCallback((el: LabelElement): LabelElement => {
    const maxW = design.labelWidthMm
    const maxH = design.labelHeightMm
    const w = Math.max(el.id.startsWith('line') ? 4 : 8, Math.min(el.w, maxW))
    const h = Math.max(el.id.startsWith('line') ? 0.3 : 2, Math.min(el.h, maxH))
    const x = Math.max(0, Math.min(el.x, maxW - w))
    const y = Math.max(0, Math.min(el.y, maxH - h))
    return { ...el, x, y, w, h }
  }, [design.labelWidthMm, design.labelHeightMm])

  function onPointerDown(e: React.PointerEvent, id: LabelElementId, mode: DragMode) {
    e.preventDefault()
    e.stopPropagation()
    const el = elements.find(x => x.id === id)
    if (!el) return
    setSelected(id)
    dragRef.current = {
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...el },
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const dxMm = (e.clientX - drag.startX) / scale
    const dyMm = (e.clientY - drag.startY) / scale
    let next: LabelElement
    if (drag.mode === 'move') {
      next = clampEl({ ...drag.orig, x: drag.orig.x + dxMm, y: drag.orig.y + dyMm })
    } else {
      next = clampEl({
        ...drag.orig,
        w: drag.orig.w + dxMm,
        h: drag.orig.h + dyMm,
      })
    }
    onChange(updateLabelElement(design, drag.id, next))
  }

  function onPointerUp() {
    dragRef.current = null
  }

  function renderContent(el: LabelElement) {
    if (!isElementShown(el, edit) && el.id !== 'line1' && el.id !== 'line2') {
      return <span style={{ fontSize: 10, color: '#999' }}>скрыто</span>
    }
    if (el.id === 'line1' || el.id === 'line2') {
      return <div style={{ width: '100%', height: Math.max(1, 0.35 * scale), background: '#000' }} />
    }
    if (el.id === 'name') {
      return (
        <div style={{ fontSize: `${el.fontSizeMm * scale}mm`, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.05, width: '100%' }}>
          {retailLabelName(edit)}
        </div>
      )
    }
    if (el.id === 'size') {
      return <div style={{ fontSize: `${el.fontSizeMm * scale}mm`, fontWeight: 600, width: '100%' }}>{edit.size}</div>
    }
    if (el.id === 'price') {
      return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, width: '100%', justifyContent: 'center' }}>
          <span style={{ fontSize: `${el.fontSizeMm * scale}mm`, fontWeight: 900, lineHeight: 0.92 }}>{labelPriceAmount(edit.price)}</span>
          <span style={{ fontSize: `${Math.max(2, el.fontSizeMm * 0.28) * scale}mm`, fontWeight: 700, paddingBottom: 2 }}>сом</span>
        </div>
      )
    }
    if (el.id === 'plu') {
      return <div style={{ fontSize: `${el.fontSizeMm * scale}mm`, fontWeight: 700, width: '100%' }}>PLU {edit.plu}</div>
    }
    if (el.id === 'barcode') {
      return (
        <div style={{ width: '100%' }}>
          <LabelBarcode value={edit.barcode} height={Math.max(12, mmToLabelPx(el.h * 0.7))} color="#000" showText={false} />
        </div>
      )
    }
    return null
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        Перетащите блок · угол справа внизу — размер · этикетка {design.labelWidthMm}×{design.labelHeightMm} мм
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClick={() => setSelected(null)}
          style={{
            position: 'relative',
            width: `${design.labelWidthMm * scale}mm`,
            height: `${design.labelHeightMm * scale}mm`,
            background: '#fff',
            border: '1px solid #ccc',
            boxShadow: '0 2px 12px rgba(0,0,0,.12)',
            overflow: 'hidden',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          {elements.map(el => {
            if (!el.visible && el.id !== selected) return null
            const active = selected === el.id
            return (
              <div
                key={el.id}
                onPointerDown={e => onPointerDown(e, el.id, 'move')}
                onClick={e => { e.stopPropagation(); setSelected(el.id) }}
                style={{
                  ...elementBoxStyle(el, scale),
                  outline: active ? '2px solid #0a7a3e' : '1px dashed rgba(0,0,0,.25)',
                  outlineOffset: -1,
                  cursor: 'move',
                  background: active ? 'rgba(10,122,62,.04)' : 'transparent',
                  zIndex: active ? 5 : 1,
                  opacity: el.visible ? 1 : 0.45,
                }}
              >
                {renderContent(el)}
                {active && (
                  <div
                    onPointerDown={e => onPointerDown(e, el.id, 'resize')}
                    style={{
                      position: 'absolute',
                      right: -4,
                      bottom: -4,
                      width: 12,
                      height: 12,
                      background: '#0a7a3e',
                      border: '1px solid #fff',
                      borderRadius: 2,
                      cursor: 'nwse-resize',
                      zIndex: 6,
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div style={{ flex: 1, minWidth: 220, display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>Блоки</div>
          {elements.map(el => (
            <button
              key={el.id}
              type="button"
              className="k-btn k-btn-s"
              style={{
                justifyContent: 'flex-start',
                background: selected === el.id ? 'rgba(10,122,62,.12)' : undefined,
                borderColor: selected === el.id ? '#0a7a3e' : undefined,
              }}
              onClick={() => setSelected(el.id)}
            >
              {LABEL_ELEMENT_LABELS[el.id]}
              {!el.visible ? ' (скрыт)' : ''}
            </button>
          ))}

          {selectedEl && (
            <div style={{ marginTop: 8, display: 'grid', gap: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 12 }}>{LABEL_ELEMENT_LABELS[selectedEl.id]}</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={selectedEl.visible}
                  onChange={e => onChange(updateLabelElement(design, selectedEl.id, { visible: e.target.checked }))}
                />
                Показывать
              </label>
              {!selectedEl.id.startsWith('line') && (
                <div className="k-field">
                  <label>Шрифт ({selectedEl.fontSizeMm.toFixed(1)} мм)</label>
                  <input
                    className="k-inp"
                    type="range"
                    min={selectedEl.id === 'price' ? 4 : 1.2}
                    max={selectedEl.id === 'price' ? 14 : 6}
                    step="0.1"
                    value={selectedEl.fontSizeMm}
                    onChange={e => onChange(updateLabelElement(design, selectedEl.id, { fontSizeMm: Number(e.target.value) }))}
                  />
                </div>
              )}
              <div className="k-grid2">
                <div className="k-field">
                  <label>X мм</label>
                  <input className="k-inp" type="number" step="0.1" value={Number(selectedEl.x.toFixed(1))} onChange={e => onChange(updateLabelElement(design, selectedEl.id, clampEl({ ...selectedEl, x: Number(e.target.value) })))} />
                </div>
                <div className="k-field">
                  <label>Y мм</label>
                  <input className="k-inp" type="number" step="0.1" value={Number(selectedEl.y.toFixed(1))} onChange={e => onChange(updateLabelElement(design, selectedEl.id, clampEl({ ...selectedEl, y: Number(e.target.value) })))} />
                </div>
                <div className="k-field">
                  <label>Ширина</label>
                  <input className="k-inp" type="number" step="0.1" value={Number(selectedEl.w.toFixed(1))} onChange={e => onChange(updateLabelElement(design, selectedEl.id, clampEl({ ...selectedEl, w: Number(e.target.value) })))} />
                </div>
                <div className="k-field">
                  <label>Высота</label>
                  <input className="k-inp" type="number" step="0.1" value={Number(selectedEl.h.toFixed(1))} onChange={e => onChange(updateLabelElement(design, selectedEl.id, clampEl({ ...selectedEl, h: Number(e.target.value) })))} />
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            className="k-btn k-btn-s"
            onClick={() => onChange({ ...design, elements: DEFAULT_LABEL_ELEMENTS.map(e => ({ ...e })) })}
          >
            Сбросить позиции
          </button>
        </div>
      </div>
    </div>
  )
}
