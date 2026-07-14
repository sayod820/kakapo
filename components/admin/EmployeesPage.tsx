'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { TradeEmployee } from '@/lib/types'
import {
  EMPLOYEE_ROLE_PRESETS,
  TRADE_PAGES,
  permissionsForRole,
  type EmployeeRole,
  type TradePageId,
} from '@/lib/tradeAccess'

const emptyForm = () => ({
  name: '',
  password: '',
  role: 'cashier' as EmployeeRole,
  permissions: [...EMPLOYEE_ROLE_PRESETS.cashier.permissions] as TradePageId[],
  active: true,
})

export default function EmployeesPage() {
  const [rows, setRows] = useState<TradeEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [formErr, setFormErr] = useState('')

  const load = useCallback(async () => {
    if (!USE_API) {
      setRows([])
      setLoading(false)
      setErr('Нужен API')
      return
    }
    setLoading(true)
    setErr('')
    try {
      setRows(await api.getEmployees())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openAdd() {
    setForm(emptyForm())
    setEditId(null)
    setFormErr('')
    setShow(true)
  }

  function openEdit(row: TradeEmployee) {
    const role = (EMPLOYEE_ROLE_PRESETS[row.role as EmployeeRole] ? row.role : 'custom') as EmployeeRole
    setForm({
      name: row.name,
      password: '',
      role,
      permissions: (row.permissions || []) as TradePageId[],
      active: row.active !== false,
    })
    setEditId(row.id)
    setFormErr('')
    setShow(true)
  }

  function setRole(role: EmployeeRole) {
    setForm(prev => ({
      ...prev,
      role,
      permissions: role === 'custom' ? prev.permissions : permissionsForRole(role),
    }))
  }

  function togglePerm(id: TradePageId) {
    setForm(prev => {
      const has = prev.permissions.includes(id)
      const permissions = has ? prev.permissions.filter(p => p !== id) : [...prev.permissions, id]
      return { ...prev, role: 'custom', permissions }
    })
  }

  async function save() {
    const name = form.name.trim()
    if (!name) {
      setFormErr('Укажите имя')
      return
    }
    if (!editId && form.password.trim().length < 4) {
      setFormErr('Пароль не короче 4 символов')
      return
    }
    if (editId && form.password.trim() && form.password.trim().length < 4) {
      setFormErr('Пароль не короче 4 символов')
      return
    }
    if (!form.permissions.length) {
      setFormErr('Выберите хотя бы один раздел')
      return
    }
    setBusy(true)
    setFormErr('')
    try {
      if (editId) {
        await api.updateEmployee(editId, {
          name,
          role: form.role,
          permissions: form.permissions,
          active: form.active,
          ...(form.password.trim() ? { password: form.password.trim() } : {}),
        })
      } else {
        await api.createEmployee({
          name,
          password: form.password.trim(),
          role: form.role,
          permissions: form.permissions,
          active: form.active,
        })
      }
      setShow(false)
      await load()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(row: TradeEmployee) {
    try {
      await api.updateEmployee(row.id, { active: !(row.active !== false) })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function remove(row: TradeEmployee) {
    if (!confirm(`Удалить сотрудника «${row.name}»?`)) return
    try {
      await api.deleteEmployee(row.id)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700, maxWidth: 520, lineHeight: 1.45 }}>
          Добавьте сотрудников для приложения <b style={{ color: 'var(--text)' }}>Торговля</b>.
          После входа по паролю видны только отмеченные разделы (касса, склад, финансы…).
        </div>
        <button type="button" className="ab abp" onClick={openAdd}>+ Добавить сотрудника</button>
      </div>

      {err && (
        <div className="k-alert" style={{ marginBottom: 12, background: '#2a1420', color: '#FF8A8A' }}>{err}</div>
      )}

      <div className="ac">
        <table className="at">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Роль</th>
              <th>Доступ</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>Загрузка…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>Пока нет сотрудников — добавьте первого</td></tr>
            ) : rows.map(row => (
              <tr key={row.id}>
                <td style={{ fontWeight: 800 }}>{row.name}</td>
                <td>{row.roleLabel || row.role}</td>
                <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 280 }}>
                  {(row.permissions || [])
                    .map(id => TRADE_PAGES.find(p => p.id === id)?.label || id)
                    .join(', ') || '—'}
                </td>
                <td>
                  <span style={{ color: row.active !== false ? '#1FD760' : '#FF5A5A', fontWeight: 800 }}>
                    {row.active !== false ? 'Активен' : 'Блок'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="ab" onClick={() => openEdit(row)}>Изменить</button>
                    <button type="button" className="ab" onClick={() => void toggleActive(row)}>
                      {row.active !== false ? 'Блок' : 'Вкл'}
                    </button>
                    <button type="button" className="ab" style={{ color: '#FF5A5A' }} onClick={() => void remove(row)}>
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="amod">
          <div className="amodbg" onClick={() => !busy && setShow(false)} />
          <div className="amodbox" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{editId ? 'Изменить сотрудника' : 'Новый сотрудник'}</div>
              <button type="button" onClick={() => setShow(false)} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>ФИО</span>
                <input
                  className="ai"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Гафуров Сайёд"
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
                  Пароль {editId ? '(оставьте пустым, чтобы не менять)' : ''}
                </span>
                <input
                  className="ai"
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="минимум 4 символа"
                  autoComplete="new-password"
                />
              </label>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginBottom: 8 }}>Шаблон доступа</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(Object.keys(EMPLOYEE_ROLE_PRESETS) as EmployeeRole[]).map(role => (
                    <button
                      key={role}
                      type="button"
                      className="ab"
                      style={{
                        borderColor: form.role === role ? '#1FD760' : undefined,
                        background: form.role === role ? 'rgba(31,215,96,.12)' : undefined,
                      }}
                      onClick={() => setRole(role)}
                    >
                      {EMPLOYEE_ROLE_PRESETS[role].label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                  {EMPLOYEE_ROLE_PRESETS[form.role].hint}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginBottom: 8 }}>
                  Разделы Торговли
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {TRADE_PAGES.map(p => {
                    const on = form.permissions.includes(p.id)
                    return (
                      <label
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 10,
                          border: `1px solid ${on ? '#1FD76055' : 'var(--border, #1C2A21)'}`,
                          background: on ? 'rgba(31,215,96,.08)' : 'transparent',
                          cursor: 'pointer',
                          fontWeight: 700,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => togglePerm(p.id)}
                        />
                        <span>{p.icon} {p.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                />
                Активен (может входить в Торговлю)
              </label>
              {formErr && <div style={{ color: '#FF8A8A', fontWeight: 700 }}>{formErr}</div>}
              <button type="button" className="ab abp" disabled={busy} onClick={() => void save()} style={{ width: '100%', padding: 11 }}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
