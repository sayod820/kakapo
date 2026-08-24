'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RevisionDeviceOption } from '@/lib/revisionMeta'

type Props = {
  options: RevisionDeviceOption[]
  selectedKeys: string[]
  onChange: (keys: string[]) => void
  currentQueueLen?: number
  /** step = полный экран шага; button = компактная кнопка (редактирование) */
  variant?: 'button' | 'step'
  onBack?: () => void
  onConfirm?: () => void
  confirmLabel?: string
  confirming?: boolean
}

function shortDeviceLabel(opt: RevisionDeviceOption): string {
  const raw = opt.label || ''
  const sep = raw.lastIndexOf(' · ')
  return sep >= 0 ? raw.slice(sep + 3) : raw
}

function deviceKind(opt: RevisionDeviceOption): 'pc' | 'phone' | 'other' {
  const n = shortDeviceLabel(opt).toLowerCase()
  if (n.includes('android') || n.includes('iphone') || n.includes('тел')) return 'phone'
  if (n.includes('пк') || n.includes('касса')) return 'pc'
  return 'other'
}

function deviceIcon(kind: 'pc' | 'phone' | 'other'): string {
  if (kind === 'phone') return '📱'
  if (kind === 'pc') return '🖥'
  return '💻'
}

export default function RevisionWaitDevicesPanel({
  options,
  selectedKeys,
  onChange,
  currentQueueLen = 0,
  variant = 'button',
  onBack,
  onConfirm,
  confirmLabel,
  confirming = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [draftKeys, setDraftKeys] = useState<string[]>(selectedKeys)

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const draftSet = useMemo(() => new Set(draftKeys), [draftKeys])
  const activeKeys = variant === 'step' ? selectedKeys : draftKeys
  const activeSet = variant === 'step' ? selectedSet : draftSet

  useEffect(() => {
    if (variant === 'button' && !open) setDraftKeys(selectedKeys)
  }, [open, selectedKeys, variant])

  useEffect(() => {
    if (variant === 'step') setDraftKeys(selectedKeys)
  }, [variant, selectedKeys])

  const excludedWithQueue = useMemo(() => {
    if (currentQueueLen <= 0) return false
    const current = options.find(o => o.isCurrentDevice)
    if (!current) return false
    return !activeSet.has(current.key)
  }, [options, activeSet, currentQueueLen])

  function toggle(key: string) {
    if (variant === 'step') {
      const next = new Set(selectedKeys)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      onChange([...next])
      return
    }
    setDraftKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return [...next]
    })
  }

  function pickDefaults() {
    const keys = options.filter(o => o.adminDefault).map(o => o.key)
    if (variant === 'step') onChange(keys)
    else setDraftKeys(keys)
  }

  function pickAll() {
    const keys = options.map(o => o.key)
    if (variant === 'step') onChange(keys)
    else setDraftKeys(keys)
  }

  function saveButton() {
    onChange(draftKeys)
    setOpen(false)
  }

  const selectedN = options.filter(o => selectedSet.has(o.key)).length
  const activeN = options.filter(o => activeSet.has(o.key)).length

  const list = (
    <>
      <div className="k-rev-devs-sheet-tools">
        <button type="button" className="k-btn k-btn-s" onClick={pickDefaults}>По умолчанию</button>
        <button type="button" className="k-btn k-btn-s" onClick={pickAll}>Все</button>
        <span className="k-rev-devs-sheet-n">{activeN}/{options.length || 0}</span>
      </div>

      {!options.length ? (
        <div className="k-rcpt-empty">Нет привязанных устройств — обновите страницу</div>
      ) : (
        <div className="k-rev-devs-sheet-list">
          {options.map(opt => {
            const checked = activeSet.has(opt.key)
            const kind = deviceKind(opt)
            return (
              <label key={opt.key} className={`k-rev-devs-row${checked ? ' on' : ''}${opt.isCurrentDevice ? ' cur' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(opt.key)} />
                <span className="k-rev-devs-row-ic" aria-hidden>{deviceIcon(kind)}</span>
                <span className="k-rev-devs-row-txt">
                  <b>{shortDeviceLabel(opt)}</b>
                  <small>
                    {opt.isCurrentDevice ? 'это устройство · ' : ''}
                    {opt.adminDefault ? 'ждём по умолчанию' : 'админ: не ждать'}
                  </small>
                </span>
              </label>
            )
          })}
        </div>
      )}

      {excludedWithQueue && (
        <div className="k-rev-devs-sheet-warn">
          На этом аппарате очередь {currentQueueLen} — если не ждать его, факт может быть неверным
        </div>
      )}
    </>
  )

  if (variant === 'step') {
    return (
      <div className="k-rev-devs-step">
        <div className="k-rev-scope-hero">
          <div className="k-rev-scope-hero-ic">📡</div>
          <div>
            <b>Кого ждать перед ±</b>
            <small>Сервер применит ревизию, когда у отмеченных устройств пустая офлайн-очередь</small>
          </div>
        </div>
        {list}
        <div className="k-rev-devs-sheet-actions">
          {onBack && (
            <button type="button" className="k-btn k-btn-s" disabled={confirming} onClick={onBack}>
              ← Обход
            </button>
          )}
          <button
            type="button"
            className="k-btn k-btn-g"
            style={{ background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
            disabled={confirming || activeN === 0}
            onClick={() => onConfirm?.()}
          >
            {confirming ? '…' : (confirmLabel || `Провести · ${activeN}`)}
          </button>
        </div>
      </div>
    )
  }

  if (!options.length) {
    return (
      <button type="button" className="k-rev-devs-btn k-rev-devs-btn--empty" disabled>
        Устройства…
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        className={`k-rev-devs-btn${excludedWithQueue ? ' warn' : ''}`}
        onClick={() => setOpen(true)}
        title="Кого ждать перед проведением ревизии"
      >
        <span className="k-rev-devs-btn-ic">📡</span>
        <span className="k-rev-devs-btn-txt">
          Устройства <b>{selectedN}/{options.length}</b>
        </span>
        <span className="k-rev-devs-btn-go">›</span>
      </button>

      {open && (
        <div className="k-rev-devs-sheet-bg" onClick={() => setOpen(false)}>
          <div className="k-rev-devs-sheet" onClick={e => e.stopPropagation()}>
            <div className="k-rev-devs-sheet-h">
              <div>
                <b>Ждать устройства</b>
                <div className="sub">Пустая очередь на кассе → потом ± на сервере</div>
              </div>
              <button type="button" className="k-rcpt-find-x" onClick={() => setOpen(false)} aria-label="Закрыть">✕</button>
            </div>
            {list}
            <div className="k-rev-devs-sheet-actions">
              <button type="button" className="k-btn k-btn-s" onClick={() => setOpen(false)}>Отмена</button>
              <button
                type="button"
                className="k-btn k-btn-g"
                style={{ background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
                disabled={activeN === 0}
                onClick={saveButton}
              >
                Сохранить · {activeN}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
