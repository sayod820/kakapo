'use client'

import type { CSSProperties } from 'react'
import { resolveProductPhoto } from '@/lib/productPhotos'

type ProductLike = {
  id?: number
  name?: string
  e?: string
  photo?: string | null
  photoThumb?: string | null
}

type Props = {
  product: ProductLike
  /** Списки / плитки — миниатюра; карточка товара — полное фото */
  preferThumb?: boolean
  getPhoto?: (id: number) => string | undefined
  alt?: string
  size?: number | 'fill'
  radius?: number
  /** Тёмный фон как в теме; light — только если явно нужно */
  plate?: 'light' | 'dark' | 'none'
  emojiSize?: number
  style?: CSSProperties
  className?: string
}

/**
 * Единый показ фото товара: contain + отступы, без обрезки.
 * По умолчанию тёмный фон темы — без белых пластин.
 */
export default function ProductImage({
  product,
  preferThumb = true,
  getPhoto,
  alt,
  size = 'fill',
  radius = 12,
  plate = 'dark',
  emojiSize,
  style,
  className,
}: Props) {
  const src = resolveProductPhoto(product, { preferThumb, getPhoto })
  const fill = size === 'fill'
  const box: CSSProperties = {
    width: fill ? '100%' : size,
    height: fill ? '100%' : size,
    borderRadius: radius,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
    background:
      plate === 'light'
        ? 'linear-gradient(160deg,#f3f7f4 0%,#e6eee8 100%)'
        : plate === 'dark'
          ? 'linear-gradient(145deg,#121f16,#0c1610)'
          : 'transparent',
    ...style,
  }

  if (src) {
    return (
      <div className={className} style={box}>
        <img
          src={src}
          alt={alt || product.name || ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center',
            display: 'block',
            padding: fill ? 6 : 4,
            boxSizing: 'border-box',
          }}
        />
      </div>
    )
  }

  return (
    <div className={className} style={box}>
      <span style={{ fontSize: emojiSize ?? (fill ? 36 : Math.round(Number(size) * 0.45) || 28), lineHeight: 1 }}>
        {product.e || '📦'}
      </span>
    </div>
  )
}
