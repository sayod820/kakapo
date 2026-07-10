'use client'

import type { CSSProperties } from 'react'
import LabelBarcode from './LabelBarcode'
import {
  formatLabelMoney,
  type LabelAlign,
  type LabelBlockConfig,
  type LabelBlockId,
  type LabelDesign,
  type LabelEdit,
} from './labelShared'

function alignStyle(align: LabelAlign): CSSProperties {
  return { textAlign: align, width: '100%' }
}

export default function LabelCard({
  edit,
  design,
  onEdit,
  sizeStyle,
}: {
  edit: LabelEdit
  design: LabelDesign
  onEdit?: () => void
  sizeStyle?: CSSProperties
}) {
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
