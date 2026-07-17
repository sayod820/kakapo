'use client'

import type { CSSProperties } from 'react'
import LabelBarcode from './LabelBarcode'
import {
  elementBoxStyle,
  isElementShown,
  labelPriceAmount,
  mmToLabelPx,
  retailCanvasStyle,
  retailLabelName,
  elementsForDesign,
} from './labelRetailLayout'
import {
  formatLabelMoney,
  type LabelAlign,
  type LabelBlockConfig,
  type LabelBlockId,
  type LabelDesign,
  type LabelEdit,
  type LabelElement,
} from './labelShared'

function alignStyle(align: LabelAlign): CSSProperties {
  return { textAlign: align, width: '100%' }
}

function RetailAbsoluteBody({
  edit,
  design,
  scale = 1,
}: {
  edit: LabelEdit
  design: LabelDesign
  scale?: number
}) {
  const elements = elementsForDesign(design)

  function renderEl(el: LabelElement) {
    if (!isElementShown(el, edit)) return null
    const box = elementBoxStyle(el, scale)

    if (el.id === 'line1' || el.id === 'line2') {
      return (
        <div key={el.id} style={{ ...box, alignItems: 'center' }}>
          <div style={{ width: '100%', height: Math.max(1, (0.35 * scale)), background: '#000' }} />
        </div>
      )
    }

    if (el.id === 'name') {
      return (
        <div
          key={el.id}
          style={{
            ...box,
            fontSize: `${el.fontSizeMm * scale}mm`,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            color: '#000',
          }}
        >
          {retailLabelName(edit)}
        </div>
      )
    }

    if (el.id === 'size') {
      return (
        <div
          key={el.id}
          style={{
            ...box,
            fontSize: `${el.fontSizeMm * scale}mm`,
            fontWeight: 600,
            lineHeight: 1.1,
            color: '#000',
          }}
        >
          {edit.size}
        </div>
      )
    }

    if (el.id === 'price') {
      return (
        <div key={el.id} style={{ ...box, color: '#000' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center',
              gap: `${0.5 * scale}mm`,
              width: '100%',
            }}
          >
            <span style={{ fontSize: `${el.fontSizeMm * scale}mm`, fontWeight: 900, lineHeight: 0.92, letterSpacing: '-0.02em' }}>
              {labelPriceAmount(edit.price)}
            </span>
            <span style={{ fontSize: `${Math.max(2, el.fontSizeMm * 0.28) * scale}mm`, fontWeight: 700, lineHeight: 1, paddingBottom: `${0.6 * scale}mm` }}>
              сом
            </span>
          </div>
        </div>
      )
    }

    if (el.id === 'plu') {
      return (
        <div
          key={el.id}
          style={{
            ...box,
            fontSize: `${el.fontSizeMm * scale}mm`,
            fontWeight: 700,
            lineHeight: 1.1,
            color: '#000',
          }}
        >
          PLU {edit.plu}
        </div>
      )
    }

    if (el.id === 'barcode') {
      const showDigits = design.barcodeShowDigits !== false
      const boxH = mmToLabelPx(el.h)
      const digitReserve = showDigits ? Math.max(10, Math.round(boxH * 0.28)) : 0
      const hPx = Math.max(10, boxH - digitReserve - 2)
      return (
        <div key={el.id} style={{ ...box, width: '100%', maxWidth: `${el.w * scale}mm` }}>
          <div style={{ width: '100%' }}>
            <LabelBarcode
              value={edit.barcode}
              height={hPx}
              color="#000000"
              showText={showDigits}
            />
          </div>
        </div>
      )
    }

    return null
  }

  return (
    <div style={retailCanvasStyle(design, scale)}>
      {elements.map(renderEl)}
    </div>
  )
}

export default function LabelCard({
  edit,
  design,
  onEdit,
  sizeStyle,
  previewScale = 1.4,
}: {
  edit: LabelEdit
  design: LabelDesign
  onEdit?: () => void
  sizeStyle?: CSSProperties
  previewScale?: number
}) {
  if (design.layout === 'retail') {
    return (
      <div
        className="k-label-card"
        style={{
          ...sizeStyle,
          position: 'relative',
          overflow: 'hidden',
          boxSizing: 'border-box',
          width: sizeStyle?.width || `${design.labelWidthMm * previewScale}mm`,
          height: sizeStyle?.height || `${design.labelHeightMm * previewScale}mm`,
        }}
      >
        {onEdit && (
          <button
            type="button"
            className="k-label-edit-btn"
            onClick={onEdit}
            style={{ position: 'absolute', top: 4, right: 4, border: 'none', background: '#f0f0f0', borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer', zIndex: 2 }}
          >
            ✏️
          </button>
        )}
        <RetailAbsoluteBody edit={edit} design={design} scale={previewScale} />
      </div>
    )
  }

  const cardStyle: CSSProperties = {
    ...sizeStyle,
    background: design.bgColor,
    color: design.textColor,
    border: design.borderStyle === 'none' ? 'none' : `${design.borderStyle === 'dashed' ? '1px dashed' : '1px solid'} ${design.borderColor}`,
    borderRadius: design.borderRadius,
    padding: design.padding,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    gap: 4,
    position: 'relative',
    overflow: 'hidden',
    boxSizing: 'border-box',
  }

  function blockVisible(id: LabelBlockId, cfg: LabelBlockConfig) {
    if (!cfg.show) return false
    if (id === 'barcode') return edit.showBarcode
    if (id === 'plu') return edit.showPlu && !!edit.plu
    if (id === 'brand') return !!edit.brand
    if (id === 'name') return !!edit.name
    if (id === 'meta') return !!edit.meta
    if (id === 'price') return true
    return true
  }

  function renderBlock(id: LabelBlockId, align: LabelAlign) {
    const base = alignStyle(align)
    switch (id) {
      case 'brand':
        return (
          <div style={{ ...base, fontSize: design.brandSize, fontWeight: 800, color: design.accentColor, letterSpacing: '.06em' }}>
            {edit.brand || 'KAKAPO'}
          </div>
        )
      case 'name':
        return (
          <div style={{ ...base, fontSize: design.nameSize, fontWeight: 800, lineHeight: 1.2 }}>
            {edit.name}
          </div>
        )
      case 'meta':
        return (
          <div style={{ ...base, fontSize: design.metaSize, opacity: 0.65, lineHeight: 1.2 }}>
            {edit.meta}
          </div>
        )
      case 'price':
        return (
          <div style={{ ...base, fontSize: design.priceSize, fontWeight: 900, color: design.accentColor, lineHeight: 1.1 }}>
            {formatLabelMoney(edit.price)}
          </div>
        )
      case 'plu':
        return (
          <div style={{ ...base, fontSize: design.metaSize, fontWeight: 700 }}>
            PLU {edit.plu}
          </div>
        )
      case 'barcode':
        return (
          <div style={base}>
            <LabelBarcode
              value={edit.barcode}
              height={design.barcodeHeight}
              color={design.textColor}
              showText={design.barcodeShowDigits}
            />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="k-label-card" style={cardStyle}>
      {onEdit && (
        <button
          type="button"
          className="k-label-edit-btn"
          onClick={onEdit}
          style={{ position: 'absolute', top: 4, right: 4, border: 'none', background: '#f0f0f0', borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer', zIndex: 2 }}
        >
          ✏️
        </button>
      )}
      {design.blocks.filter(b => blockVisible(b.id, b)).map(b => (
        <div key={b.id}>{renderBlock(b.id, b.align)}</div>
      ))}
    </div>
  )
}
