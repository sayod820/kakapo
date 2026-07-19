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
        // Короткая пауза, чтобы собрать полный ответ веса.
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

/** Разбор ответа R45F04 / W45… с полями W= и P=. */
function parseWeightResponse(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '')
  const wMatch = text.match(/W\s*=\s*(-?\d+(?:\.\d+)?)/i)
  const pMatch = text.match(/P\s*=\s*(-?\d+(?:\.\d+)?)/i)
  if (!wMatch) {
    return {
      ok: false,
      weightKg: 0,
      grams: 0,
      price: null,
      raw: text.slice(0, 200),
      error: 'Нет поля W= в ответе весов',
    }
  }

  let weightKg = Number(wMatch[1])
  if (!Number.isFinite(weightKg)) weightKg = 0

  // Если значение выглядит как граммы (целое ≥ 100 без десятичной части): 1250 → 1.25 кг
  const rawW = wMatch[1]
  if (!rawW.includes('.') && Math.abs(weightKg) >= 100 && Math.abs(weightKg) < 100000) {
    weightKg = weightKg / 1000
  }

  weightKg = Math.round(weightKg * 1000) / 1000
  if (weightKg < 0) weightKg = 0
  const grams = Math.round(weightKg * 1000)
  const price = pMatch && Number.isFinite(Number(pMatch[1])) ? Number(pMatch[1]) : null

  return {
    ok: true,
    weightKg,
    grams,
    price,
    raw: text.slice(0, 200),
    stable: true,
  }
}

/**
 * Однократное чтение веса (для теста связи).
 * @param {{ host: string, port?: number, timeoutMs?: number }} opts
 */
async function readLiveWeight(opts) {
  const host = String(opts.host || '').trim()
  const port = Number(opts.port) || 20304
  const timeoutMs = Number(opts.timeoutMs) || 4000
  if (!host) throw new Error('Укажите IP весов CAS')

  const socket = await tcpConnect(host, port, timeoutMs)
  try {
    const resp = await writeAndRead(socket, WEIGHT_CMD, timeoutMs, 4)
    const parsed = parseWeightResponse(resp)
    if (!parsed.ok) throw new Error(parsed.error || 'Не удалось разобрать вес')
    return {
      ok: true,
      host,
      port,
      weightKg: parsed.weightKg,
      grams: parsed.grams,
      price: parsed.price,
      raw: parsed.raw,
      connected: true,
      ts: Date.now(),
    }
  } finally {
    socket.destroy()
  }
}

/**
 * Фоновый монитор веса: опрос ~4 Гц, реконнект при обрыве.
 */
class CasWeightMonitor {
  constructor() {
    this.host = ''
    this.port = 20304
    this.intervalMs = 280
    this.socket = null
    this.timer = null
    this.busy = false
    this.running = false
    this.onUpdate = null
    this.lastError = ''
    this.connected = false
    this.stableCount = 0
    this.lastRawKg = null
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

    this.host = host
    this.port = port
    this.intervalMs = Math.max(200, Math.min(1000, Number(opts.intervalMs) || 280))
    this.running = true
    this.lastError = ''
    this.stableCount = 0
    this.lastRawKg = null

    await this.ensureSocket()
    this.schedule()
    this.emit({ connected: this.connected, weightKg: 0, grams: 0, error: '' })
    return { ok: true, host: this.host, port: this.port, running: true }
  }

  stop() {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.destroySocket()
    this.emit({ connected: false, running: false, weightKg: 0, grams: 0 })
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
    const socket = await tcpConnect(this.host, this.port, 4000)
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

  schedule() {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.tick()
    }, this.intervalMs)
  }

  async tick() {
    if (!this.running || this.busy) {
      this.schedule()
      return
    }
    this.busy = true
    try {
      const socket = await this.ensureSocket()
      const resp = await writeAndRead(socket, WEIGHT_CMD, 2500, 4)
      const parsed = parseWeightResponse(resp)
      if (!parsed.ok) throw new Error(parsed.error || 'Пустой ответ')

      const kg = parsed.weightKg
      let stable = false
      if (this.lastRawKg != null && Math.abs(this.lastRawKg - kg) <= 0.002) {
        this.stableCount += 1
      } else {
        this.stableCount = 0
      }
      this.lastRawKg = kg
      // 2 одинаковых опроса ≈ стабильно
      stable = this.stableCount >= 1 || kg === 0

      this.connected = true
      this.lastError = ''
      this.emit({
        connected: true,
        weightKg: kg,
        grams: parsed.grams,
        price: parsed.price,
        stable,
        error: '',
        raw: parsed.raw,
      })
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      this.connected = false
      this.destroySocket()
      this.emit({
        connected: false,
        weightKg: 0,
        grams: 0,
        stable: false,
        error: this.lastError,
      })
    } finally {
      this.busy = false
      this.schedule()
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
