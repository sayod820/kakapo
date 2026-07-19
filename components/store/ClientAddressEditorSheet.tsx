'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { preloadLeaflet } from '@/lib/leafletLoader'
import {
  loadClientAddresses,
  saveClientAddresses,
  type ClientSavedAddress,
} from '@/lib/clientAddresses'

const AddressMapPicker = dynamic(() => import('@/components/shared/AddressMapPicker'), { ssr: false })

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (entry: ClientSavedAddress) => void
  clientPhone: string
  editEntry?: ClientSavedAddress | null
  sessionKey?: number
  title?: string
  confirmLabel?: string
  /** При регистрации клиент ещё не создан — возвращаем адрес без записи в хранилище. */
  persistOnSave?: boolean
}

const LABELS = ['🏠 Дом', '💼 Работа', '📍 Другое'] as const

function splitStreetParts(street: string) {
  const parts = (street || '').split(',').map(s => s.trim()).filter(Boolean)
  return { mapStreet: parts[0] || street || '', house: parts[1] || '' }
}

function formFromEntry(editEntry: ClientSavedAddress | null | undefined) {
  if (!editEntry) {
    return {
      label: LABELS[0],
      mapStreet: '',
      house: '',
      apt: '',
      floor: '',
      ent: '',
      comment: '',
      coords: null as { lat: number; lng: number } | null,
    }
  }
  const { mapStreet, house } = splitStreetParts(editEntry.street)
  return {
    label: editEntry.label || LABELS[0],
    mapStreet,
    house,
    apt: editEntry.apt || '',
    floor: editEntry.floor || '',
    ent: editEntry.ent || '',
    comment: editEntry.comment || '',
    coords: editEntry.lat != null && editEntry.lng != null
      ? { lat: editEntry.lat, lng: editEntry.lng }
      : null,
  }
}

export default function ClientAddressEditorSheet({
  open,
  onClose,
  onSaved,
  clientPhone,
  editEntry = null,
  sessionKey = 0,
  title,
  confirmLabel = '✓ Подтвердить и вернуться к заказу',
  persistOnSave = true,
}: Props) {
  const [mapStreet, setMapStreet] = useState('')
  const [house, setHouse] = useState('')
  const [apt, setApt] = useState('')
  const [floor, setFloor] = useState('')
  const [ent, setEnt] = useState('')
  const [comment, setComment] = useState('')
  const [label, setLabel] = useState<string>(LABELS[0])
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const mapPickerHeight = typeof window !== 'undefined'
    ? Math.min(460, Math.max(320, Math.round(window.innerHeight * 0.56)))
    : 380

  useEffect(() => {
    if (!open) return
    preloadLeaflet()
    void import('@/components/shared/AddressMapPicker')
  }, [open])

  useEffect(() => {
    if (!open) {
      setMapReady(false)
      return
    }
    const next = formFromEntry(editEntry)
    setLabel(next.label)
    setMapStreet(next.mapStreet)
    setHouse(next.house)
    setApt(next.apt)
    setFloor(next.floor)
    setEnt(next.ent)
    setComment(next.comment)
    setCoords(next.coords)
    setMapReady(true)
  }, [open, sessionKey, editEntry?.id, editEntry?.lat, editEntry?.lng])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const pickerInitial = useMemo(() => {
    if (editEntry?.lat != null && editEntry?.lng != null) {
      return { lat: editEntry.lat, lng: editEntry.lng }
    }
    return coords
  }, [editEntry?.id, editEntry?.lat, editEntry?.lng, coords?.lat, coords?.lng, sessionKey])

  const mapInstanceKey = `${sessionKey}-${editEntry?.id ?? 'new'}-${pickerInitial?.lat?.toFixed(5) ?? 'x'}-${pickerInitial?.lng?.toFixed(5) ?? 'y'}`

  if (!open) return null

  const buildFullStreet = () => {
    const parts = [mapStreet.trim(), house.trim()].filter(Boolean)
    return parts.join(', ')
  }

  const handleConfirm = () => {
    const fullStreet = buildFullStreet()
    if (!fullStreet || !coords || !clientPhone.trim()) return

    const list = persistOnSave ? loadClientAddresses(clientPhone) : []
    let saved: ClientSavedAddress

    if (editEntry) {
      saved = {
        ...editEntry,
        label,
        street: fullStreet,
        apt,
        floor,
        ent,
        comment,
        lat: coords.lat,
        lng: coords.lng,
      }
      if (persistOnSave) {
        const next = list.map(a => (a.id === editEntry.id ? saved : a))
        saveClientAddresses(next, clientPhone)
      }
    } else {
      saved = {
        id: Date.now(),
        label,
        street: fullStreet,
        apt,
        floor,
        ent,
        comment,
        def: list.length === 0,
        lat: coords.lat,
        lng: coords.lng,
      }
      if (persistOnSave) saveClientAddresses([...list, saved], clientPhone)
    }

    onSaved(saved)
    onClose()
  }

  const canConfirm = !!buildFullStreet() && !!coords

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400, display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', maxWidth: 480, margin: '0 auto', left: 0, right: 0, height: '100dvh', overflow: 'hidden',
    }}>
      <header style={{
        flexShrink: 0, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid var(--b1)', background: 'rgba(3,11,5,.96)',
      }}>
        <button
          type="button"
          onClick={onClose}
          className="btn"
          style={{
            width: 38, height: 38, borderRadius: 12, background: 'var(--l3)', border: '1px solid var(--b1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div className="ub" style={{ fontSize: 15, fontWeight: 800 }}>
            {title || (editEntry ? 'Изменить адрес' : 'Новый адрес доставки')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
            Укажите точку на карте и детали — вернётесь к оформлению
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flexShrink: 0 }}>
          {mapReady && (
            <AddressMapPicker
              key={mapInstanceKey}
              pickMode="center"
              mapHeight={mapPickerHeight}
              initial={pickerInitial}
              hideConfirm
              addressLabel="Куда"
              addressHelper="Улица подставится с карты, дом введите ниже"
              onCenterChange={({ lat, lng, address }) => {
                setCoords({ lat, lng })
                if (address) setMapStreet(address)
              }}
            />
          )}
        </div>

        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          padding: '8px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {LABELS.map(l => (
              <button
                key={l}
                type="button"
                onClick={() => setLabel(l)}
                className="btn"
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                  border: `1.5px solid ${label === l ? 'rgba(31,215,96,.4)' : 'var(--b1)'}`,
                  background: label === l ? 'rgba(31,215,96,.1)' : 'var(--l3)',
                  color: label === l ? 'var(--gr)' : 'var(--t2)', fontFamily: 'Nunito',
                }}
              >
                {l}
              </button>
            ))}
          </div>

          <div style={{
            borderRadius: 18, background: 'var(--l1)', border: '1px solid var(--b1)',
            padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Улица</div>
              <input className="inp" value={mapStreet} readOnly placeholder="Двигайте карту" style={{ width: '100%', opacity: mapStreet ? 1 : 0.7 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Номер дома *</div>
                <input className="inp" value={house} onChange={e => setHouse(e.target.value)} placeholder="144" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Подъезд</div>
                <input className="inp" value={ent} onChange={e => setEnt(e.target.value)} placeholder="2" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Квартира</div>
                <input className="inp" value={apt} onChange={e => setApt(e.target.value)} placeholder="15" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Этаж</div>
                <input className="inp" value={floor} onChange={e => setFloor(e.target.value)} placeholder="3" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Комментарий</div>
              <input className="inp" value={comment} onChange={e => setComment(e.target.value)} placeholder="Домофон, пожелания..." />
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="btn"
              style={{
                width: '100%', padding: 14, borderRadius: 15,
                background: 'linear-gradient(135deg,var(--gr2),var(--gr))', border: 'none',
                color: 'white', fontSize: 14, fontFamily: 'Nunito', fontWeight: 700,
                opacity: canConfirm ? 1 : 0.5,
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
