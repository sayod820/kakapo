'use client'

import { useMemo, useState } from 'react'
import type { Category } from '@/lib/types'
import type { Product } from '@/lib/types'

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="k-kpi">
      <div className="kl">{label}</div>
      <div className="kv" style={{ color: color || undefined }}>{value}</div>
    </div>
  )
}

export default function CategoryTab({
  categories,
  loaded,
  products,
  roots,
  childrenOf,
  onCreate,
  onDelete,
}: {
  categories: Category[]
  loaded: boolean
  products: Product[]
  roots: Category[]
  childrenOf: (parentId: number) => Category[]
  onCreate: (data: { name: string; parent_id?: number | null; emoji?: string }) => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('📦')
  const [parentId, setParentId] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const productCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products) {
      const key = p.catId || ''
      map.set(key, (map.get(key) || 0) + 1)
    }
    return (cat: Category) => {
      const slug = cat.slug || String(cat.id)
      let n = map.get(slug) || 0
      for (const child of childrenOf(cat.id)) {
        const childSlug = child.slug || String(child.id)
        n += map.get(childSlug) || 0
      }
      return n
    }
  }, [products, childrenOf])

  const subCount = categories.filter(c => c.parent_id != null).length

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    setMsg('')
    try {
      await onCreate({
        name: name.trim(),
        parent_id: parentId === '' ? null : parentId,
        emoji: emoji || '📦',
      })
      setShowAdd(false)
      setName('')
      setEmoji('📦')
      setParentId('')
      setMsg(parentId === '' ? 'Категория создана' : 'Подкатегория создана')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось создать')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(cat: Category) {
    const kids = childrenOf(cat.id)
    if (kids.length) {
      setMsg('Сначала удалите подкатегории')
      return
    }
    if (!confirm(`Удалить «${cat.name}»?`)) return
    try {
      await onDelete(cat.id)
      setMsg('Категория удалена')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  function openAddSub(parent: Category) {
    setParentId(parent.id)
    setShowAdd(true)
    setName('')
    setEmoji('📦')
  }

  function openAddRoot() {
    setParentId('')
    setShowAdd(true)
    setName('')
    setEmoji('📦')
  }

  function CatRow({ cat, depth = 0 }: { cat: Category; depth?: number }) {
    const kids = childrenOf(cat.id)
    const isOpen = !collapsed[cat.id]
    const count = productCount(cat)
    const onlySelfCount = products.filter(p => p.catId === (cat.slug || String(cat.id))).length

    return (
      <>
        <tr style={{ background: depth > 0 ? 'rgba(31,215,96,.03)' : undefined }}>
          <td>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: depth * 22 }}>
              {kids.length > 0 ? (
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  style={{ width: 24, height: 24, padding: 0, fontSize: 11 }}
                  onClick={() => setCollapsed(s => ({ ...s, [cat.id]: !s[cat.id] }))}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
              ) : (
                <span style={{ width: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>
                  {depth > 0 ? '└' : ''}
                </span>
              )}
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: 'var(--green-d)', border: '1px solid rgba(31,215,96,.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>
                {cat.emoji || '📦'}
              </div>
              <div>
                <div style={{ fontWeight: depth > 0 ? 700 : 800 }}>{cat.name}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{cat.slug}</div>
              </div>
            </div>
          </td>
          <td>
            {depth === 0 ? (
              <span className="k-badge" style={{ background: 'var(--green-d)', color: 'var(--green)' }}>Родительская</span>
            ) : (
              <span className="k-badge" style={{ background: '#1a2430', color: 'var(--blue)' }}>
                ↳ {categories.find(c => c.id === cat.parent_id)?.name}
              </span>
            )}
          </td>
          <td className="num" style={{ fontWeight: 800 }}>
            {onlySelfCount}
            {kids.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}> · всего {count}</span>
            )}
          </td>
          <td>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {depth === 0 && (
                <button type="button" className="k-btn k-btn-s" style={{ color: 'var(--blue)' }} onClick={() => openAddSub(cat)}>
                  + Подкат.
                </button>
              )}
              {count === 0 && (
                <button type="button" className="k-btn k-btn-s" style={{ color: 'var(--red)' }} onClick={() => void handleDelete(cat)}>
                  Удалить
                </button>
              )}
            </div>
          </td>
        </tr>
        {isOpen && kids.map(kid => <CatRow key={kid.id} cat={kid} depth={depth + 1} />)}
      </>
    )
  }

  return (
    <>
      <div className="k-page-h" style={{ marginTop: 0 }}>
        <div>
          <h1>📁 Категории</h1>
          <div className="sub">Создавайте родительские категории и подкатегории для каталога товаров.</div>
        </div>
        <button type="button" className="k-btn k-btn-g" onClick={openAddRoot}>+ Родительская категория</button>
      </div>

      <div className="k-kpis">
        <StatCard label="Родительских" value={roots.length} color="var(--green)" />
        <StatCard label="Подкатегорий" value={subCount} color="var(--blue)" />
        <StatCard label="Всего" value={categories.length} />
        <StatCard label="Товаров" value={products.length} color="var(--gold)" />
      </div>

      {msg && <div className="k-alert" style={{ marginBottom: 12 }}>{msg}</div>}

      {showAdd && (
        <section className="k-card" style={{ marginBottom: 16 }}>
          <div className="k-card-h">
            <b>{parentId === '' ? 'Новая категория' : 'Новая подкатегория'}</b>
            <button type="button" className="k-btn k-btn-s" onClick={() => setShowAdd(false)}>Отмена</button>
          </div>
          <div className="k-card-b">
            <div className="k-grid2">
              <div className="k-field">
                <label>Название *</label>
                <input className="k-inp" value={name} onChange={e => setName(e.target.value)} placeholder="Например: Молочное" />
              </div>
              <div className="k-field">
                <label>Иконка</label>
                <input className="k-inp" value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={4} />
              </div>
              {parentId !== '' && (
                <div className="k-field" style={{ gridColumn: '1 / -1' }}>
                  <label>Родитель</label>
                  <input className="k-inp" readOnly value={categories.find(c => c.id === parentId)?.name || ''} />
                </div>
              )}
              {parentId === '' && roots.length > 0 && (
                <div className="k-field" style={{ gridColumn: '1 / -1' }}>
                  <label>Тип</label>
                  <select className="k-sel" value="" onChange={e => setParentId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">Родительская категория</option>
                    {roots.map(r => (
                      <option key={r.id} value={r.id}>Подкатегория в «{r.name}»</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="k-btn k-btn-g" disabled={saving || !name.trim()} onClick={() => void handleCreate()}>
                {saving ? 'Сохранение…' : 'Создать'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="k-card">
        <div className="k-card-b" style={{ padding: 0 }}>
          <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
            <table className="k-tbl">
              <thead>
                <tr>
                  <th>Категория</th>
                  <th>Тип</th>
                  <th className="num">Товаров</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {roots.map(cat => <CatRow key={cat.id} cat={cat} />)}
              </tbody>
            </table>
            {!roots.length && (
              <div className="k-empty">{loaded ? 'Категорий пока нет — создайте первую' : 'Загрузка…'}</div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
