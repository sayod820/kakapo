'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { resolvePhotoUrl } from '@/lib/productPhotos'

const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif,image/bmp,image/*'

const PHOTO_CSS = `
.k-photo-field{--ph-bg:var(--card2,#EAF1EC);--ph-border:var(--border,#D0DDD4);--ph-text:var(--text,#0C1A10);--ph-muted:var(--muted,#4A6B52);--ph-muted2:var(--muted2,#7A9580);--ph-green:var(--green,#129B45);--ph-green-d:var(--green-d,#D6F0DF);--ph-panel:var(--panel,#fff)}
.k-photo-field .ph-label{font-size:11px;color:var(--ph-muted);margin-bottom:7px;font-weight:700}
.k-photo-field.compact .ph-label{font-size:10px;margin-bottom:4px}
.k-photo-field .ph-drop{
  position:relative;display:block;width:100%;padding:0;overflow:hidden;
  border-radius:14px;cursor:pointer;
  background:var(--ph-bg);
  border:2px dashed var(--ph-green);
  color:var(--ph-text);
}
.k-photo-field .ph-drop.has-photo{border-style:solid;border-color:var(--ph-border);border-width:1px}
.k-photo-field .ph-drop:disabled{cursor:wait}
.k-photo-field.compact .ph-drop{border-radius:12px;width:var(--ph-size,112px);max-width:100%}
.k-photo-field .ph-img{
  width:100%;height:100%;object-fit:contain;object-position:center;display:block;
  padding:10px;box-sizing:border-box;pointer-events:none;background:var(--ph-panel)
}
.k-photo-field.compact .ph-img{padding:4px}
.k-photo-field .ph-empty{
  position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:8px;padding:6px;background:var(--ph-green-d)
}
.k-photo-field.compact .ph-empty{gap:2px}
.k-photo-field .ph-empty .ico{font-size:28px;line-height:1}
.k-photo-field.compact .ph-empty .ico{font-size:22px}
.k-photo-field .ph-empty .ttl{font-size:14px;color:var(--ph-green);font-weight:800}
.k-photo-field.compact .ph-empty .ttl{font-size:11px}
.k-photo-field .ph-empty .sub{font-size:11px;color:var(--ph-muted);text-align:center;padding:0 12px}
.k-photo-field .ph-empty .hint{font-size:10px;color:var(--ph-muted2)}
.k-photo-field .ph-busy{
  position:absolute;inset:0;background:color-mix(in srgb, var(--ph-panel) 82%, transparent);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px
}
.k-photo-field .ph-busy span{font-size:12px;color:var(--ph-text);font-weight:700}
.k-photo-field .ph-bar{width:70%;height:5px;border-radius:99px;background:var(--ph-border);overflow:hidden}
.k-photo-field .ph-bar>i{display:block;height:100%;width:65%;background:var(--ph-green)}
.k-photo-field .ph-clear{
  position:absolute;top:4px;right:4px;width:30px;height:30px;border-radius:50%;
  background:color-mix(in srgb, var(--ph-text) 75%, transparent);border:1px solid color-mix(in srgb, var(--ph-panel) 35%, transparent);
  color:var(--ph-panel);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center
}
.k-photo-field.compact .ph-clear{width:24px;height:24px}
.k-photo-field .ph-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;width:100%}
.k-photo-field.compact .ph-actions{gap:4px;margin-top:6px;width:var(--ph-size,112px)}
.k-photo-field .ph-btn{
  flex:1;min-width:90px;padding:10px 12px;font-size:12px;font-weight:700;border-radius:10px;
  background:var(--ph-bg);border:1px solid var(--ph-border);color:var(--ph-muted);cursor:pointer
}
.k-photo-field .ph-btn:hover:not(:disabled){border-color:var(--ph-green);color:var(--ph-green)}
.k-photo-field .ph-btn:disabled{opacity:.55;cursor:not-allowed}
.k-photo-field.compact .ph-btn{min-width:0;padding:5px 4px;font-size:10px;border-radius:8px}
.k-photo-field .ph-foot{margin-top:6px;font-size:10px;color:var(--ph-muted2)}
.k-photo-field .ph-err{margin-top:4px;font-size:11px;color:var(--red,#DC2626)}
`

interface Props {
  value: string
  onChange: (photo: string) => void
  onThumbChange?: (thumb: string) => void
  onUploaded?: (photo: string, thumb: string) => void
  productId?: number | null
  label?: string
  height?: number
  /** Компактный квадрат + мелкие кнопки (редактор товара) */
  compact?: boolean
}

type Stage = 'idle' | 'upload' | 'done'

export default function PhotoUploadField({
  value,
  onChange,
  onThumbChange,
  onUploaded,
  productId,
  label = 'Фото',
  height = 200,
  compact = false,
}: Props) {
  const [err, setErr] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const galleryRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const busy = stage === 'upload'
  const boxH = compact ? Math.min(height, 120) : height
  const preview = resolvePhotoUrl(value) || value

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
    <div
      className={`k-photo-field${compact ? ' compact' : ''}`}
      style={compact ? { ['--ph-size' as string]: `${boxH}px` } : undefined}
    >
      <style>{PHOTO_CSS}</style>
      <div className="ph-label">{label}</div>
      <button
        type="button"
        className={`ph-drop${preview ? ' has-photo' : ''}`}
        onClick={openGallery}
        disabled={busy}
        style={{ height: boxH }}
      >
        {preview ? (
          <img src={preview} alt="" className="ph-img" />
        ) : (
          <div className="ph-empty">
            <span className="ico">📷</span>
            <span className="ttl">{compact ? 'Фото' : 'Добавить фото'}</span>
            {!compact && (
              <>
                <span className="sub">Нажмите сюда · галерея или файл</span>
                <span className="hint">Сервер сохранит как WebP · без обрезки</span>
              </>
            )}
          </div>
        )}

        {busy && (
          <div className="ph-busy">
            <span>WebP…</span>
            <div className="ph-bar"><i /></div>
          </div>
        )}

        {preview && !busy && (
          <span
            role="button"
            tabIndex={0}
            className="ph-clear"
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
          >
            ✕
          </span>
        )}
      </button>

      <div className="ph-actions">
        <button type="button" className="ph-btn" disabled={busy} onClick={openGallery}>
          Галерея
        </button>
        <button type="button" className="ph-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          Файл
        </button>
        <button type="button" className="ph-btn" disabled={busy} onClick={() => cameraRef.current?.click()}>
          📷
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

      {!compact && (
        <div className="ph-foot">Одно фото · любой размер · сервер только конвертирует в WebP</div>
      )}
      {err && <div className="ph-err">⚠️ {err}</div>}
    </div>
  )
}
