'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
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
        background: on ? '#1FD760' : 'var(--b2)', transition: '.15s',
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
  onReorder,
  onDelete,
  onDeleteMany,
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
    order?: number
  }) => Promise<void>
  onUpdate: (id: number, data: Partial<Category>) => Promise<void>
  onReorder?: (items: { id: number; order: number }[]) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onDeleteMany?: (ids: number[]) => Promise<{ removed?: number; movedProducts?: number } | void>
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
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  useEffect(() => {
    const alive = new Set(categories.map(c => c.id))
    setChecked(prev => {
      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        if (alive.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [categories])

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
    setEditCat(null)
    setNParent('')
    setNName('')
    setNDesc('')
    setNEmoji('📦')
    setShowAdd(true)
  }

  function openAddSub(parent: Category) {
    setEditCat(null)
    setNParent(parent.id)
    setNName('')
    setNDesc('')
    setNEmoji('📦')
    setShowAdd(true)
  }

  function openEdit(cat: Category) {
    setShowAdd(false)
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
      const siblings = nParent === ''
        ? roots
        : childrenOf(Number(nParent))
      const maxOrder = siblings.reduce((m, c) => Math.max(m, Number(c.order) || 0), 0)
      await onCreate({
        name: nName.trim(),
        parent_id: nParent === '' ? null : nParent,
        emoji: nEmoji || '📦',
        desc: nDesc.trim(),
        order: maxOrder + 1,
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

  function countInTree(cat: Category): number {
    let n = countFor(cat)
    for (const kid of childrenOf(cat.id)) n += countInTree(kid)
    return n
  }

  async function handleDelete(cat: Category) {
    const kids = childrenOf(cat.id)
    const productTotal = countInTree(cat)
    const parentCat = cat.parent_id != null
      ? categories.find(c => c.id === cat.parent_id)
      : null
    const moveTo = parentCat?.name || 'Прочее'

    const label = kids.length
      ? `«${cat.name}» и ${kids.length} подкатегор${kids.length === 1 ? 'ию' : 'ии'}`
      : `«${cat.name}»`
    const productHint = productTotal > 0
      ? `\n\n${productTotal} товар(ов) будут перенесены в «${moveTo}».`
      : ''
    if (!confirm(`Удалить ${label}?${productHint}`)) return
    try {
      await onDelete(cat.id)
      if (editCat?.id === cat.id) setEditCat(null)
      setChecked(prev => {
        if (!prev.has(cat.id)) return prev
        const next = new Set(prev)
        next.delete(cat.id)
        return next
      })
      setMsg(productTotal > 0
        ? `Категория удалена · ${productTotal} товар(ов) перенесено в «${moveTo}»`
        : 'Категория удалена')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  function hasSelectedAncestor(cat: Category, selectedIds: Set<number>) {
    let pid = cat.parent_id
    while (pid != null) {
      if (selectedIds.has(Number(pid))) return true
      pid = categories.find(c => c.id === Number(pid))?.parent_id ?? null
    }
    return false
  }

  async function handleDeleteChecked() {
    const selected = categories.filter(c => checked.has(c.id))
    if (!selected.length) return
    // Если отмечен родитель — дочерние не дублируем (удалятся с ним)
    const toDelete = selected.filter(c => !hasSelectedAncestor(c, checked))
    const productTotal = toDelete.reduce((s, c) => s + countInTree(c), 0)
    const productHint = productTotal > 0
      ? `\n\nТовары из этих категорий (${productTotal}) будут перенесены в родительскую / «Прочее».`
      : ''
    if (!confirm(`Удалить ${toDelete.length} категори${toDelete.length === 1 ? 'ю' : toDelete.length < 5 ? 'и' : 'й'}?${productHint}`)) return
    setBulkDeleting(true)
    try {
      if (onDeleteMany) {
        const res = await onDeleteMany(toDelete.map(c => c.id))
        if (editCat && toDelete.some(c => c.id === editCat.id || hasSelectedAncestor(editCat, new Set(toDelete.map(x => x.id))))) {
          setEditCat(null)
        }
        setChecked(new Set())
        const moved = Number(res?.movedProducts) || 0
        const removed = Number(res?.removed) || toDelete.length
        setMsg(moved > 0
          ? `Удалено категорий: ${removed} · товаров перенесено: ${moved}`
          : `Удалено категорий: ${removed}`)
      } else {
        let ok = 0
        for (const cat of toDelete) {
          try {
            await onDelete(cat.id)
            ok += 1
            if (editCat?.id === cat.id) setEditCat(null)
          } catch (e) {
            console.error(e)
          }
        }
        setChecked(new Set())
        setMsg(ok === toDelete.length
          ? `Удалено категорий: ${ok}`
          : `Удалено ${ok} из ${toDelete.length}`)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить')
    } finally {
      setBulkDeleting(false)
    }
  }

  function toggleChecked(id: number, on: boolean) {
    setChecked(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAllCategories(on: boolean) {
    setChecked(on ? new Set(categories.map(c => c.id)) : new Set())
  }

  async function toggleActive(cat: Category) {
    try {
      await onUpdate(cat.id, { active: cat.active === false })
      setMsg(cat.active === false ? 'Категория активирована' : 'Категория скрыта')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось обновить статус')
    }
  }

  function siblingsOf(cat: Category): Category[] {
    if (cat.parent_id == null) return roots
    return childrenOf(Number(cat.parent_id))
  }

  async function moveCategory(cat: Category, dir: -1 | 1) {
    if (!onReorder) return
    const siblings = siblingsOf(cat)
    const idx = siblings.findIndex(c => c.id === cat.id)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= siblings.length) return
    const next = [...siblings]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    const items = next.map((c, i) => ({ id: c.id, order: i + 1 }))
    setSaving(true)
    setMsg('')
    try {
      await onReorder(items)
      setMsg(dir < 0 ? 'Подняли выше' : 'Опустили ниже')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось изменить порядок')
    } finally {
      setSaving(false)
    }
  }

  async function setCategoryPosition(cat: Category, posRaw: string) {
    if (!onReorder) return
    const siblings = siblingsOf(cat)
    const idx = siblings.findIndex(c => c.id === cat.id)
    if (idx < 0) return
    const parsed = Number(String(posRaw).replace(/\D/g, ''))
    if (!Number.isFinite(parsed) || parsed < 1) return
    const target = Math.max(0, Math.min(siblings.length - 1, Math.floor(parsed) - 1))
    if (target === idx) return
    const next = [...siblings]
    const [item] = next.splice(idx, 1)
    next.splice(target, 0, item)
    const items = next.map((c, i) => ({ id: c.id, order: i + 1 }))
    setSaving(true)
    setMsg('')
    try {
      await onReorder(items)
      setMsg(`Порядок: ${target + 1}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось изменить порядок')
    } finally {
      setSaving(false)
    }
  }

  function CatRow({ cat, depth = 0 }: { cat: Category; depth?: number }) {
    const kids = childrenOf(cat.id)
    const isOpen = !collapsed[cat.id]
    const selfCount = countFor(cat)
    const childTotal = kids.reduce((s, k) => s + countFor(k), 0)
    const siblings = siblingsOf(cat)
    const pos = siblings.findIndex(c => c.id === cat.id)
    const canUp = onReorder && pos > 0
    const canDown = onReorder && pos >= 0 && pos < siblings.length - 1

    const nameCell = (
      <div style={{ display: 'flex', alignItems: 'center', gap: isAdmin ? 6 : 5, paddingLeft: depth * (isAdmin ? 22 : 14) }}>
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => setCollapsed(s => ({ ...s, [cat.id]: !s[cat.id] }))}
            className={isAdmin ? 'ab' : 'k-btn k-btn-s'}
            style={isAdmin ? {
              width: 20, height: 20, padding: 0, background: 'var(--b1)', border: 'none', color: 'var(--t2)',
              fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5,
            } : { width: 22, height: 22, minHeight: 0, padding: 0, fontSize: 10 }}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <div style={{ width: isAdmin ? 20 : 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isAdmin ? 'var(--b2)' : 'var(--muted)', fontSize: 11 }}>
            {depth > 0 ? '└' : ''}
          </div>
        )}
        <div style={{
          width: isAdmin ? 32 : 26, height: isAdmin ? 32 : 26, borderRadius: isAdmin ? 9 : 7, flexShrink: 0,
          background: depth > 0 ? 'rgba(31,215,96,.08)' : 'rgba(31,215,96,.12)',
          border: '1px solid rgba(31,215,96,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isAdmin ? 17 : 14,
        }}>
          {cat.emoji || '📦'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: isAdmin ? 13 : 12, fontWeight: depth > 0 ? 600 : 800, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cat.name}</div>
          {isAdmin && cat.desc && <div style={{ fontSize: 10, color: 'var(--t3)' }}>{cat.desc}</div>}
        </div>
      </div>
    )

    const orderCell = isAdmin ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{
          minWidth: 22, textAlign: 'center', fontSize: 12, fontWeight: 800,
          color: 'var(--t2)',
        }}>
          {pos >= 0 ? pos + 1 : '—'}
        </span>
        {onReorder && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
              type="button"
              disabled={!canUp || saving}
              onClick={() => void moveCategory(cat, -1)}
              className="ab"
              style={{
                width: 22, height: 18, padding: 0, fontSize: 10, lineHeight: 1,
                opacity: canUp ? 1 : 0.35, cursor: canUp ? 'pointer' : 'default',
              }}
              title="Выше"
              aria-label={`Поднять «${cat.name}» выше`}
            >
              ▲
            </button>
            <button
              type="button"
              disabled={!canDown || saving}
              onClick={() => void moveCategory(cat, 1)}
              className="ab"
              style={{
                width: 22, height: 18, padding: 0, fontSize: 10, lineHeight: 1,
                opacity: canDown ? 1 : 0.35, cursor: canDown ? 'pointer' : 'default',
              }}
              title="Ниже"
              aria-label={`Опустить «${cat.name}» ниже`}
            >
              ▼
            </button>
          </div>
        )}
      </div>
    ) : (
      <div className="k-cat-order" onClick={e => e.stopPropagation()}>
        {onReorder ? (
          <input
            className="k-cat-order-inp"
            type="text"
            inputMode="numeric"
            defaultValue={pos >= 0 ? String(pos + 1) : ''}
            key={`${cat.id}-${pos}`}
            disabled={saving}
            title="Номер порядка · Enter"
            aria-label={`Порядок «${cat.name}»`}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void setCategoryPosition(cat, (e.target as HTMLInputElement).value)
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            onBlur={e => {
              const v = e.target.value.trim()
              const cur = pos >= 0 ? String(pos + 1) : ''
              if (v !== cur) void setCategoryPosition(cat, v)
              else e.target.value = cur
            }}
          />
        ) : (
          <span style={{ minWidth: 22, textAlign: 'center', fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>
            {pos >= 0 ? pos + 1 : '—'}
          </span>
        )}
        {onReorder && (
          <div className="k-cat-order-btns">
            <button
              type="button"
              className="k-btn k-btn-s"
              disabled={!canUp || saving}
              onClick={() => void moveCategory(cat, -1)}
              title="Выше"
              aria-label={`Поднять «${cat.name}» выше`}
              style={{ opacity: canUp ? 1 : 0.35 }}
            >
              ▲
            </button>
            <button
              type="button"
              className="k-btn k-btn-s"
              disabled={!canDown || saving}
              onClick={() => void moveCategory(cat, 1)}
              title="Ниже"
              aria-label={`Опустить «${cat.name}» ниже`}
              style={{ opacity: canDown ? 1 : 0.35 }}
            >
              ▼
            </button>
          </div>
        )}
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
        <span style={{ fontSize: 10, color: isAdmin ? 'var(--t3)' : 'var(--muted)' }}>↳</span>
        {isAdmin ? (
          <span style={{
            padding: '2px 8px', borderRadius: 7, fontSize: 10, fontWeight: 700,
            background: 'rgba(59,142,240,.1)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.25)',
          }}>
            {categories.find(c => c.id === cat.parent_id)?.name}
          </span>
        ) : (
          <span className="k-badge k-badge-cat">
            {categories.find(c => c.id === cat.parent_id)?.name}
          </span>
        )}
      </div>
    )

    const countCell = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: isAdmin ? 13 : 12, fontWeight: 900, color: selfCount > 0 ? '#FFB800' : (isAdmin ? 'var(--t3)' : 'var(--muted)') }}>
          {selfCount}
        </span>
        {isAdmin && kids.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--t3)' }}>
            (+{childTotal} в подкатегориях)
          </span>
        )}
      </div>
    )

    const actionsCell = (
      <div style={{ display: 'flex', gap: isAdmin ? 6 : 4, flexWrap: 'wrap', justifyContent: isAdmin ? undefined : 'flex-end' }}>
        <button
          type="button"
          onClick={() => openEdit(cat)}
          className={isAdmin ? 'ab abg' : 'k-btn k-btn-s'}
          style={isAdmin ? { padding: '4px 9px', fontSize: 11 } : { padding: '4px 8px', fontSize: 12, minHeight: 0 }}
          title="Редактировать"
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
            } : { color: 'var(--blue)', padding: '4px 8px', fontSize: 11, minHeight: 0 }}
            title="Добавить подкатегорию"
          >
            {isAdmin ? '+ Подкат.' : '+'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleDelete(cat)}
          className={isAdmin ? 'ab abd' : 'k-btn k-btn-s'}
          style={isAdmin ? { padding: '4px 9px', fontSize: 11 } : { color: 'var(--red)', padding: '4px 8px', fontSize: 12, minHeight: 0 }}
          title="Удалить"
        >
          🗑
        </button>
      </div>
    )

    if (isAdmin) {
      return (
        <>
          <tr style={{ background: depth > 0 ? 'rgba(31,215,96,.03)' : 'transparent' }}>
            <td style={{ width: isAdmin ? 64 : 110 }}>{orderCell}</td>
            <td>{nameCell}</td>
            <td>{typeCell}</td>
            <td>{countCell}</td>
            {showStatus && (
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AdminBadge v={cat.active !== false ? 'Активна' : 'Скрыта'} c={cat.active !== false ? '#1FD760' : 'var(--t3)'} />
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
          <td onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={checked.has(cat.id)}
              onChange={e => toggleChecked(cat.id, e.target.checked)}
              aria-label={`Выбрать ${cat.name}`}
            />
          </td>
          <td style={{ width: isAdmin ? 64 : 110 }}>{orderCell}</td>
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
  ) : null

  const allChecked = categories.length > 0 && categories.every(c => checked.has(c.id))
  const someChecked = categories.some(c => checked.has(c.id))

  const toolbar = isAdmin ? (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 12, color: 'var(--t3)' }}>
        Порядок: <span style={{ fontWeight: 700 }}>▲ ▼</span>
        {' · '}
        <span style={{ color: '#3B8EF0', fontWeight: 700 }}>+ Подкат.</span> — подкатегория
      </div>
      <button
        type="button"
        onClick={openAddRoot}
        className="ab abp"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        + Родительская категория
      </button>
    </div>
  ) : (
    <div className="k-catalog-bar" style={{ marginBottom: 6 }}>
      <div className="k-catalog-meta">
        <b>{categories.length}</b>
        <span>
          кат. · {roots.length} родит. · {subCount} подкат. · {products.length} тов.
          {onReorder ? ' · № / ▲▼ — порядок' : ''}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
        {checked.size > 0 && (
          <>
            <span style={{ fontSize: 12, fontWeight: 800 }}>Выбрано {checked.size}</span>
            <button
              type="button"
              className="k-btn k-btn-s"
              style={{ color: 'var(--red)', padding: '6px 10px', fontSize: 12, minHeight: 0 }}
              disabled={bulkDeleting}
              onClick={() => void handleDeleteChecked()}
            >
              {bulkDeleting ? '…' : 'Удалить'}
            </button>
            <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12, minHeight: 0 }} disabled={bulkDeleting} onClick={() => setChecked(new Set())}>
              Снять
            </button>
          </>
        )}
        <button type="button" onClick={openAddRoot} className="k-btn k-btn-g k-catalog-add">
          + Родительская
        </button>
      </div>
    </div>
  )

  const addModal = showAdd && (
    <div className={isAdmin ? 'amod' : 'k-modal-bg'} onClick={!isAdmin ? () => setShowAdd(false) : undefined}>
      {isAdmin && <div className="amodbg" onClick={() => setShowAdd(false)} />}
      <div
        className={isAdmin ? 'amodbox' : 'k-modal'}
        style={isAdmin ? { maxWidth: 460 } : undefined}
        onClick={!isAdmin ? e => e.stopPropagation() : undefined}
      >
        {isAdmin ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div className="ub" style={{ fontSize: 15, fontWeight: 800 }}>{nParent !== '' ? 'Новая подкатегория' : 'Новая категория'}</div>
              <button type="button" onClick={() => setShowAdd(false)} className="ab" style={{ background: 'var(--l3)', border: '1px solid var(--b1)', color: 'var(--t2)', width: 32, height: 32, padding: 0, borderRadius: 10 }}>✕</button>
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
            <div className="k-modal-h">
              <b>{nParent !== '' ? 'Новая подкатегория' : 'Новая категория'}</b>
              <button type="button" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <ParentPicker isAdmin={false} categories={categories} roots={roots} parentId={nParent} setParentId={setNParent} locked={nParent !== '' && roots.some(r => r.id === nParent)} />
              {nName && <Preview isAdmin={false} nParent={nParent} categories={categories} emoji={nEmoji} name={nName} desc={nDesc} />}
              <FormFields isAdmin={false} emoji={nEmoji} setEmoji={setNEmoji} name={nName} setName={setNName} desc={nDesc} setDesc={setNDesc} parentId={nParent} />
              <button type="button" className="k-btn k-btn-g" disabled={saving || !nName.trim()} onClick={() => void handleCreate()} style={{ marginTop: 12, width: '100%' }}>
                {saving ? 'Сохранение…' : nParent !== '' ? '✓ Создать подкатегорию' : '✓ Создать категорию'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  const editModal = editCat && (
    <div className={isAdmin ? 'amod' : 'k-modal-bg'} onClick={!isAdmin ? () => setEditCat(null) : undefined}>
      {isAdmin && <div className="amodbg" onClick={() => setEditCat(null)} />}
      <div
        className={isAdmin ? 'amodbox' : 'k-modal'}
        style={isAdmin ? { maxWidth: 460 } : undefined}
        onClick={!isAdmin ? e => e.stopPropagation() : undefined}
      >
        {isAdmin ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 26 }}>{eEmoji}</span>
                <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{editCat.name}</div>
              </div>
              <button type="button" onClick={() => setEditCat(null)} className="ab" style={{ background: 'var(--l3)', border: '1px solid var(--b1)', color: 'var(--t2)', width: 32, height: 32, padding: 0, borderRadius: 10 }}>✕</button>
            </div>
            <FormFields isAdmin emoji={eEmoji} setEmoji={setEEmoji} name={eName} setName={setEName} desc={eDesc} setDesc={setEDesc} parentId={eParent} />
            <ParentPicker isAdmin categories={categories} roots={roots.filter(r => r.id !== editCat.id)} parentId={eParent} setParentId={setEParent} edit />
            <button type="button" onClick={() => void handleSaveEdit()} className="ab abp" style={{ width: '100%', padding: 12, marginTop: 12 }}>
              {saving ? 'Сохранение…' : '✓ Сохранить'}
            </button>
          </>
        ) : (
          <>
            <div className="k-modal-h">
              <b>✏️ {editCat.name}</b>
              <button type="button" onClick={() => setEditCat(null)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <FormFields isAdmin={false} emoji={eEmoji} setEmoji={setEEmoji} name={eName} setName={setEName} desc={eDesc} setDesc={setEDesc} parentId={eParent} />
              <ParentPicker isAdmin={false} categories={categories} roots={roots.filter(r => r.id !== editCat.id)} parentId={eParent} setParentId={setEParent} edit />
              <button type="button" className="k-btn k-btn-g" disabled={saving || !eName.trim()} onClick={() => void handleSaveEdit()} style={{ marginTop: 12, width: '100%' }}>
                {saving ? 'Сохранение…' : '✓ Сохранить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className={isAdmin ? undefined : 'k-cats-panel'}>
      {headerExtra}
      {stats}
      {msg && (
        <div className={isAdmin ? undefined : 'k-alert'} style={isAdmin ? { marginBottom: 12, fontSize: 12, color: '#1FD760' } : { marginBottom: 8 }}>
          {msg}
        </div>
      )}
      {toolbar}
      {addModal}
      <div className={isAdmin ? 'ac' : 'k-cats-panel-tbl'}>
        <table className={isAdmin ? 'at' : 'k-tbl k-tbl-compact'}>
          <thead>
            <tr>
              {!isAdmin && (
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={el => {
                      if (el) el.indeterminate = someChecked && !allChecked
                    }}
                    onChange={e => toggleAllCategories(e.target.checked)}
                    title="Выбрать все"
                    aria-label="Выбрать все категории"
                  />
                </th>
              )}
              <th style={{ width: isAdmin ? 64 : 110 }}>№</th>
              <th>Категория</th>
              <th>Тип / Родитель</th>
              <th className={!isAdmin ? 'num' : undefined} style={!isAdmin ? { width: 64 } : undefined}>Товаров</th>
              {showStatus && <th>Статус</th>}
              <th style={!isAdmin ? { width: 100 } : undefined}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {roots.map(cat => <CatRow key={cat.id} cat={cat} />)}
          </tbody>
        </table>
        {!roots.length && (
          <div className={isAdmin ? undefined : 'k-empty'} style={isAdmin ? { padding: 20, color: 'var(--t3)' } : undefined}>
            {loaded ? 'Категорий пока нет — создайте первую' : 'Загрузка…'}
          </div>
        )}
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
  locked,
}: {
  isAdmin: boolean
  categories: Category[]
  roots: Category[]
  parentId: number | ''
  setParentId: (v: number | '') => void
  edit?: boolean
  locked?: boolean
}) {
  const label = edit ? 'Родительская категория' : 'Тип категории'

  if (locked && parentId !== '') {
    const parent = categories.find(c => c.id === parentId)
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: isAdmin ? 'var(--t2)' : 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>{label}</div>
        <div style={{
          padding: '8px 12px', borderRadius: 10,
          background: 'rgba(59,142,240,.07)', border: '1px solid rgba(59,142,240,.2)',
          fontSize: 12, color: '#3B8EF0',
        }}>
          ↳ Подкатегория для: <span style={{ fontWeight: 700 }}>{parent?.emoji} {parent?.name}</span>
        </div>
      </div>
    )
  }

  const chipBtn = (active: boolean, green: boolean, onClick: () => void, children: ReactNode) => {
    if (isAdmin) {
      return (
        <button type="button" onClick={onClick} className="ab" style={{
          padding: '7px 14px', fontSize: 12,
          background: active ? (green ? 'rgba(31,215,96,.12)' : 'rgba(59,142,240,.12)') : 'var(--l3)',
          border: `1.5px solid ${active ? (green ? 'rgba(31,215,96,.35)' : 'rgba(59,142,240,.35)') : 'var(--b1)'}`,
          color: active ? (green ? '#1FD760' : '#3B8EF0') : 'var(--t2)',
        }}>
          {children}
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={onClick}
        className={`k-btn k-btn-s ${active ? 'k-btn-g' : ''}`}
        style={active && !green ? { borderColor: 'var(--blue)', color: 'var(--blue)' } : undefined}
      >
        {children}
      </button>
    )
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: isAdmin ? 'var(--t2)' : 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {chipBtn(parentId === '', true, () => setParentId(''), '🏪 Без родителя (главная)')}
        {roots.map(p => chipBtn(parentId === p.id, false, () => setParentId(p.id), <>{p.emoji || '📦'} {p.name}</>))}
      </div>
      {parentId !== '' && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(59,142,240,.07)', border: '1px solid rgba(59,142,240,.2)', fontSize: 12, color: '#3B8EF0' }}>
          ↳ Подкатегория для: <span style={{ fontWeight: 700 }}>{categories.find(c => c.id === parentId)?.emoji} {categories.find(c => c.id === parentId)?.name}</span>
        </div>
      )}
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
  if (!name) return null
  return (
    <div style={{
      marginBottom: 14, padding: '11px 14px', borderRadius: 12,
      background: nParent !== '' ? 'rgba(59,142,240,.06)' : 'rgba(31,215,96,.06)',
      border: `1px solid ${nParent !== '' ? 'rgba(59,142,240,.2)' : 'rgba(31,215,96,.2)'}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {nParent !== '' && <span style={{ fontSize: 13, color: isAdmin ? 'var(--b2)' : 'var(--muted)' }}>└</span>}
      <div style={{ width: 38, height: 38, borderRadius: 11, background: nParent !== '' ? 'rgba(59,142,240,.15)' : 'rgba(31,215,96,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{emoji}</div>
      <div><div style={{ fontSize: 13, fontWeight: 700 }}>{name}</div>{desc && <div style={{ fontSize: 10, color: isAdmin ? 'var(--t3)' : 'var(--muted)' }}>{desc}</div>}</div>
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
            <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Emoji</div>
            <input className="ai" value={emoji} onChange={e => setEmoji(e.target.value)} style={{ textAlign: 'center', fontSize: 24, height: 48 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Название *</div>
            <input className="ai" value={name} onChange={e => setName(e.target.value)} placeholder={parentId !== '' ? 'Название подкатегории' : 'Название категории'} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Описание</div>
          <input className="ai" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Краткое описание" />
        </div>
      </div>
    )
  }

  return (
    <div className="k-grid2" style={{ gridTemplateColumns: '80px 1fr' }}>
      <div className="k-field">
        <label>Emoji</label>
        <input className="k-inp" value={emoji} onChange={e => setEmoji(e.target.value)} style={{ textAlign: 'center', fontSize: 22, height: 48 }} maxLength={4} />
      </div>
      <div className="k-field">
        <label>Название *</label>
        <input className="k-inp" value={name} onChange={e => setName(e.target.value)} placeholder={parentId !== '' ? 'Название подкатегории' : 'Название категории'} />
      </div>
      <div className="k-field" style={{ gridColumn: '1 / -1' }}>
        <label>Описание</label>
        <input className="k-inp" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Краткое описание" />
      </div>
    </div>
  )
}
