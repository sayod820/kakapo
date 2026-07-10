'use client'

import type { CSSProperties } from 'react'
import LabelBarcode from './LabelBarcode'
import { formatLabelMoney, type LabelDesign, type LabelEdit } from './labelShared'

export default function LabelCard({
  edit,
  design,
  onEdit,
}: {
  edit: LabelEdit
  design: LabelDesign
  onEdit: () => void
}) {
  const cardStyle: CSSProperties = {
    background: design.bgColor,
    color: design.textColor,
    border: design.borderStyle === 'none' ? 'none' : `${design.borderStyle === 'dashed' ? '1px dashed' : '1px solid'} ${design.borderColor}`,
    borderRadius: design.borderRadius,
    padding: design.padding,
    minHeight: design.layout === 'compact' ? 100 : 120,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    position: 'relative',
  }

  const brandEl = design.showBrand && (
    <div style={{ fontSize: design.brandSize, fontWeight: 800, color: design.accentColor, letterSpacing: '.06em' }}>
      {edit.brand || 'KAKAPO'}
    </div>
  )

  const nameEl = (
    <div style={{ fontSize: design.nameSize, fontWeight: 800, lineHeight: 1.25, margin: '6px 0' }}>
      {edit.name}
    </div>
  )

  const metaEl = design.showMeta && edit.meta && (
    <div style={{ fontSize: design.metaSize, color: design.textColor, opacity: 0.65, marginTop: 4 }}>
      {edit.meta}
    </div>
  )

  const priceEl = design.showPrice && (
    <div style={{ fontSize: design.priceSize, fontWeight: 900, color: design.accentColor }}>
      {formatLabelMoney(edit.price)}
    </div>
  )

  const pluEl = edit.showPlu && edit.plu && (
    <div style={{ fontSize: design.metaSize, fontWeight: 700, marginTop: 4 }}>
      PLU {edit.plu}
    </div>
  )

  const barcodeEl = edit.showBarcode && (
    <LabelBarcode
      value={edit.barcode}
      height={design.barcodeHeight}
      color={design.textColor}
      showText={design.barcodeShowDigits}
    />
  )

  return (
    <div className="k-label-card" style={cardStyle}>
      <button
        type="button"
        className="k-label-edit-btn"
        onClick={onEdit}
        style={{ position: 'absolute', top: 6, right: 6, border: 'none', background: '#f0f0f0', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
      >
        ✏️
      </button>

      {design.layout === 'price-first' ? (
        <>
          <div>
            {priceEl}
            {brandEl}
            {nameEl}
            {metaEl}
          </div>
          <div>
            {pluEl}
            {barcodeEl}
          </div>
        </>
      ) : design.layout === 'compact' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {brandEl}
              {nameEl}
            </div>
            {priceEl}
          </div>
          {metaEl}
          {pluEl}
          {barcodeEl}
        </>
      ) : (
        <>
          <div>
            {brandEl}
            {nameEl}
            {metaEl}
          </div>
          <div>
            {priceEl}
            {pluEl}
            {barcodeEl}
          </div>
        </>
      )}
    </div>
  )
}
