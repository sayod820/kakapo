'use strict'

/**
 * TCP-протокол CAS CL-3000 / CL-5000 (семейство CL).
 * PLU: https://github.com/alexesDev/cas
 * Живой вес: CAS Network Manual — R45F04,00\\n → W=… P=…
 */

const net = require('net')
const iconv = require('iconv-lite')

const PLU_SIZE = 148
const WEIGHT_CMD = Buffer.from('R45F04,00\n', 'ascii')

function checksum(data) {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum = (sum + data[i]) & 0xff
  return sum
}

function encodePacket(address, opcode, data) {
  const buf = Buffer.alloc(10 + data.length + 3)
  buf[0] = opcode.charCodeAt(0)
  buf[1] = opcode.charCodeAt(1)
  buf.writeUInt32LE(address >>> 0, 2)
  buf[6] = 0x2c // ','
  buf.writeUInt16LE(data.length, 7)
  buf[9] = 0x3a // ':'
  data.copy(buf, 10)
  const end = 10 + data.length
  buf[end] = 0x3a // ':'
  buf[end + 1] = checksum(buf.subarray(2, end + 1))
  buf[end + 2] = 0x0d
  return buf
}

function nameToCp1251(str, len) {
  const text = String(str || '').trim().slice(0, len)
  const enc = iconv.encode(text, 'win1251')
  const out = Buffer.alloc(len, 0)
  enc.copy(out, 0, 0, Math.min(enc.length, len))
  return out
}

function buildPluBuffer(item) {
  const buf = Buffer.alloc(PLU_SIZE, 0)
  const dept = Math.max(1, Math.min(99, Number(item.department) || 1))
  const plu = Math.max(1, Math.min(999999, Number(item.plu) || 0))
  const price = Math.max(0, Math.round((Number(item.price) || 0) * 100))
  const itemCode = Math.max(0, Number(String(item.barcode || '').replace(/\D/g, '').slice(0, 9)) || 0)

  buf.writeUInt16LE(dept, 0)
  buf.writeUInt32LE(plu, 2)
  buf[6] = 1 // PLUType: вес
  nameToCp1251(item.name || `PLU ${plu}`, 40).copy(buf, 7)
  buf.writeUInt16LE(1, 92) // GroupNumber
  buf.writeUInt16LE(1, 94) // LabelNumber
  buf[100] = 1 // UnitWeightNumber (kg)
  buf.writeUInt32LE(itemCode, 105)
  buf.writeUInt32LE(price, 113) // UnitPrice
  buf.writeUInt16LE(1, 126) // BarcodeNumber (шаблон)
  return buf
}

function tcpConnect(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.setTimeout(0)
      resolve(socket)
    })
    socket.setTimeout(timeoutMs)
    socket.once('error', reject)
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error('Таймаут связи с весами CAS'))
    })
  })
}

function writeAndRead(socket, packet, timeoutMs = 5000, minBytes = 2) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let settled = false
    let settleTimer = null
    const timer = setTimeout(() => {
      cleanup()
      if (!settled) {
        settled = true
        reject(new Error('Нет ответа от весов CAS'))
      }
    }, timeoutMs)

    function finish() {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }

    function onData(d) {
      chunks.push(d)
      const buf = Buffer.concat(chunks)
      if (buf.length >= minBytes) {
        clearTimeout(timer)
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(finish, 40)
      }
    }
    function onErr(e) {
      if (settled) return
      settled = true
      cleanup()
      reject(e)
    }
    function cleanup() {
      clearTimeout(timer)
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = null
      socket.off('data', onData)
      socket.off('error', onErr)
    }

    socket.on('data', onData)
    socket.on('error', onErr)
    socket.write(packet)
  })
}

/** Ответ веса готов: есть W=число и терминатор поля. */
function isWeightFrameComplete(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '')
  // CAS часто шлёт W=0,255. (запятая) или W=0.255.P=
  // Терминатор после числа: точка-разделитель полей, CR/LF, P=, ; 
  // Не путать с десятичной запятой внутри числа.
  return /W\s*=\s*-?\d+[.,]\d+\s*(?:\.(?:\s|$|[A-Za-z])|\r|\n|;|P\s*=)/i.test(text)
    || /W\s*=\s*-?\d+\s*(?:\.(?:\s|$|[A-Za-z])|\r|\n|;|P\s*=)/i.test(text)
    || /(?:ST|US)\s*,\s*(?:NT|GS)\s*,[^]*?\d+[.,]\d+/i.test(text)
}

function writeAndReadWeight(socket, timeoutMs = 900) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let settled = false
    let settleTimer = null
    const timer = setTimeout(() => {
      if (settled) return
      const buf = Buffer.concat(chunks)
      if (buf.length > 0 && /W\s*=/i.test(buf.toString('latin1'))) {
        settled = true
        cleanup()
        resolve(buf)
        return
      }
      cleanup()
      settled = true
      reject(new Error('Нет ответа от весов CAS'))
    }, timeoutMs)

    function finish() {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }

    function onData(d) {
      chunks.push(d)
      const buf = Buffer.concat(chunks)
      if (isWeightFrameComplete(buf)) {
        clearTimeout(timer)
        if (settleTimer) clearTimeout(settleTimer)
        // Чуть подождать хвост P=…, но не тормозить UI
        settleTimer = setTimeout(finish, 15)
      }
    }
    function onErr(e) {
      if (settled) return
      settled = true
      cleanup()
      reject(e)
    }
    function cleanup() {
      clearTimeout(timer)
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = null
      socket.off('data', onData)
      socket.off('error', onErr)
    }

    socket.on('data', onData)
    socket.on('error', onErr)
    socket.write(WEIGHT_CMD)
  })
}

async function downloadPlu(socket, scaleId, item) {
  const data = buildPluBuffer(item)
  const packet = encodePacket(scaleId >>> 0, 'WL', data)
  const resp = await writeAndRead(socket, packet)
  if (resp[0] !== 0x47 || resp[1] !== 0x4c) { // 'G','L'
    throw new Error(`Весы отказали PLU ${item.plu}`)
  }
}

/**
 * @param {{ host: string, port?: number, scaleId?: number, clearAll?: boolean, items: { plu: number, name: string, price: number, barcode?: string, department?: number }[] }} opts
 */
async function syncCasPlu(opts) {
  const host = String(opts.host || '').trim()
  const port = Number(opts.port) || 20304
  const scaleId = Number(opts.scaleId) || 0
  const items = Array.isArray(opts.items) ? opts.items.filter(i => Number(i.plu) > 0) : []

  if (!host) throw new Error('Укажите IP весов CAS')
  if (!items.length) throw new Error('Нет товаров с PLU для выгрузки')

  const socket = await tcpConnect(host, port)
  try {
    if (opts.clearAll) {
      const plu = Buffer.alloc(6, 0)
      const packet = encodePacket(scaleId >>> 0, 'WL', plu)
      const resp = await writeAndRead(socket, packet)
      if (resp[0] !== 0x47 || resp[1] !== 0x4c) {
        throw new Error('Не удалось очистить PLU на весах')
      }
    }

    let ok = 0
    for (const item of items) {
      await downloadPlu(socket, scaleId, item)
      ok += 1
    }
    return { ok: true, count: ok, host, port }
  } finally {
    socket.destroy()
  }
}

/**
 * Разбор ответа R45F04 / W45… или CAS stream ST,NT,…
 * Важно: русские CAS часто шлют десятичную запятую: W=0,255.
 */
function parseWeightResponse(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '')
  const raw = text.slice(0, 240)

  let wToken = null
  let fromHex = false

  // 1) Hex-граммы: W=00FF. (буквы A–F) — до десятичного разбора
  const hex = text.match(/(?:^|[^A-Za-z0-9])W\s*=\s*([0-9A-Fa-f]{2,8})\s*\./)
  if (hex && /[A-Fa-f]/.test(hex[1])) {
    const gramsHex = parseInt(hex[1], 16)
    if (Number.isFinite(gramsHex)) {
      wToken = String(gramsHex / 1000)
      fromHex = true
    }
  }

  // 2) Поле W=… с точкой или запятой (русские CAS: W=0,255.)
  if (!wToken) {
    const wEq = text.match(/(?:^|[^A-Za-z0-9])W\s*=\s*(-?\d+[.,]\d+|-?\d+)/i)
    if (wEq) wToken = wEq[1]
  }

  // 3) Поток ST,NT,+  0.255kg
  if (!wToken) {
    const stream = text.match(/(?:ST|US|OL|HD)\s*,\s*(?:NT|GS)\s*,\s*[+\-]?\s*(-?\d+[.,]\d+|-?\d+)\s*(?:kg|г|g)?/i)
    if (stream) wToken = stream[1]
  }

  const pMatch = text.match(/(?:^|[^A-Za-z0-9])P\s*=\s*(-?\d+[.,]\d+|-?\d+)/i)

  if (!wToken) {
    return {
      ok: false,
      weightKg: 0,
      grams: 0,
      price: null,
      raw,
      error: 'Нет поля веса в ответе весов',
    }
  }

  const rawW = String(wToken).trim().replace(',', '.')
  let weightKg = Number(rawW)
  if (!Number.isFinite(weightKg)) weightKg = 0

  if (!fromHex && !rawW.includes('.')) {
    // Целое без дробной части: граммы (255 → 0.255 кг)
    if (Math.abs(weightKg) >= 1 && Math.abs(weightKg) < 100000) {
      weightKg = weightKg / 1000
    }
  }

  // Точность как на дисплее CAS: 1 г
  weightKg = Math.round(weightKg * 1000) / 1000
  if (weightKg < 0) weightKg = 0
  if (weightKg > 150) {
    return { ok: false, weightKg: 0, grams: 0, price: null, raw, error: 'Вес вне диапазона' }
  }

  const grams = Math.round(weightKg * 1000)
  let price = null
  if (pMatch) {
    let pv = Number(String(pMatch[1]).replace(',', '.'))
    if (Number.isFinite(pv)) {
      if (!String(pMatch[1]).includes('.') && !String(pMatch[1]).includes(',') && pv >= 100) {
        pv = pv / 100
      }
      price = pv
    }
  }

  return {
    ok: true,
    weightKg,
    grams,
    price,
    raw,
    display: weightKg.toFixed(3),
    stable: true,
  }
}

function toWeightResult(parsed, host, port) {
  return {
    ok: true,
    host,
    port,
    weightKg: parsed.weightKg,
    grams: parsed.grams,
    price: parsed.price,
    raw: parsed.raw,
    display: parsed.display || parsed.weightKg.toFixed(3),
    connected: true,
    ts: Date.now(),
  }
}

/**
 * Однократное чтение веса.
 * Если монитор уже держит TCP — читаем через него (у CAS часто 1 соединение).
 * @param {{ host: string, port?: number, timeoutMs?: number }} opts
 */
async function readLiveWeight(opts) {
  const host = String(opts.host || weightMonitor.host || '').trim()
  const port = Number(opts.port || weightMonitor.port) || 20304
  const timeoutMs = Number(opts.timeoutMs) || 4000
  if (!host) throw new Error('Укажите IP весов CAS')

  if (weightMonitor.running) {
    const snap = await weightMonitor.readOnce()
    return toWeightResult(snap, host, port)
  }

  const socket = await tcpConnect(host, port, timeoutMs)
  try {
    const resp = await writeAndReadWeight(socket, timeoutMs)
    const parsed = parseWeightResponse(resp)
    if (!parsed.ok) throw new Error(parsed.error || 'Не удалось разобрать вес')
    return toWeightResult(parsed, host, port)
  } finally {
    socket.destroy()
  }
}

/**
 * Фоновый монитор веса: опрос ~10 Гц, одно TCP-соединение.
 */
class CasWeightMonitor {
  constructor() {
    this.host = ''
    this.port = 20304
    this.intervalMs = 120
    this.socket = null
    this.timer = null
    this.busy = false
    this.running = false
    this.onUpdate = null
    this.lastError = ''
    this.connected = false
    this.stableCount = 0
    this.lastRawKg = null
    this.lastEmitKg = null
    this.lastParsed = null
  }

  setListener(fn) {
    this.onUpdate = typeof fn === 'function' ? fn : null
  }

  emit(partial) {
    if (!this.onUpdate) return
    this.onUpdate({
      connected: this.connected,
      host: this.host,
      port: this.port,
      running: this.running,
      weightKg: 0,
      grams: 0,
      price: null,
      stable: false,
      error: '',
      ts: Date.now(),
      ...partial,
    })
  }

  async start(opts = {}) {
    const host = String(opts.host || '').trim()
    const port = Number(opts.port) || 20304
    if (!host) throw new Error('Укажите IP весов CAS')

    const same = this.running && this.host === host && this.port === port && this.socket && !this.socket.destroyed
    this.host = host
    this.port = port
    this.intervalMs = Math.max(80, Math.min(500, Number(opts.intervalMs) || 120))
    this.running = true
    this.lastError = ''

    if (!same) {
      this.stableCount = 0
      await this.ensureSocket()
    }

    // Сразу читаем текущий вес (товар уже на платформе → не показываем 0)
    try {
      const snap = await this.readOnce()
      this.emit({
        connected: true,
        weightKg: snap.weightKg,
        grams: snap.grams,
        price: snap.price,
        stable: true,
        error: '',
        raw: snap.raw,
        display: snap.display,
      })
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      this.emit({
        connected: this.connected,
        weightKg: this.lastEmitKg || 0,
        grams: Math.round((this.lastEmitKg || 0) * 1000),
        error: this.lastError,
      })
    }

    this.schedule(this.intervalMs)
    return { ok: true, host: this.host, port: this.port, running: true }
  }

  stop() {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.destroySocket()
    this.emit({ connected: false, running: false, weightKg: this.lastEmitKg || 0, grams: Math.round((this.lastEmitKg || 0) * 1000) })
    return { ok: true, running: false }
  }

  destroySocket() {
    if (this.socket) {
      try { this.socket.destroy() } catch { /* ignore */ }
      this.socket = null
    }
    this.connected = false
  }

  async ensureSocket() {
    if (this.socket && !this.socket.destroyed) return this.socket
    this.destroySocket()
    const socket = await tcpConnect(this.host, this.port, 3000)
    socket.setNoDelay(true)
    socket.on('error', () => {
      this.connected = false
      this.destroySocket()
    })
    socket.on('close', () => {
      this.connected = false
      this.socket = null
    })
    this.socket = socket
    this.connected = true
    this.lastError = ''
    return socket
  }

  schedule(delay) {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.tick()
    }, delay == null ? this.intervalMs : delay)
  }

  async readOnce() {
    // Ждём освобождения текущего опроса, чтобы не слать 2 команды сразу
    const started = Date.now()
    while (this.busy && Date.now() - started < 1500) {
      await new Promise(r => setTimeout(r, 20))
    }
    this.busy = true
    try {
      const socket = await this.ensureSocket()
      const resp = await writeAndReadWeight(socket, 1200)
      const parsed = parseWeightResponse(resp)
      if (!parsed.ok) throw new Error(parsed.error || 'Пустой ответ')
      this.connected = true
      this.lastError = ''
      this.lastEmitKg = parsed.weightKg
      this.lastParsed = parsed
      this.lastRawKg = parsed.weightKg
      return parsed
    } finally {
      this.busy = false
    }
  }

  async tick() {
    if (!this.running) return
    if (this.busy) {
      this.schedule(this.intervalMs)
      return
    }
    this.busy = true
    try {
      const socket = await this.ensureSocket()
      const resp = await writeAndReadWeight(socket, 900)
      const parsed = parseWeightResponse(resp)
      if (!parsed.ok) throw new Error(parsed.error || 'Пустой ответ')

      const kg = parsed.weightKg
      if (this.lastRawKg != null && Math.abs(this.lastRawKg - kg) <= 0.0005) {
        this.stableCount += 1
      } else {
        this.stableCount = 0
      }
      this.lastRawKg = kg
      const stable = this.stableCount >= 1 || kg === 0

      this.connected = true
      this.lastError = ''
      this.lastEmitKg = kg
      this.lastParsed = parsed
      this.emit({
        connected: true,
        weightKg: kg,
        grams: parsed.grams,
        price: parsed.price,
        stable,
        error: '',
        raw: parsed.raw,
        display: parsed.display,
      })
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      this.connected = false
      this.destroySocket()
      this.emit({
        connected: false,
        weightKg: this.lastEmitKg || 0,
        grams: Math.round((this.lastEmitKg || 0) * 1000),
        stable: false,
        error: this.lastError,
      })
    } finally {
      this.busy = false
      this.schedule(this.intervalMs)
    }
  }
}

const weightMonitor = new CasWeightMonitor()

module.exports = {
  syncCasPlu,
  readLiveWeight,
  parseWeightResponse,
  weightMonitor,
  CasWeightMonitor,
}
