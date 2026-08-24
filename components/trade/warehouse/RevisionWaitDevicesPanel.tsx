'use client'

import { useMemo } from 'react'
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

export default function RevisionWaitDevicesPanel({
  options,
  selectedKeys,
  onChange,
  currentQueueLen = 0,
}: Props) {
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys])

  const excludedCurrentWithQueue = useMemo(() => {
    if (currentQueueLen <= 0) return false
    const current = options.find(o => o.isCurrentDevice)
    if (!current) return false
    return !selectedSet.has(current.key)
  }, [options, selectedSet, currentQueueLen])

  function toggle(key: string) {
    const next = new Set(selectedSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange([...next])
  }

  function pickDefaults() {
    onChange(options.filter(o => o.adminDefault).map(o => o.key))
  }

  if (!options.length) {
    return (
      <div className="k-rev-devs-bar k-rev-devs-bar--empty">
        <span className="k-rev-devs-lbl">Устройства</span>
        <span className="k-rev-devs-hint">Загрузка списка… откройте форму заново или обновите страницу</span>
      </div>
    )
  }

  const selectedN = options.filter(o => selectedSet.has(o.key)).length

  return (
    <div className="k-rev-devs-bar">
      <div className="k-rev-devs-top">
        <span className="k-rev-devs-lbl">Ждать перед ±</span>
        <span className="k-rev-devs-count">{selectedN}/{options.length}</span>
        <button type="button" className="k-rev-devs-reset" onClick={pickDefaults}>
          По умолчанию
        </button>
      </div>
      <div className="k-rev-devs-chips" role="group" aria-label="Устройства для ожидания">
        {options.map(opt => {
          const checked = selectedSet.has(opt.key)
          const kind = deviceKind(opt)
          const icon = kind === 'phone' ? '📱' : kind === 'pc' ? '🖥' : '💻'
          return (
            <button
              key={opt.key}
              type="button"
              className={`k-rev-dev-chip${checked ? ' on' : ''}${opt.isCurrentDevice ? ' cur' : ''}`}
              onClick={() => toggle(opt.key)}
              title={opt.isCurrentDevice ? 'Это устройство' : opt.label}
            >
              <span className="k-rev-dev-chip-ic" aria-hidden>{icon}</span>
              <span className="k-rev-dev-chip-name">{shortDeviceLabel(opt)}</span>
              {checked && <span className="k-rev-dev-chip-ok">✓</span>}
            </button>
          )
        })}
      </div>
      {excludedCurrentWithQueue && (
        <div className="k-rev-devs-warn">
          На этом аппарате очередь {currentQueueLen} — если не ждать, ± может быть неверным
        </div>
      )}
    </div>
  )
}
