'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'

type AuditItem = {
  id: string
  atIso: string
  app: 'admin' | 'trade'
  action: string
  entity: string
  entityId?: string
  entityName?: string
  summary: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  actor?: { name?: string; role?: string; adminLogin?: string }
}

const ACTION_LABEL: Record<string, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  sale: 'Продажа',
  return: 'Возврат',
  shift_open: 'Открытие смены',
  shift_close: 'Закрытие смены',
  login: 'Вход',
  other: 'Прочее',
}

const ENTITY_LABEL: Record<string, string> = {
  product: 'Товар',
  client: 'Клиент',
  card: 'Карта',
  debt: 'Долг',
  employee: 'Сотрудник',
  sale: 'Чек',
  shift: 'Смена',
  stock: 'Склад',
  settings: 'Настройки',
}

function fmtWhen(iso: string) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditItem[]>([])
  const [total, setTotal] = useState(0)
  const [retentionDays, setRetentionDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [app, setApp] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [q, setQ] = useState('')
  const [qDraft, setQDraft] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!USE_API) {
      setItems([])
      setLoading(false)
      setErr('Нужен API')
      return
    }
    setLoading(true)
    setErr('')
    try {
      const res = await api.getAuditLog({
        app: app || undefined,
        action: action || undefined,
        entity: entity || undefined,
        q: q || undefined,
        days: 30,
        limit: 300,
      })
      setItems(res.items || [])
      setTotal(res.total || 0)
      setRetentionDays(res.retentionDays || 30)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [app, action, entity, q])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        padding: '12px 14px', borderRadius: 12, background: 'rgba(8,28,16,0.65)',
        border: '1px solid rgba(80,140,100,0.25)',
      }}>
        <select
          value={app}
          onChange={e => setApp(e.target.value)}
          style={sel}
        >
          <option value="">Все приложения</option>
          <option value="admin">Админка</option>
          <option value="trade">Торговля</option>
        </select>
        <select value={action} onChange={e => setAction(e.target.value)} style={sel}>
          <option value="">Все действия</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={entity} onChange={e => setEntity(e.target.value)} style={sel}>
          <option value="">Все объекты</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <form
          onSubmit={e => {
            e.preventDefault()
            setQ(qDraft.trim())
          }}
          style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}
        >
          <input
            value={qDraft}
            onChange={e => setQDraft(e.target.value)}
            placeholder="Поиск: кто, что, название…"
            style={{ ...sel, flex: 1 }}
          />
          <button type="submit" style={btn}>Найти</button>
        </form>
        <button type="button" onClick={() => void load()} style={btn}>Обновить</button>
      </div>

      <div style={{ fontSize: 12, color: '#8FB897' }}>
        Хранение {retentionDays} дней · автоочистка старше срока · сейчас {total} записей
        {loading ? ' · загрузка…' : ''}
      </div>

      {err && (
        <div style={{ color: '#F07178', fontSize: 13 }}>{err}</div>
      )}

      {!loading && !err && items.length === 0 && (
        <div style={{ color: '#8FB897', fontSize: 13, padding: 24, textAlign: 'center' }}>
          Пока нет записей. Действия админки и торговли появятся здесь.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(row => {
          const open = openId === row.id
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => setOpenId(open ? null : row.id)}
              style={{
                textAlign: 'left',
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(80,140,100,0.22)',
                background: open ? 'rgba(20,55,32,0.9)' : 'rgba(8,28,16,0.55)',
                color: '#EBF5ED',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#6A9A78' }}>{fmtWhen(row.atIso)}</span>
                <span style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 6,
                  background: row.app === 'trade' ? 'rgba(90,140,200,0.25)' : 'rgba(70,160,100,0.25)',
                  color: row.app === 'trade' ? '#A8C8E8' : '#A8D8B0',
                }}>
                  {row.app === 'trade' ? 'Торговля' : 'Админка'}
                </span>
                <span style={{ fontSize: 10, color: '#9BB8A4' }}>
                  {ACTION_LABEL[row.action] || row.action}
                  {' · '}
                  {ENTITY_LABEL[row.entity] || row.entity}
                </span>
                <span style={{ fontSize: 12, marginLeft: 'auto', color: '#C8E0D0' }}>
                  {row.actor?.name || 'Система'}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.4 }}>{row.summary || '—'}</div>
              {open && (row.before || row.after) && (
                <div style={{
                  marginTop: 10, display: 'grid', gap: 8,
                  gridTemplateColumns: '1fr 1fr', fontSize: 11, color: '#9BB8A4',
                }}>
                  <pre style={pre}>{JSON.stringify(row.before || {}, null, 2)}</pre>
                  <pre style={pre}>{JSON.stringify(row.after || {}, null, 2)}</pre>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const sel: CSSProperties = {
  background: 'rgba(4,18,10,0.9)',
  border: '1px solid rgba(80,140,100,0.35)',
  color: '#EBF5ED',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
}

const btn: CSSProperties = {
  ...sel,
  cursor: 'pointer',
  background: 'rgba(40,90,55,0.7)',
}

const pre: CSSProperties = {
  margin: 0,
  padding: 8,
  borderRadius: 8,
  background: 'rgba(0,0,0,0.35)',
  overflow: 'auto',
  maxHeight: 160,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}
