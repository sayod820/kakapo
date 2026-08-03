'use client'

import { useEffect, useRef, useState } from 'react'

export default function MobileBarcodeScanner({
  open,
  onClose,
  onDetect,
  title = 'Сканер штрихкода',
  hint = 'Наведите камеру на штрихкод',
}: {
  open: boolean
  onClose: () => void
  onDetect: (code: string) => void
  title?: string
  hint?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const lastCodeRef = useRef('')
  const lastAtRef = useRef(0)
  const onDetectRef = useRef(onDetect)
  const [err, setErr] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    onDetectRef.current = onDetect
  }, [onDetect])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setErr('')
    setReady(false)
    lastCodeRef.current = ''
    lastAtRef.current = 0

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErr('Нет доступа к камере на этом устройстве.')
        return
      }
      if (!window.isSecureContext && location.hostname !== 'localhost') {
        setErr('Камера работает только по HTTPS. Откройте сайт по защищённой ссылке.')
        return
      }

      const video = videoRef.current
      if (!video) return

      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          video,
          (result, _error, ctrl) => {
            if (cancelled || !result) return
            const raw = String(result.getText() || '').trim()
            if (!raw) return
            const now = Date.now()
            if (raw === lastCodeRef.current && now - lastAtRef.current < 1600) return
            lastCodeRef.current = raw
            lastAtRef.current = now
            try { navigator.vibrate?.(40) } catch { /* ignore */ }
            try { ctrl.stop() } catch { /* ignore */ }
            onDetectRef.current(raw)
          },
        )
        if (cancelled) {
          try { controls.stop() } catch { /* ignore */ }
          return
        }
        stopRef.current = () => {
          try { controls.stop() } catch { /* ignore */ }
        }
        setReady(true)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Не удалось включить камеру. Разрешите доступ к камере.')
      }
    }

    void start()

    return () => {
      cancelled = true
      stopRef.current?.()
      stopRef.current = null
      const video = videoRef.current
      if (video) {
        const stream = video.srcObject as MediaStream | null
        stream?.getTracks().forEach(t => t.stop())
        video.srcObject = null
      }
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="k-modal-bg"
      style={{ zIndex: 2200, padding: 0, background: 'rgba(0,0,0,.88)', alignItems: 'stretch', justifyContent: 'stretch' }}
      onClick={onClose}
    >
      <div
        className="k-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '100%', height: '100dvh', maxHeight: '100dvh',
          borderRadius: 0, display: 'flex', flexDirection: 'column', background: '#0a0f0c',
        }}
      >
        <div className="k-modal-h" style={{ flexShrink: 0, background: 'var(--panel)' }}>
          <div>
            <b>{title}</b>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>{hint}</div>
          </div>
          <button type="button" onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#000' }}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {!err && (
            <div
              aria-hidden
              style={{
                position: 'absolute', inset: '18% 12%',
                border: '2px solid rgba(31,215,96,.85)',
                borderRadius: 16,
                boxShadow: '0 0 0 9999px rgba(0,0,0,.35)',
                pointerEvents: 'none',
              }}
            />
          )}
          {!ready && !err && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 800, fontSize: 14, background: 'rgba(0,0,0,.45)',
            }}>
              Включение камеры…
            </div>
          )}
          {err && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 24, textAlign: 'center',
            }}>
              <div style={{
                background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14,
                padding: 16, maxWidth: 360, fontSize: 13, color: 'var(--text)', lineHeight: 1.45,
              }}>
                {err}
              </div>
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom,0px))',
          background: 'var(--panel)', borderTop: '1px solid var(--border)',
        }}>
          <button type="button" className="k-btn k-btn-s" style={{ width: '100%', minHeight: 48 }} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
