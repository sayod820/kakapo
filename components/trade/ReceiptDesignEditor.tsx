'use client'

import type { ReactNode } from 'react'
import {
  DEFAULT_RECEIPT_TEMPLATE,
  RECEIPT_FONT_OPTIONS,
  type ReceiptFont,
  type ReceiptFontWeight,
  type ReceiptLang,
  type ReceiptTemplate,
} from '@/lib/receiptTemplate'

type Props = {
  open: boolean
  value: ReceiptTemplate
  previewHtml: string
  printBusy?: boolean
  onChange: (patch: Partial<ReceiptTemplate>) => void
  onReplace: (value: ReceiptTemplate) => void
  onClose: () => void
  onSave: () => void
  onTest: () => void
}

export default function ReceiptDesignEditor({
  open,
  value,
  previewHtml,
  printBusy,
  onChange,
  onReplace,
  onClose,
  onSave,
  onTest,
}: Props) {
  if (!open) return null

  const setLang = (lang: ReceiptLang) => onChange({ lang })
  const resetDesign = () => onReplace({
    ...DEFAULT_RECEIPT_TEMPLATE,
    lang: value.lang,
    storeName: value.storeName,
    storeAddress: value.storeAddress,
    storePhone: value.storePhone,
    headerText: value.headerText,
    footerThanks: value.footerThanks,
    footerNote: value.footerNote,
  })

  return (
    <div className="receipt-design-modal" role="dialog" aria-modal="true" aria-label="Редактор дизайна чека">
      <div className="receipt-design-top">
        <div>
          <h2>Дизайн чека · XP-58C</h2>
          <p>58 мм · 203 DPI · 384 точки</p>
        </div>
        <button type="button" className="btn-switch-till" onClick={onClose}>✕ Закрыть</button>
      </div>

      <div className="receipt-design-body">
        <div className="receipt-design-controls">
          <section className="receipt-editor-box">
            <div className="receipt-editor-title">Язык и тексты</div>
            <div className="receipt-lang-toggle">
              <button type="button" className={value.lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>Русский</button>
              <button type="button" className={value.lang === 'tg' ? 'on' : ''} onClick={() => setLang('tg')}>Тоҷикӣ</button>
            </div>
            <Field label="Название магазина">
              <input className="gate-input" value={value.storeName} onChange={e => onChange({ storeName: e.target.value })} />
            </Field>
            <Field label="Подзаголовок">
              <input className="gate-input" value={value.headerText} onChange={e => onChange({ headerText: e.target.value })} placeholder={value.lang === 'tg' ? 'мағоза · хазина' : 'магазин · касса'} />
            </Field>
            <div className="receipt-editor-two">
              <Field label="Адрес">
                <input className="gate-input" value={value.storeAddress} onChange={e => onChange({ storeAddress: e.target.value })} />
              </Field>
              <Field label="Телефон">
                <input className="gate-input" value={value.storePhone} onChange={e => onChange({ storePhone: e.target.value })} />
              </Field>
            </div>
            <Field label="Текст «Спасибо»">
              <input className="gate-input" value={value.footerThanks} onChange={e => onChange({ footerThanks: e.target.value })} />
            </Field>
            <Field label="Нижняя строка">
              <input className="gate-input" value={value.footerNote} onChange={e => onChange({ footerNote: e.target.value })} />
            </Field>
          </section>

          <section className="receipt-editor-box">
            <div className="receipt-editor-title">Контейнер</div>
            <Range label={`Поля · ${value.paddingMm} мм${value.paddingMm === 0 ? ' · край–край' : ''}`} min={0} max={6} step={0.5} value={value.paddingMm} onChange={n => onChange({ paddingMm: n })} />
            <Range label={`Ширина · ${value.contentWidthPct}%`} min={88} max={100} step={1} value={value.contentWidthPct} onChange={n => onChange({ contentWidthPct: n })} />
            <button type="button" className="receipt-editor-reset" onClick={() => onChange({ paddingMm: 0, contentWidthPct: 100 })}>Растянуть от края до края</button>
          </section>

          <section className="receipt-editor-box">
            <div className="receipt-editor-title">Шрифт</div>
            <Field label="Семейство">
              <select className="gate-input" value={value.fontFamily} onChange={e => onChange({ fontFamily: e.target.value as ReceiptFont })}>
                {RECEIPT_FONT_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Жирность">
              <select className="gate-input" value={value.fontWeight} onChange={e => onChange({ fontWeight: e.target.value as ReceiptFontWeight })}>
                <option value="normal">Обычный</option>
                <option value="medium">Средний</option>
                <option value="bold">Жирный</option>
                <option value="black">Очень жирный</option>
              </select>
            </Field>
            <Range label={`Размер · ${value.fontScale}%`} min={80} max={140} step={5} value={value.fontScale} onChange={n => onChange({ fontScale: n })} />
            <Range label={`Межстрочный · ${value.lineHeightPct}%`} min={110} max={160} step={5} value={value.lineHeightPct} onChange={n => onChange({ lineHeightPct: n })} />
            <Range label={`Межбуквенный · ${(value.letterSpacing / 100).toFixed(2)}em`} min={0} max={80} step={5} value={value.letterSpacing} onChange={n => onChange({ letterSpacing: n })} />
          </section>

          <section className="receipt-editor-box">
            <div className="receipt-editor-title">Печать XP-58C</div>
            <Field label="Режим">
              <select className="gate-input" value={value.printMode} onChange={e => onChange({ printMode: e.target.value === 'text' ? 'text' : 'raster' })}>
                <option value="raster">Дизайн как на фото (HTML-растр) — рекомендуется</option>
                <option value="text">Только нативный шрифт принтера (без плашки)</option>
              </select>
            </Field>
            <Range label={`Плотность · ${value.printDensity}/5${value.printDensity >= 4 ? ' · темнее' : ' · без заливки цифр'}`} min={1} max={5} step={1} value={value.printDensity} onChange={n => onChange({ printDensity: n })} />
            <div className="pos-settings-status ok">Печать = предпросмотр · Arial · чёрная плашка · 203 DPI</div>
          </section>

          <section className="receipt-editor-box">
            <div className="receipt-editor-title">Стиль</div>
            <div className="receipt-editor-two">
              <Field label="Разделители">
                <select className="gate-input" value={value.separatorStyle} onChange={e => onChange({ separatorStyle: e.target.value === 'solid' || e.target.value === 'dashed' ? e.target.value : 'dotted' })}>
                  <option value="dotted">Точки</option>
                  <option value="dashed">Пунктир</option>
                  <option value="solid">Сплошные</option>
                </select>
              </Field>
              <Field label="Заголовок">
                <select className="gate-input" value={value.titleAlign} onChange={e => onChange({ titleAlign: e.target.value === 'left' ? 'left' : 'center' })}>
                  <option value="center">По центру</option>
                  <option value="left">Слева</option>
                </select>
              </Field>
            </div>
            <div className="receipt-editor-checks">
              <Check label="Чёрная плашка" checked={value.titleInverted} onChange={v => onChange({ titleInverted: v })} />
              <Check label="Жирные суммы" checked={value.valuesBold} onChange={v => onChange({ valuesBold: v })} />
              <Check label="Компактно" checked={value.compact} onChange={v => onChange({ compact: v })} />
              <Check label="МАГАЗИН Caps" checked={value.shopUppercase} onChange={v => onChange({ shopUppercase: v })} />
              <Check label="Клиент" checked={value.showCustomer} onChange={v => onChange({ showCustomer: v })} />
              <Check label="Кассир" checked={value.showCashier} onChange={v => onChange({ showCashier: v })} />
              <Check label="Адрес" checked={value.showAddress} onChange={v => onChange({ showAddress: v })} />
              <Check label="Телефон" checked={value.showPhone} onChange={v => onChange({ showPhone: v })} />
              <Check label="Низ чека" checked={value.showFooter} onChange={v => onChange({ showFooter: v })} />
            </div>
            <button type="button" className="receipt-editor-reset" onClick={resetDesign}>Вернуть стандартный шаблон</button>
          </section>
        </div>

        <aside className="receipt-design-preview">
          <div className="receipt-design-preview-head">
            <b>Предпросмотр · 58 мм</b>
            <span>Печать использует этот шаблон</span>
          </div>
          <div className="receipt-tpl-preview">
            <iframe title="Предпросмотр чека" srcDoc={previewHtml} sandbox="" />
          </div>
        </aside>
      </div>

      <div className="receipt-design-actions">
        <button type="button" className="btn-switch-till" disabled={printBusy} onClick={onTest}>
          {printBusy ? 'Печать…' : '🖨 Тест чека'}
        </button>
        <button type="button" className="btn-switch-till" onClick={onClose}>Отмена</button>
        <button type="button" className="btn-gate" onClick={onSave}>Сохранить дизайн</button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="pos-settings-field"><span className="gate-label">{label}</span>{children}</div>
}

function Range({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div className="pos-settings-field">
      <span className="gate-label">{label}</span>
      <input className="receipt-editor-range" type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} />
    </div>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />{label}</label>
}
