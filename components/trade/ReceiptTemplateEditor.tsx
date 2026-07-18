'use client'

import { useMemo, useState } from 'react'
import {
  buildDemoReceiptSale,
  buildPosReceiptHtml,
  normalizeReceiptStore,
  type ReceiptStoreConfig,
} from '@/lib/printPosReceipt'

type Props = {
  initial: ReceiptStoreConfig
  posLabel?: string
  onSave: (cfg: ReceiptStoreConfig) => void
  onCancel: () => void
  onTestPrint?: (cfg: ReceiptStoreConfig) => Promise<void>
}

export default function ReceiptTemplateEditor({
  initial,
  posLabel = 'Саунаи Курботу',
  onSave,
  onCancel,
  onTestPrint,
}: Props) {
  const [draft, setDraft] = useState(() => normalizeReceiptStore(initial))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const demo = useMemo(() => buildDemoReceiptSale(), [])
  const previewHtml = useMemo(
    () => buildPosReceiptHtml(demo, {
      storeName: draft.storeName,
      storePhone: draft.storePhone,
      subtitle: draft.subtitle,
      footerThanks: draft.footerThanks,
      footerNote: draft.footerNote,
      posLabel,
      cashierName: demo.cashierName,
    }),
    [demo, draft, posLabel],
  )

  function setField<K extends keyof ReceiptStoreConfig>(key: K, value: string) {
    setDraft(prev => ({ ...prev, [key]: value }))
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

  return (
    <div className="receipt-tpl-fs" role="dialog" aria-modal="true" aria-label="Редактор шаблона чека">
      <div className="receipt-tpl-top">
        <div style={{ minWidth: 0 }}>
          <h2>Шаблон чека</h2>
          <p>Превью = печать · XP-58C · 58 мм</p>
        </div>
        <div className="receipt-tpl-top-actions">
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
            disabled={busy}
            onClick={() => onSave(normalizeReceiptStore(draft))}
          >
            Сохранить
          </button>
        </div>
      </div>

      {err ? <div className="receipt-tpl-err">{err}</div> : null}

      <div className="receipt-tpl-body">
        <div className="receipt-tpl-form">
          <h3>Тексты шаблона</h3>
          <p className="hint">Раскладка фиксирована как на макете. Меняются только эти строки.</p>

          <label className="receipt-tpl-field">
            <span>Название магазина</span>
            <input
              className="gate-input"
              value={draft.storeName}
              onChange={e => setField('storeName', e.target.value)}
              placeholder="КАКАПО"
            />
          </label>
          <label className="receipt-tpl-field">
            <span>Подзаголовок</span>
            <input
              className="gate-input"
              value={draft.subtitle}
              onChange={e => setField('subtitle', e.target.value)}
              placeholder="магазин - касса"
            />
          </label>
          <label className="receipt-tpl-field">
            <span>Телефон</span>
            <input
              className="gate-input"
              value={draft.storePhone}
              onChange={e => setField('storePhone', e.target.value)}
              placeholder="+992 112 373 333"
            />
          </label>
          <label className="receipt-tpl-field">
            <span>Строка «спасибо»</span>
            <input
              className="gate-input"
              value={draft.footerThanks}
              onChange={e => setField('footerThanks', e.target.value)}
              placeholder="Спасибо за покупку!"
            />
          </label>
          <label className="receipt-tpl-field">
            <span>Строка под «спасибо»</span>
            <input
              className="gate-input"
              value={draft.footerNote}
              onChange={e => setField('footerNote', e.target.value)}
              placeholder="Сохраняйте чек до проверки товара"
            />
          </label>
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
