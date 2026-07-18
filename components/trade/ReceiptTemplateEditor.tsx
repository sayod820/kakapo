'use client'

import { useMemo, useState } from 'react'
import {
  buildDemoReceiptSale,
  buildPosReceiptHtml,
  normalizeReceiptStore,
  DEFAULT_RECEIPT_STORE,
  RECEIPT_TEXT_FIELDS,
  RECEIPT_TOGGLE_FIELDS,
  type ReceiptStoreConfig,
} from '@/lib/printPosReceipt'

type Props = {
  initial: ReceiptStoreConfig
  posLabel?: string
  onSave: (cfg: ReceiptStoreConfig) => void
  onCancel: () => void
  onTestPrint?: (cfg: ReceiptStoreConfig) => Promise<void>
}

type Mode = 'form' | 'code'

const TEXT_GROUPS = Array.from(new Set(RECEIPT_TEXT_FIELDS.map(f => f.group)))

export default function ReceiptTemplateEditor({
  initial,
  posLabel = 'Саунаи Курботу',
  onSave,
  onCancel,
  onTestPrint,
}: Props) {
  const [draft, setDraft] = useState(() => normalizeReceiptStore(initial))
  const [mode, setMode] = useState<Mode>('form')
  const [codeText, setCodeText] = useState(() => JSON.stringify(normalizeReceiptStore(initial), null, 2))
  const [codeErr, setCodeErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const demo = useMemo(() => buildDemoReceiptSale(), [])
  const previewHtml = useMemo(
    () => buildPosReceiptHtml(demo, {
      ...draft,
      posLabel,
      cashierName: demo.cashierName,
    }),
    [demo, draft, posLabel],
  )

  function setField<K extends keyof ReceiptStoreConfig>(key: K, value: ReceiptStoreConfig[K]) {
    setDraft(prev => {
      const next = { ...prev, [key]: value }
      setCodeText(JSON.stringify(next, null, 2))
      return next
    })
  }

  function switchMode(next: Mode) {
    if (next === 'code') {
      setCodeText(JSON.stringify(draft, null, 2))
      setCodeErr('')
    }
    setMode(next)
  }

  function onCodeChange(text: string) {
    setCodeText(text)
    try {
      const parsed = JSON.parse(text)
      setDraft(normalizeReceiptStore(parsed))
      setCodeErr('')
    } catch (e) {
      setCodeErr(e instanceof Error ? e.message : 'Некорректный JSON')
    }
  }

  function resetDefaults() {
    const def = normalizeReceiptStore(DEFAULT_RECEIPT_STORE)
    setDraft(def)
    setCodeText(JSON.stringify(def, null, 2))
    setCodeErr('')
  }

  async function handleTest() {
    if (!onTestPrint) return
    setBusy(true)
    setErr('')
    try {
      await onTestPrint(normalizeReceiptStore(draft))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка печати')
    } finally {
      setBusy(false)
    }
  }

  const saveDisabled = busy || (mode === 'code' && !!codeErr)

  return (
    <div className="receipt-tpl-fs" role="dialog" aria-modal="true" aria-label="Редактор шаблона чека">
      <div className="receipt-tpl-top">
        <div style={{ minWidth: 0 }}>
          <h2>Шаблон чека</h2>
          <p>Превью = печать · XP-58C · 58 мм</p>
        </div>
        <div className="receipt-tpl-top-actions">
          <div className="receipt-tpl-tabs">
            <button
              type="button"
              className={mode === 'form' ? 'receipt-tpl-tab is-active' : 'receipt-tpl-tab'}
              onClick={() => switchMode('form')}
            >
              Форма
            </button>
            <button
              type="button"
              className={mode === 'code' ? 'receipt-tpl-tab is-active' : 'receipt-tpl-tab'}
              onClick={() => switchMode('code')}
            >
              {'{ } Код'}
            </button>
          </div>
          <button
            type="button"
            className="btn-switch-till"
            disabled={busy}
            onClick={resetDefaults}
          >
            Сбросить
          </button>
          {onTestPrint && (
            <button
              type="button"
              className="btn-switch-till"
              disabled={busy}
              onClick={() => void handleTest()}
            >
              {busy ? 'Печатаем…' : '🖨 Тест печати'}
            </button>
          )}
          <button
            type="button"
            className="btn-switch-till"
            disabled={busy}
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            type="button"
            className="btn-pay"
            disabled={saveDisabled}
            onClick={() => onSave(normalizeReceiptStore(draft))}
          >
            Сохранить
          </button>
        </div>
      </div>

      {err ? <div className="receipt-tpl-err">{err}</div> : null}

      <div className="receipt-tpl-body">
        <div className="receipt-tpl-form">
          {mode === 'form' ? (
            <>
              {TEXT_GROUPS.map(group => (
                <div key={group} className="receipt-tpl-group">
                  <h3>{group}</h3>
                  {RECEIPT_TEXT_FIELDS.filter(f => f.group === group).map(f => (
                    <label key={f.key} className="receipt-tpl-field">
                      <span>{f.label}</span>
                      <input
                        className="gate-input"
                        value={String(draft[f.key] ?? '')}
                        onChange={e => setField(f.key, e.target.value as ReceiptStoreConfig[typeof f.key])}
                      />
                    </label>
                  ))}
                </div>
              ))}

              <div className="receipt-tpl-group">
                <h3>Показывать строки</h3>
                <div className="receipt-tpl-toggles">
                  {RECEIPT_TOGGLE_FIELDS.map(f => (
                    <label key={f.key} className="receipt-tpl-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(draft[f.key])}
                        onChange={e => setField(f.key, e.target.checked as ReceiptStoreConfig[typeof f.key])}
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="receipt-tpl-group">
              <h3>{'Шаблон (JSON) — как программирование'}</h3>
              <p className="hint">Правьте значения напрямую. Превью обновляется на лету.</p>
              <textarea
                className="receipt-tpl-code"
                spellCheck={false}
                value={codeText}
                onChange={e => onCodeChange(e.target.value)}
              />
              {codeErr ? <div className="receipt-tpl-err">JSON: {codeErr}</div> : null}
            </div>
          )}
        </div>

        <div className="receipt-tpl-preview-wrap">
          <h3>Превью · 58 мм</h3>
          <div className="receipt-tpl-preview-frame">
            <iframe
              title="Превью чека"
              className="receipt-tpl-iframe"
              srcDoc={previewHtml}
              sandbox=""
            />
          </div>
        </div>
      </div>
    </div>
  )
}
