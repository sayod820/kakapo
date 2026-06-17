/** Авторизация: админ (логин/пароль), остальные — телефон + OTP */

export function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length >= 9) return d.slice(-9)
  return d
}

export function phonesMatch(a, b) {
  const na = normalizePhone(a)
  const nb = normalizePhone(b)
  return na.length >= 9 && na === nb
}

export function verifyAdminLogin(db, email, password) {
  const e = String(email || '').toLowerCase().trim()
  const p = String(password || '')
  const settingsAdmin = db.settings?.admin
  if (settingsAdmin?.email && settingsAdmin.email.toLowerCase() === e && settingsAdmin.password === p) {
    return { id: 0, email: settingsAdmin.email, role: 'admin', name: settingsAdmin.name || 'Владелец KAKAPO' }
  }
  const user = (db.users || []).find(u => u.email?.toLowerCase() === e && u.password === p && u.role === 'admin')
  return user || null
}

export function findStaffByPhone(db, phone, role) {
  if (role === 'courier') {
    return (db.couriers || []).find(c => phonesMatch(c.phone, phone) && !c.blocked) || null
  }
  if (role === 'assembler') {
    return (db.assemblers || []).find(a => phonesMatch(a.phone, phone) && !a.blocked) || null
  }
  if (role === 'restaurant') {
    return (db.restaurants || []).find(r => phonesMatch(r.phone, phone) && !r.blocked) || null
  }
  if (role === 'client') {
    return (db.clients || []).find(c => phonesMatch(c.phone, phone) && !c.blocked) || null
  }
  return null
}

export function verifyStaffOtp(db, phone, code, role) {
  const person = findStaffByPhone(db, phone, role)
  if (!person) return { error: 'Номер не найден или доступ заблокирован', status: 404 }
  const expected = person.otp || '1234'
  if (String(code) !== expected) {
    return { error: `Неверный код · Демо: ${expected}`, status: 400 }
  }
  if (role === 'courier') {
    return {
      access_token: `token-courier-${person.id}`,
      role: 'courier',
      user_id: person.id,
      staff_id: person.id,
      name: person.name,
      phone: person.phone,
    }
  }
  if (role === 'assembler') {
    return {
      access_token: `token-assembler-${person.id}`,
      role: 'assembler',
      user_id: person.id,
      staff_id: person.id,
      name: person.name,
      phone: person.phone,
    }
  }
  if (role === 'restaurant') {
    return {
      access_token: `token-restaurant-${person.id}`,
      role: 'restaurant',
      user_id: person.id,
      restaurant_id: person.id,
      name: person.name,
      phone: person.phone,
    }
  }
  return {
    access_token: `token-client-${person.id}`,
    role: 'client',
    user_id: person.id,
    name: person.name,
    phone: person.phone,
  }
}
