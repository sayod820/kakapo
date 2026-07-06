/**
 * HTTP-клиент JSON API кассовой программы GBS.Market (read-only).
 * Протокол: https://kb.gbsmarket.ru/2024/07/opisanie-json-api/
 */

const REQUEST_TIMEOUT_MS = 15_000

function baseUrl(settings) {
  const ip = String(settings?.ip || '').replace(/\/+$/, '')
  const port = String(settings?.port || '').trim()
  const host = ip.includes('://') ? ip : `http://${ip}`
  return port ? `${host}:${port}/api/v1` : `${host}/api/v1`
}

function authHeader(settings) {
  const user = String(settings?.user || '')
  const pass = String(settings?.pass || '')
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
}

/** Один запрос к API кассы. Бросает ошибку с понятным текстом при сбое сети/авторизации/Status:Error. */
export async function gbsFetch(settings, path, query = {}) {
  const url = new URL(baseUrl(settings) + path)
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader(settings) },
      signal: controller.signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`GBS Market: касса не ответила за ${REQUEST_TIMEOUT_MS / 1000}с (${url})`)
    }
    throw new Error(`GBS Market: не удалось подключиться (${e?.message || e}) — ${url}`)
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401) throw new Error('GBS Market: неверный логин/пароль JSON API')
  if (!res.ok) throw new Error(`GBS Market: HTTP ${res.status} на ${url}`)

  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`GBS Market: касса вернула не-JSON ответ (${url})`)
  }

  if (json?.Status && json.Status !== 'Ok') {
    throw new Error(`GBS Market: ${json?.Data?.Message || 'ответ со статусом Error'}`)
  }
  return json
}

/** Гоняет все страницы path, пока page <= TotalPages, собирает Data в единый массив. */
export async function gbsPaginate(settings, path, query = {}) {
  const pageSize = query.page_size || 200
  let page = 1
  let totalPages = 1
  const items = []
  do {
    const json = await gbsFetch(settings, path, { ...query, page, page_size: pageSize })
    const data = json?.Data
    if (Array.isArray(data)) items.push(...data)
    else if (data != null) items.push(data)
    totalPages = Number(json?.TotalPages) || 1
    page += 1
  } while (page <= totalPages)
  return items
}

export async function testGbsStatus(settings) {
  const json = await gbsFetch(settings, '/status')
  return json?.Data || null
}

export async function fetchAllGbsGoods(settings) {
  return gbsPaginate(settings, '/goods', { page_size: 200 })
}

export async function fetchGbsSaleDocuments(settings, dateStart, dateEnd) {
  return gbsPaginate(settings, '/documents', {
    type: 'Sale',
    date_start: dateStart,
    date_end: dateEnd,
    page_size: 200,
  })
}
