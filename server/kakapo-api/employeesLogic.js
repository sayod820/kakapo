/**
 * Сотрудники приложения «Торговля» — доступ к разделам по паролю.
 */

export const TRADE_PAGE_IDS = [
  'sales',
  'products',
  'clients',
  'debts',
  'warehouse',
  'suppliers',
  'finance',
  'reports',
]

export const TRADE_PAGE_LABELS = {
  sales: 'Точка продаж',
  products: 'Товары',
  clients: 'Клиенты',
  debts: 'Долги',
  warehouse: 'Склад',
  suppliers: 'Поставщики',
  finance: 'Финансы',
  reports: 'Отчёты',
}

export const EMPLOYEE_ROLE_PRESETS = {
  cashier: {
    label: 'Кассир',
    permissions: ['sales', 'clients', 'debts'],
  },
  warehouse: {
    label: 'Склад',
    permissions: ['products', 'warehouse', 'suppliers'],
  },
  manager: {
    label: 'Старший / админ',
    permissions: [...TRADE_PAGE_IDS],
  },
  custom: {
    label: 'Свой набор',
    permissions: [],
  },
}

function nowIso() {
  return new Date().toISOString()
}

function nextId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function ensureEmployees(db) {
  if (!db || typeof db !== 'object') throw new Error('db required')
  if (!Array.isArray(db.employees)) db.employees = []
}

function normalizePermissions(list, role) {
  const preset = EMPLOYEE_ROLE_PRESETS[role]
  let perms = Array.isArray(list) ? list.map(String) : []
  if (role && role !== 'custom' && preset) {
    perms = [...preset.permissions]
  }
  const allowed = new Set(TRADE_PAGE_IDS)
  perms = [...new Set(perms.filter(p => allowed.has(p)))]
  if (!perms.length && role === 'custom') {
    throw new Error('Выберите хотя бы один раздел')
  }
  if (!perms.length) perms = [...(EMPLOYEE_ROLE_PRESETS.cashier.permissions)]
  return perms
}

export function listEmployees(db) {
  ensureEmployees(db)
  return [...db.employees]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'))
    .map(publicEmployee)
}

export function createEmployee(db, data = {}) {
  ensureEmployees(db)
  const name = String(data.name || '').trim()
  const password = String(data.password || data.pin || '').trim()
  if (!name) throw new Error('Укажите имя сотрудника')
  if (password.length < 4) throw new Error('Пароль не короче 4 символов')
  const role = EMPLOYEE_ROLE_PRESETS[data.role] ? data.role : 'custom'
  const permissions = normalizePermissions(data.permissions, role)
  if (db.employees.some(e => e.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Сотрудник с таким именем уже есть')
  }
  const row = {
    id: nextId('EMP'),
    name,
    password,
    role,
    permissions,
    active: data.active !== false,
    createdAtIso: nowIso(),
  }
  db.employees.unshift(row)
  return publicEmployee(row)
}

export function updateEmployee(db, id, patch = {}) {
  ensureEmployees(db)
  const row = db.employees.find(e => e.id === id)
  if (!row) throw new Error('Сотрудник не найден')
  if (patch.name != null) {
    const name = String(patch.name).trim()
    if (!name) throw new Error('Укажите имя')
    if (db.employees.some(e => e.id !== id && e.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Сотрудник с таким именем уже есть')
    }
    row.name = name
  }
  if (patch.password != null || patch.pin != null) {
    const password = String(patch.password ?? patch.pin ?? '').trim()
    if (password && password.length < 4) throw new Error('Пароль не короче 4 символов')
    if (password) row.password = password
  }
  if (patch.role != null) {
    row.role = EMPLOYEE_ROLE_PRESETS[patch.role] ? patch.role : 'custom'
  }
  if (patch.permissions != null || patch.role != null) {
    row.permissions = normalizePermissions(
      patch.permissions != null ? patch.permissions : row.permissions,
      patch.role != null ? row.role : (patch.permissions != null ? 'custom' : row.role),
    )
    if (patch.permissions != null && patch.role == null) row.role = 'custom'
  }
  if (patch.active != null) row.active = !!patch.active
  row.updatedAtIso = nowIso()
  return publicEmployee(row)
}

export function deleteEmployee(db, id) {
  ensureEmployees(db)
  const before = db.employees.length
  db.employees = db.employees.filter(e => e.id !== id)
  if (db.employees.length === before) throw new Error('Сотрудник не найден')
  return { id }
}

export function loginEmployee(db, data = {}) {
  ensureEmployees(db)
  const password = String(data.password || data.pin || '').trim()
  if (!password) throw new Error('Введите пароль')
  let row = null
  if (data.id) {
    row = db.employees.find(e => e.id === data.id)
  } else if (data.name) {
    const name = String(data.name).trim().toLowerCase()
    row = db.employees.find(e => e.name.toLowerCase() === name)
  } else {
    const matches = db.employees.filter(e => e.active !== false && e.password === password)
    if (matches.length > 1) throw new Error('Несколько сотрудников с этим паролем — выберите имя')
    row = matches[0] || null
  }
  if (!row) throw new Error('Сотрудник не найден')
  if (row.active === false) throw new Error('Сотрудник заблокирован')
  if (String(row.password) !== password) throw new Error('Неверный пароль')
  return {
    ...publicEmployee(row),
    token: `emp-${row.id}`,
  }
}

export function publicEmployee(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    role: row.role || 'custom',
    roleLabel: EMPLOYEE_ROLE_PRESETS[row.role]?.label || 'Свой набор',
    permissions: Array.isArray(row.permissions) ? [...row.permissions] : [],
    active: row.active !== false,
    createdAtIso: row.createdAtIso,
    updatedAtIso: row.updatedAtIso,
  }
}

/** Демо-сотрудник с полным доступом, если список пуст */
export function ensureDefaultEmployees(db) {
  ensureEmployees(db)
  if (db.employees.length) return false
  db.employees.push({
    id: 'EMP-DEFAULT',
    name: 'Админ магазина',
    password: '1234',
    role: 'manager',
    permissions: [...TRADE_PAGE_IDS],
    active: true,
    createdAtIso: nowIso(),
  })
  return true
}
