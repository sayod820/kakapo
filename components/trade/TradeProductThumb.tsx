'use client'

import type { CSSProperties } from 'react'
import ProductImage from '@/components/shared/ProductImage'

export type TradeProductThumbLike = {
  id?: number
  name?: string
  e?: string
  photo?: string | null
  photoThumb?: string | null
}

/** Миниатюра товара для Торговли: фото или emoji, всегда preferThumb */
export default function TradeProductThumb({
  product,
  size = 32,
  radius = 8,
  plate = 'theme',
  className,
  style,
}: {
  product: TradeProductThumbLike | null | undefined
  size?: number
  radius?: number
  plate?: 'light' | 'dark' | 'none' | 'theme'
  className?: string
  style?: CSSProperties
}) {
  return (
    <ProductImage
      product={product || { e: '📦' }}
      preferThumb
      size={size}
      radius={radius}
      plate={plate}
      emojiSize={Math.max(12, Math.round(size * 0.42))}
      className={className}
      style={style}
    />
  )
}
