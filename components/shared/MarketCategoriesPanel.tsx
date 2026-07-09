'use client'

import { useMemo, useState } from 'react'
import { categorySlug } from '@/lib/useCategories'
import type { Category, Product } from '@/lib/types'

type Theme = 'admin' | 'trade'

function AdminBadge({ v, c }: { v: string; c: string }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 7, fontSize: 10, fontWeight: 800, background: `${c}22`, color: c, border: `1px solid ${c}44` }}>
      {v}
    </span>
  )
}

function AdminToggle({ on, set }: { on: boolean; set: () => void }) {
  return (
    <button
      type="button"
      onClick={set}
      style={{
        width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', padding: 2,
        background: on ? '#1FD760' : '#1D3822', transition: '.15s',
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 9, background: '#fff',
        transform: on ? 'translateX(16px)' : 'translateX(0)', transition: '.15s',
      }} />
    </button>
  )
}

export default function MarketCategoriesPanel({
  theme = 'trade',
  showStatus = false,
  categories,
  loaded,
  products,
  roots,
  childrenOf,
  onCreate,
  onUpdate,
  onDelete,
  headerExtra,
}: {
  theme?: Theme
  showStatus?: boolean
  categories: Category[]
  loaded: boolean
  products: Product[]
  roots: Category[]
  childrenOf: (parentId: number) => Category[]
  onCreate: (data: {
    name: string
    parent_id?: number | null
    emoji?: string
    desc?: string
  }) => Promise<void>
  onUpdate: (id: number, data: Partial<Category>) => Promise<void>
  onDelete: (id: number) => Promise<void>
  headerExtra?: React.ReactNode
}) {
  const isAdmin = theme === 'admin'
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [editCat, setEditCat] = useState<Category | null>(null)
  const [nEmoji, setNEmoji] = useState('📦')
  const [nName, setNName] = useState('')
  const [nDesc, setNDesc] = useState('')
  const [nParent, setNParent] = useState<number | ''>('')
  const [eEmoji, setEEmoji] = useState('📦')
  const [eName, setEName] = useState('')
  const [eDesc, setEDesc] = useState('')
  const [eParent, setEParent] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const productCountBySlug = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products) {
      const key = p.catId || ''
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [products])

  const countFor = (cat: Category) => productCountBySlug.get(categorySlug(cat)) || 0

  const subCount = categories.filter(c => c.parent_id != null).length
  const activeCount = categories.filter(c => c.active !== false).length

  function openAddRoot() {
    setNParent('')
    setNName('')
    setNDesc('')
    setNEmoji('📦')
    setShowAdd(true)
  }

  function openAddSub(parent: Category) {
    setNParent(parent.id)
    setNName('')
    setNDesc('')
    setNEmoji('📦')
    setShowAdd(true)
  }

  function openEdit(cat: Category) {
    setEditCat(cat)
    setEEmoji(cat.emoji || '📦')
    setEName(cat.name)
    setEDesc(cat.desc || '')
    setEParent(cat.parent_id ?? '')
  }

  async function handleCreate() {
    if (!nName.trim()) return
    setSaving(true)
    setMsg('')
    try {
      await onCreate({
        name: nName.trim(),
        parent_id: nParent === '' ? null : nParent,
        emoji: nEmoji || '📦',
        desc: nDesc.trim(),
      })
      setShowAdd(false)
      setMsg(nParent === '' ? 'Категория создана' : 'Подкатегория создана')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось создать')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit() {
    if (!editCat || !eName.trim()) return
    setSaving(true)
    setMsg('')
    try {
      await onUpdate(editCat.id, {
        name: eName.trim(),
        emoji: eEmoji || '📦',
        desc: eDesc.trim(),
        parent_id: eParent === '' ? null : eParent,
      })
      setEditCat(null)
      setMsg('Категория обновлена')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(cat: Category) {
    const kids = childrenOf(cat.id)
    const selfCount = countFor(cat)
    const childCount = kids.reduce((s, k) => s + countFor(k), 0)
    if (selfCount + childCount > 0) {
      setMsg('Нельзя удалить: в категории есть товары')
      return
    }
    const label = kids.length ? `«${cat.name}» и все подкатегории` : `«${cat.name}»`
    if (!confirm(`Удалить ${label}?`)) return
    try {
      await onDelete(cat.id)
      setMsg('Категория удалена')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  async function toggleActive(cat: Category) {
    try {
      await onUpdate(cat.id, { active: cat.active === false })
      setMsg(cat.active === false ? 'Категория активирована' : 'Категория скрыта')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось обновить статус')
    }
  }

  function CatRow({ cat, depth = 0 }: { cat: Category; depth?: number }) {
    const kids = childrenOf(cat.id)
    const isOpen = !collapsed[cat.id]
    const selfCount = countFor(cat)
    const childTotal = kids.reduce((s, k) => s + countFor(k), 0)

    const nameCell = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: depth * 22 }}>
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => setCollapsed(s => ({ ...s, [cat.id]: !s[cat.id] }))}
            className={isAdmin ? 'ab' : 'k-btn k-btn-s'}
            style={isAdmin ? {
              width: 20, height: 20, padding: 0, background: '#162B1A', border: 'none', color: '#8FB897',
              fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5,
            } : { width: 24, height: 24, padding: 0, fontSize: 11 }}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <div style={{ width: isAdmin ? 20 : 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isAdmin ? '#1D3822' : 'var(--muted)', fontSize: 11 }}>
            {depth > 0 ? '└' : ''}
          </div>
        )}
        <div style={{
          width: isAdmin ? 32 : 36, height: isAdmin ? 32 : 36, borderRadius: isAdmin ? 9 : 10, flexShrink: 0,
          background: depth > 0 ? 'rgba(31,215,96,.08)' : 'rgba(31,215,96,.12)',
          border: '1px solid rgba(31,215,96,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isAdmin ? 17 : 18,
        }}>
          {cat.emoji || '📦'}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: depth > 0 ? 600 : 700 }}>{cat.name}</div>
          {cat.desc && <div style={{ fontSize: 10, color: isAdmin ? '#3D6645' : 'var(--muted)' }}>{cat.desc}</div>}
        </div>
      </div>
    )

    const typeCell = depth === 0 ? (
      isAdmin ? (
        <span style={{
          padding: '2px 8px', borderRadius: 7, fontSize: 10, fontWeight: 800,
          background: 'rgba(31,215,96,.1)', color: '#1FD760', border: '1px solid rgba(31,215,96,.25)',
        }}>Родительская</span>
      ) : (
        <span className="k-badge" style={{ background: 'var(--green-d)', color: 'var(--green)' }}>Родительская</span>
      )
    ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: isAdmin ? '#3D6645' : 'var(--muted)' }}>↳</span>
        {isAdmin ? (
          <span style={{
            padding: '2px 8px', borderRadius: 7, fontSize: 10, fontWeight: 700,
            background: 'rgba(59,142,240,.1)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.25)',
          }}>
            {categories.find(c => c.id === cat.parent_id)?.name}
          </span>
        ) : (
          <span className="k-badge" style={{ background: '#1a2430', color: 'var(--blue)' }}>
            {categories.find(c => c.id === cat.parent_id)?.name}
          </span>
        )}
      </div>
    )

    const countCell = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: selfCount > 0 ? '#FFB800' : (isAdmin ? '#3D6645' : 'var(--muted)') }}>
          {selfCount}
        </span>
        {kids.length > 0 && (
          <span style={{ fontSize: 10, color: isAdmin ? '#3D6645' : 'var(--muted)' }}>
            (+{childTotal} в подкатегориях)
          </span>
        )}
      </div>
    )

    const actionsCell = (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => openEdit(cat)}
          className={isAdmin ? 'ab abg' : 'k-btn k-btn-s'}
          style={isAdmin ? { padding: '4px 9px', fontSize: 11 } : undefined}
        >
          ✏️
        </button>
        {depth === 0 && (
          <button
            type="button"
            onClick={() => openAddSub(cat)}
            className={isAdmin ? 'ab' : 'k-btn k-btn-s'}
            style={isAdmin ? {
              padding: '4px 9px', fontSize: 11, background: 'rgba(59,142,240,.1)',
              border: '1px solid rgba(59,142,240,.3)', color: '#3B8EF0',
            } : { color: 'var(--blue)' }}
          >
            + Подкат.
          </button>
        )}
        {selfCount === 0 && childTotal === 0 && (
          <button
            type="button"
            onClick={() => void handleDelete(cat)}
            className={isAdmin ? 'ab abd' : 'k-btn k-btn-s'}
            style={isAdmin ? { padding: '4px 9px', fontSize: 11 } : { color: 'var(--red)' }}
          >
            {isAdmin ? '🗑' : 'Удалить'}
          </button>
        )}
      </div>
    )

    if (isAdmin) {
      return (
        <>
          <tr style={{ background: depth > 0 ? 'rgba(31,215,96,.03)' : 'transparent' }}>
            <td>{nameCell}</td>
            <td>{typeCell}</td>
            <td>{countCell}</td>
            {showStatus && (
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AdminBadge v={cat.active !== false ? 'Активна' : 'Скрыта'} c={cat.active !== false ? '#1FD760' : '#3D6645'} />
                  <AdminToggle on={cat.active !== false} set={() => void toggleActive(cat)} />
                </div>
              </td>
            )}
            <td>{actionsCell}</td>
          </tr>
          {isOpen && kids.map(kid => <CatRow key={kid.id} cat={kid} depth={depth + 1} />)}
        </>
      )
    }

    return (
      <>
        <tr style={{ background: depth > 0 ? 'rgba(31,215,96,.03)' : undefined }}>
          <td>{nameCell}</td>
          <td>{typeCell}</td>
          <td className="num">{countCell}</td>
          <td>{actionsCell}</td>
        </tr>
        {isOpen && kids.map(kid => <CatRow key={kid.id} cat={kid} depth={depth + 1} />)}
      </>
    )
  }

  const stats = isAdmin ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
      <div className="sc"><div className="sl">Родительских</div><div className="sv" style={{ color: '#1FD760' }}>{roots.length}</div></div>
      <div className="sc"><div className="sl">Подкатегорий</div><div className="sv" style={{ color: '#3B8EF0' }}>{subCount}</div></div>
      <div className="sc"><div className="sl">Активных</div><div className="sv" style={{ color: '#FFB800' }}>{activeCount}</div></div>
      <div className="sc"><div className="sl">Товаров всего</div><div className="sv">{products.length}</div></div>
    </div>
  ) : (
    <div className="k-kpis">
      <div className="k-kpi"><div className="kl">Родительских</div><div className="kv" style={{ color: 'var(--green)' }}>{roots.length}</div></div>
      <div className="k-kpi"><div className="kl">Подкатегорий</div><div className="kv" style={{ color: 'var(--blue)' }}>{subCount}</div></div>
      <div className="k-kpi"><div className="kl">Всего</div><div className="kv">{categories.length}</div></div>
      <div className="k-kpi"><div className="kl">Товаров</div><div className="kv" style={{ color: 'var(--gold)' }}>{products.length}</div></div>
    </div>
  )

  const toolbar = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 12, color: isAdmin ? '#3D6645' : 'var(--muted)' }}>
        Нажмите <span style={{ color: '#3B8EF0', fontWeight: 700 }}>+ Подкат.</span> рядом с категорией чтобы добавить подкатегорию
      </div>
      <button
        type="button"
        onClick={openAddRoot}
        className={isAdmin ? 'ab abp' : 'k-btn k-btn-g'}
        style={isAdmin ? { display: 'flex', alignItems: 'center', gap: 6 } : undefined}
      >
        + Родительская категория
      </button>
    </div>
  )

  const addModal = showAdd && (
    <div className={isAdmin ? 'amod' : undefined} style={!isAdmin ? { marginBottom: 16 } : undefined}>
      {isAdmin && <div className="amodbg" onClick={() => setShowAdd(false)} />}
      <div className={isAdmin ? 'amodbox' : 'k-card'} style={isAdmin ? { maxWidth: 460 } : undefined}>
        {isAdmin ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div className="ub" style={{ fontSize: 15, fontWeight: 800 }}>{nParent !== '' ? 'Новая подкатегория' : 'Новая категория'}</div>
              <button type="button" onClick={() => setShowAdd(false)} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, borderRadius: 10 }}>✕</button>
            </div>
            <ParentPicker isAdmin categories={categories} roots={roots} parentId={nParent} setParentId={setNParent} />
            {nName && <Preview isAdmin nParent={nParent} categories={categories} emoji={nEmoji} name={nName} desc={nDesc} />}
            <FormFields isAdmin emoji={nEmoji} setEmoji={setNEmoji} name={nName} setName={setNName} desc={nDesc} setDesc={setNDesc} parentId={nParent} />
            <button type="button" onClick={() => void handleCreate()} className="ab abp" style={{ width: '100%', padding: 12, fontSize: 14, opacity: nName && !saving ? 1 : 0.5, marginTop: 12 }}>
              {saving ? 'Сохранение…' : `✓ ${nParent !== '' ? 'Создать подкатегорию' : 'Создать категорию'}`}
            </button>
          </>
        ) : (
          <>
            <div className="k-card-h">
              <b>{nParent !== '' ? 'Новая подкатегория' : 'Новая категория'}</b>
              <button type="button" className="k-btn k-btn-s" onClick={() => setShowAdd(false)}>Отмена</button>
            </div>
            <div className="k-card-b">
              <ParentPicker isAdmin={false} categories={categories} roots={roots} parentId={nParent} setParentId={setNParent} />
              {nName && <Preview isAdmin={false} nParent={nParent} categories={categories} emoji={nEmoji} name={nName} desc={nDesc} />}
              <FormFields isAdmin={false} emoji={nEmoji} setEmoji={setNEmoji} name={nName} setName={setNName} desc={nDesc} setDesc={setNDesc} parentId={nParent} />
              <button type="button" className="k-btn k-btn-g" disabled={saving || !nName.trim()} onClick={() => void handleCreate()} style={{ marginTop: 12 }}>
                {saving ? 'Сохранение…' : 'Создать'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  const editModal = editCat && (
    <div className={isAdmin ? 'amod' : undefined}>
      {isAdmin && <div className="amodbg" onClick={() => setEditCat(null)} />}
      <div className={isAdmin ? 'amodbox' : 'k-card'} style={isAdmin ? { maxWidth: 460 } : { marginTop: 16 }}>
        {isAdmin ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 26 }}>{eEmoji}</span>
                <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{editCat.name}</div>
              </div>
              <button type="button" onClick={() => setEditCat(null)} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, borderRadius: 10 }}>✕</button>
            </div>
            <FormFields isAdmin emoji={eEmoji} setEmoji={setEEmoji} name={eName} setName={setEName} desc={eDesc} setDesc={setEDesc} parentId={eParent} />
            <ParentPicker isAdmin categories={categories} roots={roots.filter(r => r.id !== editCat.id)} parentId={eParent} setParentId={setEParent} edit />
            <button type="button" onClick={() => void handleSaveEdit()} className="ab abp" style={{ width: '100%', padding: 12, marginTop: 12 }}>
              {saving ? 'Сохранение…' : '✓ Сохранить'}
            </button>
          </>
        ) : (
          <>
            <div className="k-card-h">
              <b>Редактирование · {editCat.name}</b>
              <button type="button" className="k-btn k-btn-s" onClick={() => setEditCat(null)}>Отмена</button>
            </div>
            <div className="k-card-b">
              <FormFields isAdmin={false} emoji={eEmoji} setEmoji={setEEmoji} name={eName} setName={setEName} desc={eDesc} setDesc={setEDesc} parentId={eParent} />
              <ParentPicker isAdmin={false} categories={categories} roots={roots.filter(r => r.id !== editCat.id)} parentId={eParent} setParentId={setEParent} edit />
              <button type="button" className="k-btn k-btn-g" disabled={saving || !eName.trim()} onClick={() => void handleSaveEdit()} style={{ marginTop: 12 }}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return (
    <div>
      {headerExtra}
      {stats}
      {msg && (
        <div className={isAdmin ? undefined : 'k-alert'} style={isAdmin ? { marginBottom: 12, fontSize: 12, color: '#1FD760' } : { marginBottom: 12 }}>
          {msg}
        </div>
      )}
      {toolbar}
      {addModal}
      <div className={isAdmin ? 'ac' : undefined}>
        <div className={!isAdmin ? 'k-card' : undefined}>
          <div className={!isAdmin ? 'k-card-b' : undefined} style={!isAdmin ? { padding: 0 } : undefined}>
            <div style={!isAdmin ? { maxHeight: '52vh', overflow: 'auto' } : undefined}>
              <table className={isAdmin ? 'at' : 'k-tbl'}>
                <thead>
                  <tr>
                    <th>Категория</th>
                    <th>Тип / Родитель</th>
                    <th className={!isAdmin ? 'num' : undefined}>Товаров</th>
                    {showStatus && <th>Статус</th>}
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {roots.map(cat => <CatRow key={cat.id} cat={cat} />)}
                </tbody>
              </table>
              {!roots.length && (
                <div className={isAdmin ? undefined : 'k-empty'} style={isAdmin ? { padding: 20, color: '#3D6645' } : undefined}>
                  {loaded ? 'Категорий пока нет — создайте первую' : 'Загрузка…'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {editModal}
    </div>
  )
}

function ParentPicker({
  isAdmin,
  categories,
  roots,
  parentId,
  setParentId,
  edit,
}: {
  isAdmin: boolean
  categories: Category[]
  roots: Category[]
  parentId: number | ''
  setParentId: (v: number | '') => void
  edit?: boolean
}) {
  if (isAdmin) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 8, fontWeight: 700 }}>Родительская категория</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setParentId('')} className="ab" style={{
            padding: '7px 14px', fontSize: 12,
            background: parentId === '' ? 'rgba(31,215,96,.12)' : '#0C1C0F',
            border: `1.5px solid ${parentId === '' ? 'rgba(31,215,96,.35)' : '#162B1A'}`,
            color: parentId === '' ? '#1FD760' : '#8FB897',
          }}>
            🏪 Без родителя (главная)
          </button>
          {roots.map(p => (
            <button key={p.id} type="button" onClick={() => setParentId(p.id)} className="ab" style={{
              padding: '7px 14px', fontSize: 12,
              background: parentId === p.id ? 'rgba(59,142,240,.12)' : '#0C1C0F',
              border: `1.5px solid ${parentId === p.id ? 'rgba(59,142,240,.35)' : '#162B1A'}`,
              color: parentId === p.id ? '#3B8EF0' : '#8FB897',
            }}>
              {p.emoji || '📦'} {p.name}
            </button>
          ))}
        </div>
        {parentId !== '' && (
          <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(59,142,240,.07)', border: '1px solid rgba(59,142,240,.2)', fontSize: 12, color: '#3B8EF0' }}>
            ↳ Подкатегория для: <span style={{ fontWeight: 700 }}>{categories.find(c => c.id === parentId)?.emoji} {categories.find(c => c.id === parentId)?.name}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="k-field" style={{ marginBottom: 12 }}>
      <label>{edit ? 'Родительская категория' : 'Тип'}</label>
      <select className="k-sel" value={parentId === '' ? '' : String(parentId)} onChange={e => setParentId(e.target.value ? Number(e.target.value) : '')}>
        <option value="">Родительская категория</option>
        {roots.map(r => (
          <option key={r.id} value={r.id}>Подкатегория в «{r.name}»</option>
        ))}
      </select>
    </div>
  )
}

function Preview({
  isAdmin, nParent, categories, emoji, name, desc,
}: {
  isAdmin: boolean
  nParent: number | ''
  categories: Category[]
  emoji: string
  name: string
  desc: string
}) {
  if (!isAdmin) return null
  return (
    <div style={{
      marginBottom: 14, padding: '11px 14px', borderRadius: 12,
      background: nParent !== '' ? 'rgba(59,142,240,.06)' : 'rgba(31,215,96,.06)',
      border: `1px solid ${nParent !== '' ? 'rgba(59,142,240,.2)' : 'rgba(31,215,96,.2)'}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {nParent !== '' && <span style={{ fontSize: 13, color: '#1D3822' }}>└</span>}
      <div style={{ width: 38, height: 38, borderRadius: 11, background: nParent !== '' ? 'rgba(59,142,240,.15)' : 'rgba(31,215,96,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{emoji}</div>
      <div><div style={{ fontSize: 13, fontWeight: 700 }}>{name}</div><div style={{ fontSize: 10, color: '#3D6645' }}>{desc}</div></div>
    </div>
  )
}

function FormFields({
  isAdmin, emoji, setEmoji, name, setName, desc, setDesc, parentId,
}: {
  isAdmin: boolean
  emoji: string
  setEmoji: (v: string) => void
  name: string
  setName: (v: string) => void
  desc: string
  setDesc: (v: string) => void
  parentId: number | ''
}) {
  if (isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Emoji</div>
            <input className="ai" value={emoji} onChange={e => setEmoji(e.target.value)} style={{ textAlign: 'center', fontSize: 24, height: 48 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Название *</div>
            <input className="ai" value={name} onChange={e => setName(e.target.value)} placeholder={parentId !== '' ? 'Название подкатегории' : 'Название категории'} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Описание</div>
          <input className="ai" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Краткое описание" />
        </div>
      </div>
    )
  }

  return (
    <div className="k-grid2">
      <div className="k-field">
        <label>Иконка</label>
        <input className="k-inp" value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={4} />
      </div>
      <div className="k-field">
        <label>Название *</label>
        <input className="k-inp" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="k-field" style={{ gridColumn: '1 / -1' }}>
        <label>Описание</label>
        <input className="k-inp" value={desc} onChange={e => setDesc(e.target.value)} />
      </div>
    </div>
  )
}
