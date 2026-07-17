'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

/** px на 1 мм этикетки — крупный холст для удобного редактирования */
function useCanvasScale(labelW: number, labelH: number, fill: boolean) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(fill ? 12 : 4)

  useEffect(() => {
    if (!fill) {
      setScale(4)
      return
    }
    const el = hostRef.current
    if (!el) return

    function measure() {
      const box = hostRef.current
      if (!box) return
      const pad = 48
      const availW = Math.max(280, box.clientWidth - pad)
      const availH = Math.max(200, box.clientHeight - pad)
      const sx = availW / labelW
      const sy = availH / labelH
      setScale(Math.max(6, Math.min(sx, sy, 18)))
    }

    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [fill, labelW, labelH])

  return { hostRef, scale }
}

export default function LabelCanvasEditor({
  design,
  onChange,
  edit = SAMPLE_EDIT,
  fill = false,
}: {
  design: LabelDesign
  onChange: (d: LabelDesign) => void
  edit?: LabelEdit
  /** Растянуть холст на всю доступную область */
  fill?: boolean
}) {
  const { hostRef, scale } = useCanvasScale(design.labelWidthMm, design.labelHeightMm, fill)
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

  const clampEl = useMemo(() => {
    return (el: LabelElement): LabelElement => {
      const maxW = design.labelWidthMm
      const maxH = design.labelHeightMm
      const w = Math.max(el.id.startsWith('line') ? 4 : 8, Math.min(el.w, maxW))
      const h = Math.max(el.id.startsWith('line') ? 0.3 : 2, Math.min(el.h, maxH))
      const x = Math.max(0, Math.min(el.x, maxW - w))
      const y = Math.max(0, Math.min(el.y, maxH - h))
      return { ...el, x, y, w, h }
    }
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
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
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
      return <span style={{ fontSize: 11, color: '#999' }}>скрыто</span>
    }
    if (el.id === 'line1' || el.id === 'line2') {
      return <div style={{ width: '100%', height: Math.max(2, 0.35 * scale), background: '#000' }} />
    }
    if (el.id === 'name') {
      return (
        <div style={{ fontSize: el.fontSizeMm * scale, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.05, width: '100%' }}>
          {retailLabelName(edit)}
        </div>
      )
    }
    if (el.id === 'size') {
      return <div style={{ fontSize: el.fontSizeMm * scale, fontWeight: 600, width: '100%' }}>{edit.size}</div>
    }
    if (el.id === 'price') {
      const justify = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center'
      return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: Math.max(4, scale * 0.4), width: '100%', justifyContent: justify }}>
          <span style={{ fontSize: el.fontSizeMm * scale, fontWeight: 900, lineHeight: 0.92 }}>{labelPriceAmount(edit.price)}</span>
          <span style={{ fontSize: Math.max(2, el.fontSizeMm * 0.28) * scale, fontWeight: 700, paddingBottom: scale * 0.3 }}>сом</span>
        </div>
      )
    }
    if (el.id === 'plu') {
      return <div style={{ fontSize: el.fontSizeMm * scale, fontWeight: 700, width: '100%' }}>PLU {edit.plu}</div>
    }
    if (el.id === 'barcode') {
      const showDigits = design.barcodeShowDigits !== false
      const boxH = mmToLabelPx(el.h)
      const digitReserve = showDigits ? Math.max(10, Math.round(boxH * 0.28)) : 0
      const hPx = Math.max(16, boxH - digitReserve - 2)
      return (
        <div style={{ width: '100%' }}>
          <LabelBarcode value={edit.barcode} height={hPx} color="#000" showText={showDigits} />
        </div>
      )
    }
    return null
  }

  const canvasW = design.labelWidthMm * scale
  const canvasH = design.labelHeightMm * scale
  const handle = Math.max(14, Math.round(scale * 1.1))

  const sidebar = (
    <div style={{
      width: fill ? 300 : undefined,
      minWidth: fill ? 280 : 220,
      maxWidth: fill ? 320 : undefined,
      flex: fill ? '0 0 auto' : 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      overflow: fill ? 'auto' : undefined,
      maxHeight: fill ? '100%' : undefined,
      padding: fill ? '4px 4px 12px' : 0,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800 }}>Блоки</div>
      {elements.map(el => (
        <button
          key={el.id}
          type="button"
          className="k-btn k-btn-s"
          style={{
            justifyContent: 'flex-start',
            padding: '10px 12px',
            fontSize: 13,
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
        <div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card2)' }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>{LABEL_ELEMENT_LABELS[selectedEl.id]}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={selectedEl.visible}
              onChange={e => onChange(updateLabelElement(design, selectedEl.id, { visible: e.target.checked }))}
            />
            Показывать
          </label>
          {selectedEl.id === 'barcode' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={design.barcodeShowDigits !== false}
                onChange={e => onChange({ ...design, barcodeShowDigits: e.target.checked })}
              />
              Номер штрихкода внизу
            </label>
          )}
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
  )

  const canvas = (
    <div
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onClick={() => setSelected(null)}
      style={{
        position: 'relative',
        width: canvasW,
        height: canvasH,
        background: '#fff',
        border: '1px solid #bbb',
        boxShadow: fill ? '0 8px 32px rgba(0,0,0,.18)' : '0 2px 12px rgba(0,0,0,.12)',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
        flexShrink: 0,
      }}
    >
      {/* сетка для ориентира */}
      {fill && (
        <div
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: 'linear-gradient(rgba(0,0,0,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.04) 1px, transparent 1px)',
            backgroundSize: `${scale}px ${scale}px`,
          }}
        />
      )}
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
              // elementBoxStyle uses mm — override to px at current scale
              left: el.x * scale,
              top: el.y * scale,
              width: el.w * scale,
              height: el.h * scale,
              outline: active ? '2px solid #0a7a3e' : '1px dashed rgba(0,0,0,.28)',
              outlineOffset: -1,
              cursor: 'move',
              background: active ? 'rgba(10,122,62,.05)' : 'transparent',
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
                  right: -handle / 3,
                  bottom: -handle / 3,
                  width: handle,
                  height: handle,
                  background: '#0a7a3e',
                  border: '2px solid #fff',
                  borderRadius: 3,
                  cursor: 'nwse-resize',
                  zIndex: 6,
                  boxShadow: '0 1px 4px rgba(0,0,0,.35)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )

  if (fill) {
    return (
      <div style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0, width: '100%' }}>
        <div
          ref={hostRef}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at 50% 40%, #2a2a2a 0%, #141414 70%)',
            borderRadius: 12,
            overflow: 'auto',
            padding: 16,
          }}
        >
          <div>
            <div style={{ color: 'rgba(255,255,255,.55)', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>
              Перетащите блок · угол — размер · {design.labelWidthMm}×{design.labelHeightMm} мм · масштаб ×{scale.toFixed(1)}
            </div>
            {canvas}
          </div>
        </div>
        {sidebar}
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        Перетащите блок · угол справа внизу — размер · этикетка {design.labelWidthMm}×{design.labelHeightMm} мм
      </div>
      <div ref={hostRef} style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {canvas}
        {sidebar}
      </div>
    </div>
  )
}
