'use client'

import { useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'

const MAX_BYTES = 12 * 1024 * 1024
const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif,image/bmp'

interface Props {
  value: string
  onChange: (photo: string) => void
  onThumbChange?: (thumb: string) => void
  productId?: number | null
  label?: string
  height?: number
}

type Stage = 'idle' | 'bg' | 'upload' | 'done'

export default function PhotoUploadField({
  value,
  onChange,
  onThumbChange,
  productId,
  label = 'Фото товара',
  height = 180,
}: Props) {
  const [err, setErr] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const galleryRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const busy = stage === 'bg' || stage === 'upload'

  async function removeBg(file: File): Promise<Blob> {
    setStage('bg')
    setProgress(0)
    try {
      const { removeBackground } = await import('@imgly/background-removal')
      const blob = await removeBackground(file, {
        device: 'cpu',
        proxyToWorker: false,
        output: { format: 'image/png', quality: 0.92 },
        progress: (_key, current, total) => {
          if (total > 0) setProgress(Math.round((current / total) * 100))
        },
      })
      return blob instanceof Blob ? blob : new Blob([blob], { type: 'image/png' })
    } catch {
      // Если модель не загрузилась — отправляем оригинал, сервер всё равно обрежет и сделает WebP
      return file
    }
  }

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
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name)) {
      setErr('Нужен файл изображения')
      return
    }
    if (file.size > MAX_BYTES) {
      setErr('Файл слишком большой (макс. 12 МБ)')
      return
    }

    try {
      const cleaned = await removeBg(file)
      setStage('upload')
      setProgress(0)

      if (USE_API) {
        const result = await api.uploadProductPhoto(cleaned, {
          productId: productId && productId > 0 ? productId : undefined,
          replaceUrl: value || undefined,
          fileName: (file.name.replace(/\.[^.]+$/, '') || 'photo') + '.png',
        })
        onChange(result.url)
        onThumbChange?.(result.thumbUrl)
      } else {
        const dataUrl = await blobToDataUrl(cleaned)
        onChange(dataUrl)
        onThumbChange?.(dataUrl)
      }
      setStage('done')
      setTimeout(() => setStage('idle'), 800)
    } catch (e) {
      setStage('idle')
      setErr(e instanceof Error ? e.message : 'Не удалось обработать фото')
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

  const stageLabel =
    stage === 'bg' ? `Удаление фона… ${progress ? `${progress}%` : ''}`
      : stage === 'upload' ? 'Сохранение WebP…'
        : stage === 'done' ? 'Готово'
          : ''

  return (
    <div>
      <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 7, fontWeight: 700 }}>{label}</div>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height,
          borderRadius: 14,
          overflow: 'hidden',
          border: '1px solid #162B1A',
          background:
            'linear-gradient(45deg,#0a160c 25%,transparent 25%),linear-gradient(-45deg,#0a160c 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#0a160c 75%),linear-gradient(-45deg,transparent 75%,#0a160c 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
          backgroundColor: '#0C1C0F',
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
              display: 'block',
              imageRendering: 'auto',
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
              gap: 6,
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 13, color: '#8FB897', fontWeight: 700 }}>Одно фото товара</span>
            <span style={{ fontSize: 10, color: '#3D6645', textAlign: 'center', padding: '0 16px' }}>
              Фон уберётся автоматически · WebP высокого качества
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
              padding: 16,
            }}
          >
            <div style={{ fontSize: 13, color: '#EBF5ED', fontWeight: 700 }}>{stageLabel}</div>
            <div style={{ width: '70%', height: 6, borderRadius: 99, background: '#162B1A', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${stage === 'upload' ? 70 : Math.max(8, progress)}%`,
                  background: '#1FD760',
                  transition: 'width .25s ease',
                }}
              />
            </div>
          </div>
        )}

        {value && !busy && (
          <button
            type="button"
            onClick={clearPhoto}
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
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => galleryRef.current?.click()}
          className="ab"
          style={btnStyle(busy)}
        >
          Галерея
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="ab"
          style={btnStyle(busy)}
        >
          Файл
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="ab"
          style={btnStyle(busy)}
        >
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
        Только одно фото · JPG / PNG / WebP · до 12 МБ
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
