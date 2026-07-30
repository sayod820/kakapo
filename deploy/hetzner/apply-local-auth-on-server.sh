#!/usr/bin/env bash
# Включить на сервере: GET /employees/local-auth (пароли сотрудников для кассы)
# Запуск НА СЕРВЕРЕ Hetzner:
#   bash /opt/kakapo/deploy/hetzner/apply-local-auth-on-server.sh
# Или одной командой с ПК (введёте пароль SSH):
#   ssh root@46.225.92.161 'bash -s' < deploy/hetzner/apply-local-auth-on-server.sh
set -euo pipefail

CONTAINER="${KAKAPO_API_CONTAINER:-kakapo-api}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Контейнер $CONTAINER не найден. Запущенные:"
  docker ps --format '{{.Names}}'
  exit 1
fi

echo "==> Патч $CONTAINER: /employees/local-auth"

docker exec -i "$CONTAINER" node <<'NODE'
import fs from 'fs'

const elPath = '/app/employeesLogic.js'
const idxPath = '/app/index.js'

let el = fs.readFileSync(elPath, 'utf8')
if (!el.includes('listEmployeesLocalAuth')) {
  const fn = `
export function listEmployeesLocalAuth(db) {
  ensureEmployees(db)
  return [...db.employees]
    .filter(e => e && e.active !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'))
    .map(e => ({
      id: e.id,
      name: e.name,
      role: e.role || 'custom',
      roleLabel: EMPLOYEE_ROLE_PRESETS[e.role]?.label || 'Свой набор',
      permissions: Array.isArray(e.permissions) ? [...e.permissions] : [],
      active: e.active !== false,
      password: String(e.password || ''),
    }))
}
`
  if (!el.includes('export function listEmployees(db)')) {
    console.error('employeesLogic.js: не найден listEmployees — отмена')
    process.exit(1)
  }
  el = el.replace('export function listEmployees(db)', `${fn}\nexport function listEmployees(db)`)
  fs.writeFileSync(elPath, el)
  console.log('employeesLogic.js: добавлен listEmployeesLocalAuth')
} else {
  console.log('employeesLogic.js: listEmployeesLocalAuth уже есть')
}

let idx = fs.readFileSync(idxPath, 'utf8')
if (!idx.includes("'/employees/local-auth'") && !idx.includes('"/employees/local-auth"')) {
  if (!idx.includes('listEmployeesLocalAuth')) {
    if (idx.includes('listEmployees,')) {
      idx = idx.replace('listEmployees,', 'listEmployees,\n  listEmployeesLocalAuth,')
    } else if (idx.includes('listEmployees\n}')) {
      idx = idx.replace('listEmployees\n}', 'listEmployees,\n  listEmployeesLocalAuth,\n}')
    } else {
      console.error('index.js: не удалось добавить import listEmployeesLocalAuth')
      process.exit(1)
    }
  }
  const route = `
app.get('/employees/local-auth', (_req, res) => {
  res.json(listEmployeesLocalAuth(db))
})
`
  if (idx.includes("app.get('/employees/directory'")) {
    idx = idx.replace("app.get('/employees/directory'", `${route}\napp.get('/employees/directory'`)
  } else if (idx.includes('app.get("/employees/directory"')) {
    idx = idx.replace('app.get("/employees/directory"', `${route}\napp.get("/employees/directory"`)
  } else {
    console.error('index.js: не найден /employees/directory — отмена')
    process.exit(1)
  }
  fs.writeFileSync(idxPath, idx)
  console.log('index.js: добавлен GET /employees/local-auth')
} else {
  console.log('index.js: /employees/local-auth уже есть')
}

console.log('patch ok')
NODE

echo "==> Перезапуск API"
docker restart "$CONTAINER"
sleep 4

echo "==> Проверка"
code="$(docker exec "$CONTAINER" node -e "fetch('http://127.0.0.1:8000/employees/local-auth').then(r=>{console.log(r.status);return r.json()}).then(j=>console.log('employees',Array.isArray(j)?j.length:typeof j)).catch(e=>{console.error(e);process.exit(1)})")"
echo "$code"
echo "Готово. Касса при следующей загрузке сама скачает пароли с сервера."
