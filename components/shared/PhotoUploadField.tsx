'use client'

import { useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'

const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif,image/bmp,image/*'

interface Props {
  value: string
  onChange: (photo: string) => void
  onThumbChange?: (thumb: string) => void
  onUploaded?: (photo: string, thumb: string) => void
  productId?: number | null
  label?: string
  height?: number
}

type Stage = 'idle' | 'upload' | 'done'

export default function PhotoUploadField({
  value,
  onChange,
  onThumbChange,
  onUploaded,
  productId,
  label = 'Фото товара',
  height = 200,
}: Props) {
  const [err, setErr] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const galleryRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const busy = stage === 'upload'

  async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
      reader.readAsDataURL(blob)
    })
  }

  async function processOne(file: File) {
    if (busy) return
    setErr('')
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(file.name)) {
      setErr('Нужен файл изображения')
      return
    }

    try {
      setStage('upload')

      if (USE_API) {
        const result = await api.uploadProductPhoto(file, {
          productId: productId && productId > 0 ? productId : undefined,
          replaceUrl: value || undefined,
          fileName: file.name || 'photo.jpg',
        })
        if (onUploaded) onUploaded(result.url, result.thumbUrl)
        else {
          onChange(result.url)
          onThumbChange?.(result.thumbUrl)
        }
      } else {
        const dataUrl = await blobToDataUrl(file)
        if (onUploaded) onUploaded(dataUrl, dataUrl)
        else {
          onChange(dataUrl)
          onThumbChange?.(dataUrl)
        }
      }
      setStage('done')
      setTimeout(() => setStage('idle'), 700)
    } catch (e) {
      setStage('idle')
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить фото')
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void processOne(file)
  }

  function clearPhoto() {
    if (busy) return
    onChange('')
    onThumbChange?.('')
    setErr('')
    setStage('idle')
  }

  function openGallery() {
    if (!busy) galleryRef.current?.click()
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 7, fontWeight: 700 }}>{label}</div>
      <button
        type="button"
        onClick={openGallery}
        disabled={busy}
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          height,
          padding: 0,
          borderRadius: 14,
          overflow: 'hidden',
          border: value ? '1px solid #162B1A' : '2px dashed #1FD760',
          cursor: busy ? 'wait' : 'pointer',
          background: 'linear-gradient(160deg,#f3f7f4 0%,#e6eee8 100%)',
        }}
      >
        {value ? (
          <img
            src={value}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              objectPosition: 'center',
              display: 'block',
              padding: 10,
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 28, lineHeight: 1 }}>📷</span>
            <span style={{ fontSize: 14, color: '#0C1C0F', fontWeight: 800 }}>Добавить фото</span>
            <span style={{ fontSize: 11, color: '#3D6645', textAlign: 'center', padding: '0 16px' }}>
              Нажмите сюда · галерея или файл
            </span>
            <span style={{ fontSize: 10, color: '#5a7a62' }}>
              Сервер сохранит как WebP · без обрезки
            </span>
          </div>
        )}

        {busy && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(3,11,5,.78)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, color: '#EBF5ED', fontWeight: 700 }}>Обработка WebP…</div>
            <div style={{ width: '70%', height: 6, borderRadius: 99, background: '#162B1A', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '65%', background: '#1FD760' }} />
            </div>
          </div>
        )}

        {value && !busy && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => {
              e.stopPropagation()
              clearPhoto()
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                clearPhoto()
              }
            }}
            title="Удалить фото"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: 'rgba(0,0,0,.75)',
              border: '1px solid rgba(255,255,255,.2)',
              color: 'white',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </span>
        )}
      </button>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={openGallery} style={btnStyle(busy)}>
          Галерея
        </button>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={btnStyle(busy)}>
          Файл
        </button>
        <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()} style={btnStyle(busy)}>
          Камера
        </button>
      </div>

      <input ref={galleryRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept={ACCEPT} onChange={onPick} style={{ display: 'none' }} />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPick}
        style={{ display: 'none' }}
      />

      <div style={{ marginTop: 6, fontSize: 10, color: '#3D6645' }}>
        Одно фото · любой размер · сервер только конвертирует в WebP
      </div>
      {err && <div style={{ marginTop: 5, fontSize: 11, color: '#FF4545' }}>⚠️ {err}</div>}
    </div>
  )
}

function btnStyle(busy: boolean): CSSProperties {
  return {
    flex: 1,
    minWidth: 90,
    padding: '10px 12px',
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 10,
    background: '#0C1C0F',
    border: '1px solid #1D3822',
    color: busy ? '#3D6645' : '#8FB897',
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }
}
