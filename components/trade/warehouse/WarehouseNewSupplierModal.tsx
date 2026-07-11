'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { PosSupplier } from '@/lib/types'

export default function WarehouseNewSupplierModal({
  open,
  initialName = '',
  onClose,
  onCreated,
}: {
  open: boolean
  initialName?: string
  onClose: () => void
  onCreated: (supplier: PosSupplier) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (open) {
      setName(initialName)
      setCategory('')
      setPhone('')
      setAddress('')
      setNote('')
      setMsg('')
    }
  }, [open, initialName])

  if (!open) return null

  async function handleSave() {
    if (!USE_API) return
    const trimmed = name.trim()
    if (!trimmed) {
      setMsg('Укажите название поставщика')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const saved = await api.createSupplier({
        name: trimmed,
        category: category.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        note: note.trim() || undefined,
      })
      onCreated(saved)
      onClose()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось создать поставщика')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="k-modal-bg" style={{ zIndex: 1400 }} onClick={() => !saving && onClose()}>
      <div className="k-modal" onClick={e => e.stopPropagation()}>
        <div className="k-modal-h">
          <b>🚚 Новый поставщик</b>
          <button type="button" onClick={() => !saving && onClose()}>✕</button>
        </div>
        <div className="k-modal-b" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Поставщик появится в общем списке — можно будет отслеживать долг и платежи в разделе «Поставщики».
          </div>
          <div className="k-field">
            <label>Название *</label>
            <input className="k-inp" value={name} onChange={e => setName(e.target.value)} placeholder="Например: ОсОО «Свежие продукты»" autoFocus />
          </div>
          <div className="k-field">
            <label>Категория</label>
            <input className="k-inp" value={category} onChange={e => setCategory(e.target.value)} placeholder="Овощи, молочка, напитки…" />
          </div>
          <div className="k-field">
            <label>Телефон</label>
            <input className="k-inp" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+992 ..." />
          </div>
          <div className="k-field">
            <label>Адрес</label>
            <input className="k-inp" value={address} onChange={e => setAddress(e.target.value)} placeholder="Адрес склада / офиса" />
          </div>
          <div className="k-field" style={{ marginBottom: 0 }}>
            <label>Заметка</label>
            <input className="k-inp" value={note} onChange={e => setNote(e.target.value)} placeholder="Условия оплаты, контактное лицо…" />
          </div>
          {msg && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
              {msg}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Сохранение…' : 'Создать и выбрать'}
            </button>
            <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={onClose}>Отмена</button>
          </div>
        </div>
      </div>
    </div>
  )
}
