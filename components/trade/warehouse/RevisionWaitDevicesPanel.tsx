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

  function pickAll() {
    onChange(options.map(o => o.key))
  }

  if (!options.length) {
    return (
      <div className="k-rev-wait-devs" style={{ margin: '0 10px 12px' }}>
        <div className="k-rev-scope-lbl">Устройства для ожидания</div>
        <div className="k-rev-scope-hint">Нет привязанных устройств — будет использован этот аппарат</div>
      </div>
    )
  }

  return (
    <div className="k-rev-wait-devs" style={{ margin: '0 10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div className="k-rev-scope-lbl" style={{ marginBottom: 0 }}>
          Ждать устройства перед проведением
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="k-btn k-btn-s" style={{ padding: '2px 8px', fontSize: 11 }} onClick={pickDefaults}>
            По умолчанию
          </button>
          <button type="button" className="k-btn k-btn-s" style={{ padding: '2px 8px', fontSize: 11 }} onClick={pickAll}>
            Все
          </button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 8px', lineHeight: 1.4 }}>
        Сервер дождётся пустой очереди только у отмеченных. Снятая галочка = не ждём (сломан / не используется).
      </div>
      <div className="k-rev-wait-list">
        {options.map(opt => {
          const checked = selectedSet.has(opt.key)
          return (
            <label
              key={opt.key}
              className="k-rev-wait-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 10,
                border: `1px solid ${checked ? 'rgba(59,142,240,.35)' : 'var(--border)'}`,
                background: checked ? 'rgba(59,142,240,.08)' : 'transparent',
                marginBottom: 4,
                cursor: 'pointer',
              }}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(opt.key)} />
              <span style={{ fontWeight: 700, flex: 1 }}>{opt.label}</span>
              {opt.isCurrentDevice && (
                <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 800 }}>этот ПК</span>
              )}
              {!opt.adminDefault && (
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>админ: не ждать</span>
              )}
            </label>
          )
        })}
      </div>
      {excludedCurrentWithQueue && (
        <div className="k-rev-scope-hint" style={{ color: 'var(--gold)', marginTop: 6 }}>
          На этом аппарате {currentQueueLen} операций в очереди — если не ждать его, ± может быть неверным.
        </div>
      )}
    </div>
  )
}
