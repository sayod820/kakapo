'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RevisionDeviceOption } from '@/lib/revisionMeta'

type Props = {
  options: RevisionDeviceOption[]
  selectedKeys: string[]
  onChange: (keys: string[]) => void
  /** Очередь на этом аппарате (если сняли галочку с текущего) */
  currentQueueLen?: number
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
}: Props) {
  const [open, setOpen] = useState(false)
  const [draftKeys, setDraftKeys] = useState<string[]>(selectedKeys)

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const draftSet = useMemo(() => new Set(draftKeys), [draftKeys])

  useEffect(() => {
    if (!open) setDraftKeys(selectedKeys)
  }, [open, selectedKeys])

  const excludedCurrentWithQueue = useMemo(() => {
    if (currentQueueLen <= 0) return false
    const current = options.find(o => o.isCurrentDevice)
    if (!current) return false
    return !selectedSet.has(current.key)
  }, [options, selectedSet, currentQueueLen])

  const excludedDraftWithQueue = useMemo(() => {
    if (currentQueueLen <= 0) return false
    const current = options.find(o => o.isCurrentDevice)
    if (!current) return false
    return !draftSet.has(current.key)
  }, [options, draftSet, currentQueueLen])

  function toggleDraft(key: string) {
    setDraftKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return [...next]
    })
  }

  function pickDraftDefaults() {
    setDraftKeys(options.filter(o => o.adminDefault).map(o => o.key))
  }

  function pickDraftAll() {
    setDraftKeys(options.map(o => o.key))
  }

  function save() {
    onChange(draftKeys)
    setOpen(false)
  }

  const selectedN = options.filter(o => selectedSet.has(o.key)).length
  const draftN = options.filter(o => draftSet.has(o.key)).length

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
        className={`k-rev-devs-btn${excludedCurrentWithQueue ? ' warn' : ''}`}
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

            <div className="k-rev-devs-sheet-tools">
              <button type="button" className="k-btn k-btn-s" onClick={pickDraftDefaults}>По умолчанию</button>
              <button type="button" className="k-btn k-btn-s" onClick={pickDraftAll}>Все</button>
              <span className="k-rev-devs-sheet-n">{draftN}/{options.length}</span>
            </div>

            <div className="k-rev-devs-sheet-list">
              {options.map(opt => {
                const checked = draftSet.has(opt.key)
                const kind = deviceKind(opt)
                return (
                  <label key={opt.key} className={`k-rev-devs-row${checked ? ' on' : ''}${opt.isCurrentDevice ? ' cur' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleDraft(opt.key)} />
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

            {excludedDraftWithQueue && (
              <div className="k-rev-devs-sheet-warn">
                На этом аппарате очередь {currentQueueLen} — если не ждать его, ± может быть неверным
              </div>
            )}

            <div className="k-rev-devs-sheet-actions">
              <button type="button" className="k-btn k-btn-s" onClick={() => setOpen(false)}>Отмена</button>
              <button
                type="button"
                className="k-btn k-btn-g"
                style={{ background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
                disabled={draftN === 0}
                onClick={save}
              >
                Сохранить · {draftN}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
