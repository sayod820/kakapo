'use strict'

/**
 * TCP-протокол CAS CL-3000 / CL-5000 (семейство CL).
 * PLU: https://github.com/alexesDev/cas
 * Живой вес (CAS Network Manual 4.9.4):
 *   Send: R45F04,00\\n
 *   Recv: … W=…. P=….
 *
 * Логика кассы (не протокол):
 *   пинг → live граммы → в поле после одинаковых отсчётов →
 *   после снятия держим → добавка ≥5 г обновляет.
 */

const net = require('net')
const iconv = require('iconv-lite')

const PLU_SIZE = 148
const WEIGHT_CMD = Buffer.from('R45F04,00\n', 'ascii')
/** Шаг весов точки (г) — только для «добавка», не для STOP */
const DEFAULT_DIVISION_G = 5

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

/**
 * Кадр готов только когда есть W=… и P=… (полный ответ Network Manual).
 * Иначе на «W=3» из «W=3.250» / «W=350» касса ошибочно показывает 3 г.
 */
function isWeightFrameComplete(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '')
  return /W\s*=\s*-?\d+(?:[.,]\d+)?[\s.,;:]*P\s*=/i.test(text)
}

/**
 * Один запрос веса. Закрываем чтение ТОЛЬКО после W=…P=.
 */
function writeAndReadWeight(socket, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let settled = false
    let quietTimer = null
    const timer = setTimeout(() => {
      if (settled) return
      const buf = Buffer.concat(chunks)
      const text = buf.toString('latin1')
      if (isWeightFrameComplete(text)) {
        finish()
        return
      }
      cleanup()
      settled = true
      reject(new Error(
        buf.length
          ? `Неполный ответ весов: ${text.slice(0, 80)}`
          : 'Нет ответа от весов CAS',
      ))
    }, timeoutMs)

    function finish() {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }

    function onData(d) {
      chunks.push(d)
      const text = Buffer.concat(chunks).toString('latin1')
      if (quietTimer) clearTimeout(quietTimer)
      if (isWeightFrameComplete(text)) {
        quietTimer = setTimeout(finish, 30)
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
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = null
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

  // CAS принимает одно TCP-соединение: пауза монитора веса на время выгрузки PLU.
  const resumeMonitor = weightMonitor.running
  const resumeHost = weightMonitor.host || host
  const resumePort = weightMonitor.port || port
  if (resumeMonitor) {
    await weightMonitor.stop()
    await sleep(500)
  }

  let socket
  try {
    socket = await tcpConnect(host, port, 8000)
  } catch (e) {
    if (resumeMonitor) {
      try { await weightMonitor.start({ host: resumeHost, port: resumePort }) } catch { /* ignore */ }
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|timeout|Таймаут/i.test(msg)
        ? `Нет связи с весами ${host}:${port}. Проверьте кабель/IP и что весы включены.`
        : msg,
    )
  }

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
    try { socket.destroy() } catch { /* ignore */ }
    if (resumeMonitor) {
      await sleep(300)
      try { await weightMonitor.start({ host: resumeHost, port: resumePort }) } catch { /* ignore */ }
    }
  }
}

/**
 * Разбор R45F04: только поле W= перед P= (полный кадр).
 * Пример: W45F04,00L0016:W=0.255.P=6.50.
 */
function parseWeightResponse(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '')
  const raw = text.slice(0, 240)

  // Только W=…P= — не берём обрезок W=3 из W=3.250 / W=350
  const beforeP = [...text.matchAll(/W\s*=\s*([+-]?\d+[.,]\d+|[+-]?\d+)\s*[.,;:\s]*P\s*=/gi)]
  let wToken = beforeP.length ? beforeP[beforeP.length - 1][1] : null
  let fromHex = false

  if (!wToken) {
    return { ok: false, weightKg: 0, grams: 0, price: null, raw, error: 'Нет полного W=…P= в ответе' }
  }

  if (/^[0-9A-Fa-f]+$/i.test(wToken) && /[A-Fa-f]/.test(wToken) && !/[.,]/.test(wToken)) {
    const gramsHex = parseInt(wToken, 16)
    if (Number.isFinite(gramsHex)) {
      wToken = String(gramsHex / 1000)
      fromHex = true
    }
  }

  const rawW = String(wToken).trim().replace(',', '.')
  let weightKg = Number(rawW)
  if (!Number.isFinite(weightKg)) weightKg = 0

  // Целое без точки: граммы только если похоже на граммы (0255 / 255), не «3» кг
  if (!fromHex && !rawW.includes('.')) {
    const digits = rawW.replace(/^[+-]/, '')
    if (/^0\d+$/.test(digits) || digits.length >= 3) {
      weightKg = weightKg / 1000
    }
    // 1–2 цифры без точки при P= — считаем кг (редко); обычно CAS шлёт 0.xxx
  }

  weightKg = Math.round(weightKg * 1000) / 1000
  if (weightKg < 0) weightKg = 0
  if (weightKg > 150) {
    return { ok: false, weightKg: 0, grams: 0, price: null, raw, error: 'Вес вне диапазона' }
  }

  const pAll = [...text.matchAll(/P\s*=\s*([+-]?\d+[.,]\d+|[+-]?\d+)/gi)]
  const pMatch = pAll.length ? pAll[pAll.length - 1] : null
  let price = null
  if (pMatch) {
    let pv = Number(String(pMatch[1]).replace(',', '.'))
    if (Number.isFinite(pv)) {
      if (!/[.,]/.test(String(pMatch[1])) && pv >= 100) pv = pv / 100
      price = pv
    }
  }

  return {
    ok: true,
    weightKg,
    grams: Math.round(weightKg * 1000),
    price,
    raw,
    display: weightKg.toFixed(3),
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
 * Однократное чтение веса по указанному IP/порту.
 * Если монитор сидит на ДРУГОМ адресе — сначала переключаем его (у CAS часто 1 TCP).
 * @param {{ host: string, port?: number, timeoutMs?: number }} opts
 */
async function readLiveWeight(opts) {
  const host = String(opts.host || '').trim()
  const port = Number(opts.port) || 20304
  const timeoutMs = Number(opts.timeoutMs) || 4000
  if (!host) throw new Error('Укажите IP весов CAS')

  // Монитор уже на этом IP — читаем через него
  if (
    weightMonitor.running
    && weightMonitor.host === host
    && weightMonitor.port === port
    && weightMonitor.socket
    && !weightMonitor.socket.destroyed
  ) {
    const snap = await weightMonitor.readOnce()
    return toWeightResult(snap, host, port)
  }

  // Другой IP или монитор выключен: освобождаем старое соединение и читаем напрямую
  const wasRunning = weightMonitor.running
  if (wasRunning) {
    await weightMonitor.stop()
    await sleep(200)
  }

  try {
    const socket = await tcpConnect(host, port, timeoutMs)
    try {
      const resp = await writeAndReadWeight(socket, timeoutMs)
      const parsed = parseWeightResponse(resp)
      if (!parsed.ok) throw new Error(parsed.error || 'Не удалось разобрать вес')
      return toWeightResult(parsed, host, port)
    } finally {
      try { socket.destroy() } catch { /* ignore */ }
    }
  } finally {
    if (wasRunning) {
      try {
        await weightMonitor.start({ host, port })
      } catch { /* монитор поднимет UI / следующий старт */ }
    }
  }
}

/**
 * Фоновый монитор: пинг R45F04.
 * stable = одни и те же граммы ≥ 3 раза подряд (~0.3–0.4 с).
 */
class CasWeightMonitor {
  constructor() {
    this.host = ''
    this.port = 20304
    this.intervalMs = 150
    this.readTimeoutMs = 1200
    this.sameNeed = 2
    this.divisionG = DEFAULT_DIVISION_G
    this.socket = null
    this.timer = null
    this.busy = false
    this.running = false
    this.onUpdate = null
    this.lastError = ''
    this.connected = false
    this.lastEmitKg = null
    this.lastParsed = null
    this.sameGrams = null
    this.sameCount = 0
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

    const sameHost = this.host === host && this.port === port
    const same = this.running && sameHost && this.socket && !this.socket.destroyed

    this.host = host
    this.port = port
    this.intervalMs = Math.max(120, Math.min(400, Number(opts.intervalMs) || 150))
    this.readTimeoutMs = Math.max(600, Math.min(3000, Number(opts.readTimeoutMs) || 1200))
    this.sameNeed = Math.max(2, Math.min(6, Number(opts.sameNeed) || 2))
    this.divisionG = Math.max(1, Math.min(10, Number(opts.divisionG) || DEFAULT_DIVISION_G))
    this.running = true
    this.lastError = ''

    if (!same) {
      this.sameGrams = null
      this.sameCount = 0
      // Важно: при смене IP нельзя переиспользовать старый сокет
      this.destroySocket()
      await this.ensureSocket()
    }

    try {
      const snap = await this.readOnce()
      this.noteSample(snap.grams)
      this.emit({
        connected: true,
        weightKg: snap.weightKg,
        grams: snap.grams,
        price: snap.price,
        stable: this.isStable(),
        error: '',
        raw: snap.raw,
        display: snap.display || snap.weightKg.toFixed(3),
      })
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      this.emit({
        connected: this.connected,
        weightKg: this.lastEmitKg || 0,
        grams: Math.round((this.lastEmitKg || 0) * 1000),
        error: this.lastError,
        stable: false,
      })
    }

    this.schedule(this.intervalMs)
    return { ok: true, host: this.host, port: this.port, running: true }
  }

  async stop() {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const waitStart = Date.now()
    while (this.busy && Date.now() - waitStart < 2000) {
      await sleep(30)
    }
    this.destroySocket()
    this.emit({
      connected: false,
      running: false,
      weightKg: this.lastEmitKg || 0,
      grams: Math.round((this.lastEmitKg || 0) * 1000),
      stable: false,
    })
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

  noteSample(grams) {
    const g = Math.round(Number(grams) || 0)
    if (this.sameGrams === g) {
      this.sameCount += 1
    } else {
      this.sameGrams = g
      this.sameCount = 1
    }
  }

  isStable() {
    return this.sameCount >= this.sameNeed
  }

  async readOnce() {
    const started = Date.now()
    while (this.busy && Date.now() - started < 1500) {
      await sleep(20)
    }
    this.busy = true
    try {
      const socket = await this.ensureSocket()
      const resp = await writeAndReadWeight(socket, Math.max(this.readTimeoutMs, 600))
      const parsed = parseWeightResponse(resp)
      if (!parsed.ok) throw new Error(parsed.error || 'Пустой ответ')
      this.connected = true
      this.lastError = ''
      this.lastEmitKg = parsed.weightKg
      this.lastParsed = parsed
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
    const tickStarted = Date.now()
    try {
      const socket = await this.ensureSocket()
      const resp = await writeAndReadWeight(socket, this.readTimeoutMs)
      const parsed = parseWeightResponse(resp)
      if (!parsed.ok) throw new Error(parsed.error || 'Пустой ответ')

      this.noteSample(parsed.grams)
      const stable = this.isStable()

      this.connected = true
      this.lastError = ''
      this.lastEmitKg = parsed.weightKg
      this.lastParsed = parsed
      this.emit({
        connected: true,
        weightKg: parsed.weightKg,
        grams: parsed.grams,
        price: parsed.price,
        stable,
        error: '',
        raw: parsed.raw,
        display: parsed.display || parsed.weightKg.toFixed(3),
      })
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      const fatal = /ECONN|ECONNRESET|EPIPE|ETIMEDOUT|EHOST|ENET|closed|destroy|connect|Таймаут связи/i.test(this.lastError)
        || !this.socket
        || this.socket.destroyed
      if (fatal) {
        this.connected = false
        this.destroySocket()
      }
      this.emit({
        connected: this.connected,
        weightKg: this.lastEmitKg || 0,
        grams: Math.round((this.lastEmitKg || 0) * 1000),
        stable: false,
        error: this.lastError,
      })
    } finally {
      this.busy = false
      const elapsed = Date.now() - tickStarted
      const wait = Math.max(50, this.intervalMs - elapsed)
      this.schedule(wait)
    }
  }
}

const weightMonitor = new CasWeightMonitor()

module.exports = {
  syncCasPlu,
  readLiveWeight,
  parseWeightResponse,
  isWeightFrameComplete,
  weightMonitor,
  CasWeightMonitor,
  DEFAULT_DIVISION_G,
}
