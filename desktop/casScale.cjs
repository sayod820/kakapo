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

/** Допуск стабильности (г): весы CL-3000 дрожат ±1–2 г при докладе */
const STABLE_TOLERANCE_G = 2
/** Сколько мс вес должен держаться в допуске, чтобы считать STOP */
const STABLE_DURATION_MS = 350
/** Хранить семплы чуть дольше окна стабильности */
const STABLE_BUFFER_MS = 500

/**
 * По буферу { grams, t }: stable если окно ≥ STABLE_DURATION_MS и max−min ≤ STABLE_TOLERANCE_G.
 * @returns {{ stable: boolean, grams: number }}
 */
function evaluateStability(samples, now = Date.now()) {
  const cutoff = now - STABLE_BUFFER_MS
  const live = samples.filter(s => s.t >= cutoff)
  if (live.length < 2) {
    return { stable: false, grams: live.length ? live[live.length - 1].grams : 0 }
  }
  const newest = live[live.length - 1]
  const oldestInWindow = live[0]
  const spanMs = newest.t - oldestInWindow.t
  if (spanMs < STABLE_DURATION_MS) {
    return { stable: false, grams: newest.grams }
  }
  // Только семплы за последние STABLE_DURATION_MS (хвост окна)
  const windowStart = newest.t - STABLE_DURATION_MS
  const inWindow = live.filter(s => s.t >= windowStart)
  if (inWindow.length < 2) {
    return { stable: false, grams: newest.grams }
  }
  let min = inWindow[0].grams
  let max = inWindow[0].grams
  let sum = 0
  for (const s of inWindow) {
    if (s.grams < min) min = s.grams
    if (s.grams > max) max = s.grams
    sum += s.grams
  }
  const stable = (max - min) <= STABLE_TOLERANCE_G
  // Для отображения — среднее по окну (округление до 1 г)
  const grams = Math.round(sum / inWindow.length)
  return { stable, grams }
}

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
  const itemCode = Math.max(
    0,
    Number(plu) || Number(String(item.barcode || '').replace(/\D/g, '').slice(0, 9)) || 0,
  )

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
 * Кадр веса: есть W=число (достаточно для CAS R45).
 * Не режем посреди дроби: ждём тишину после данных.
 */
function hasWeightPayload(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '')
  return /W\s*=\s*-?\d/i.test(text) || /(?:ST|US|OL|HD)\s*,\s*(?:NT|GS)\s*,/i.test(text)
}

function isWeightFrameComplete(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '')
  if (/W\s*=\s*-?\d+[.,]\d+\s*[.,;:\s]*P\s*=/i.test(text)) return true
  if (/W\s*=\s*-?\d+[.,]\d{2,}\s*(?:[.;:\r\n]|P\s*=|$)/i.test(text)) return true
  if (/(?:ST|US)\s*,\s*(?:NT|GS)\s*,[^]*?\d+[.,]\d+/i.test(text)) return true
  return false
}

/** Выбросить хвост прошлого ответа. */
function drainSocket(socket) {
  if (!socket || socket.destroyed) return
  try {
    socket.pause()
    let chunk
    while ((chunk = socket.read()) !== null) {
      /* discard */
    }
  } catch { /* ignore */ }
}

/**
 * Простое чтение R45: пишем команду → копим ответ → тишина 70 мс или полный W=…P=.
 * На таймауте принимаем любой буфер с W= (связь важнее идеала кадра).
 */
function writeAndReadWeight(socket, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.destroyed) {
      reject(new Error('Нет связи с весами'))
      return
    }
    drainSocket(socket)
    const chunks = []
    let settled = false
    let settleTimer = null
    const timer = setTimeout(() => {
      if (settled) return
      const buf = Buffer.concat(chunks)
      if (buf.length > 0 && hasWeightPayload(buf)) {
        settled = true
        cleanup()
        resolve(buf)
        return
      }
      cleanup()
      settled = true
      reject(new Error(buf.length ? `Неполный ответ: ${buf.toString('latin1').slice(0, 80)}` : 'Нет ответа от весов'))
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
      if (settleTimer) clearTimeout(settleTimer)
      if (isWeightFrameComplete(buf)) {
        settleTimer = setTimeout(finish, 40)
      } else if (hasWeightPayload(buf)) {
        settleTimer = setTimeout(finish, 100)
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
      try { socket.off('data', onData) } catch { /* ignore */ }
      try { socket.off('error', onErr) } catch { /* ignore */ }
      try { socket.pause() } catch { /* ignore */ }
    }

    socket.on('data', onData)
    socket.on('error', onErr)
    try {
      socket.write(WEIGHT_CMD)
    } catch (e) {
      settled = true
      cleanup()
      reject(e instanceof Error ? e : new Error(String(e)))
    }
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
 * Разбор R45F04. Берём ПОСЛЕДНИЙ W= (если в буфере старый+новый).
 * Примеры: W=0.070.P=…  /  W=0,255.P=…  /  W=0.255.
 */
function parseWeightResponse(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '')
  const raw = text.slice(0, 240)

  let wToken = null

  // 1) последний W= перед P=
  const beforeP = [...text.matchAll(/W\s*=\s*([+-]?\d+[.,]\d+|[+-]?\d+)\s*[.,;:\s]*P\s*=/gi)]
  if (beforeP.length) wToken = beforeP[beforeP.length - 1][1]

  // 2) последний W= с десятичной частью
  if (!wToken) {
    const dec = [...text.matchAll(/W\s*=\s*([+-]?\d+[.,]\d+)/gi)]
    if (dec.length) wToken = dec[dec.length - 1][1]
  }

  // 3) stream
  if (!wToken) {
    const streams = [...text.matchAll(/(?:ST|US|OL|HD)\s*,\s*(?:NT|GS)\s*,\s*[+\-]?\s*(-?\d+[.,]\d+|-?\d+)/gi)]
    if (streams.length) wToken = streams[streams.length - 1][1]
  }

  // 4) целое ≥10 = граммы
  if (!wToken) {
    const ints = [...text.matchAll(/W\s*=\s*([+-]?\d+)(?![.,\d])/gi)]
    if (ints.length) wToken = ints[ints.length - 1][1]
  }

  const pAll = [...text.matchAll(/P\s*=\s*([+-]?\d+[.,]\d+|[+-]?\d+)/gi)]
  const pMatch = pAll.length ? pAll[pAll.length - 1] : null

  if (!wToken) {
    return {
      ok: false,
      weightKg: 0,
      grams: 0,
      price: null,
      raw,
      error: `Нет поля W= в ответе: ${raw.slice(0, 100)}`,
    }
  }

  const rawW = String(wToken).trim().replace(',', '.')
  let weightKg = Number(rawW)
  if (!Number.isFinite(weightKg)) weightKg = 0

  if (!rawW.includes('.')) {
    const abs = Math.abs(weightKg)
    if (abs >= 10 && abs < 100000) weightKg = weightKg / 1000
  }

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
 * forceDirect=true — всегда новое TCP (для «Тест связи»), иначе через монитор если он уже на этом IP.
 * @param {{ host: string, port?: number, timeoutMs?: number, forceDirect?: boolean }} opts
 */
async function readLiveWeight(opts) {
  const host = String(opts.host || '').trim()
  const port = Number(opts.port) || 20304
  const timeoutMs = Number(opts.timeoutMs) || 4000
  const forceDirect = !!(opts.forceDirect || opts.fresh)
  if (!host) throw new Error('Укажите IP весов CAS')

  // Монитор уже на этом IP — читаем через него (если не принудительный тест)
  if (
    !forceDirect
    && weightMonitor.running
    && weightMonitor.host === host
    && weightMonitor.port === port
    && weightMonitor.socket
    && !weightMonitor.socket.destroyed
  ) {
    const snap = await weightMonitor.readOnce()
    return toWeightResult(snap, host, port)
  }

  // Прямое чтение: освобождаем порт монитора
  const wasRunning = weightMonitor.running
  const resumeHost = weightMonitor.host || host
  const resumePort = weightMonitor.port || port
  if (wasRunning) {
    await weightMonitor.stop()
    await sleep(250)
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
        await weightMonitor.start({ host: resumeHost, port: resumePort })
      } catch { /* ignore */ }
    }
  }
}

/**
 * Фоновый монитор веса.
 * stable = разброс ≤ STABLE_TOLERANCE_G г в течение STABLE_DURATION_MS (не точное совпадение).
 */
class CasWeightMonitor {
  constructor() {
    this.host = ''
    this.port = 20304
    this.intervalMs = 180
    this.socket = null
    this.timer = null
    this.busy = false
    this.running = false
    this.onUpdate = null
    this.lastError = ''
    this.connected = false
    this.lastGrams = null
    this.lastEmitKg = null
    this.lastParsed = null
    this.confirming = false
    this.lastStableGrams = null
    this.failCount = 0
    /** @type {{ grams: number, t: number }[]} */
    this.samples = []
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
    this.intervalMs = Math.max(150, Math.min(500, Number(opts.intervalMs) || 180))
    this.running = true
    this.lastError = ''

    if (!same) {
      this.lastGrams = null
      this.lastStableGrams = null
      this.confirming = false
      this.failCount = 0
      this.samples = []
      this.destroySocket()
      await this.ensureSocket()
    }

    try {
      const snap = await this.readOnce()
      this.emit({
        connected: true,
        weightKg: snap.weightKg,
        grams: snap.grams,
        price: snap.price,
        stable: false,
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

  async stop() {
    this.running = false
    this.confirming = false
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
      // не трогаем UI здесь — tick сам переподключит
      try { socket.destroy() } catch { /* ignore */ }
    })
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      // connected оставим true до явного fail — иначе при каждом «качке» веса мигает «нет связи»
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

  async readWeightNow() {
    const socket = await this.ensureSocket()
    const resp = await writeAndReadWeight(socket, 2500)
    const parsed = parseWeightResponse(resp)
    if (!parsed.ok) throw new Error(parsed.error || 'Пустой ответ')
    this.connected = true
    this.lastError = ''
    this.failCount = 0
    this.lastEmitKg = parsed.weightKg
    this.lastParsed = parsed
    return parsed
  }

  async readOnce() {
    const started = Date.now()
    while (this.busy && Date.now() - started < 1500) {
      await sleep(20)
    }
    this.busy = true
    try {
      return await this.readWeightNow()
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
      const parsed = await this.readWeightNow()
      const now = Date.now()
      // Без округления до 5 г — иначе допуск ±2 г бессмысленен
      let grams = Math.round(Number(parsed.grams) || 0)
      if (grams < 0) grams = 0

      this.samples.push({ grams, t: now })
      const cutoff = now - STABLE_BUFFER_MS
      this.samples = this.samples.filter(s => s.t >= cutoff)

      const empty = grams < 1
      let stable = false
      let emitGrams = grams

      if (empty) {
        this.samples = []
        this.lastStableGrams = null
        // Пустая платформа ≠ «стабильный вес» — иначе в UI «стабильно» при 0 г
        stable = false
      } else {
        const ev = evaluateStability(this.samples, now)
        stable = ev.stable
        emitGrams = ev.stable ? ev.grams : grams
        if (stable) this.lastStableGrams = emitGrams
        else this.lastStableGrams = null
      }

      this.lastGrams = emitGrams
      const kg = emitGrams / 1000
      this.lastEmitKg = kg
      this.lastParsed = parsed
      this.failCount = 0
      this.connected = true
      this.emit({
        connected: true,
        weightKg: kg,
        grams: emitGrams,
        price: parsed.price,
        stable,
        error: '',
        raw: parsed.raw,
        display: kg.toFixed(3),
      })
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      this.failCount = (this.failCount || 0) + 1

      const dead = !this.socket || this.socket.destroyed
      if (dead || this.failCount >= 2) {
        try { this.destroySocket() } catch { /* ignore */ }
        await sleep(250)
      } else {
        await sleep(100)
      }
      let back = false
      if (this.running) {
        try {
          await this.ensureSocket()
          back = true
          this.failCount = 0
        } catch { /* remain down */ }
      }

      if (back) {
        this.emit({
          connected: true,
          weightKg: this.lastEmitKg || 0,
          grams: Math.round((this.lastEmitKg || 0) * 1000),
          stable: false,
          error: '',
        })
      } else if (this.failCount >= 3) {
        this.connected = false
        this.emit({
          connected: false,
          weightKg: this.lastEmitKg || 0,
          grams: Math.round((this.lastEmitKg || 0) * 1000),
          stable: false,
          error: 'Нет связи с весами. Проверьте IP и кабель.',
        })
      } else {
        this.emit({
          connected: true,
          weightKg: this.lastEmitKg || 0,
          grams: Math.round((this.lastEmitKg || 0) * 1000),
          stable: false,
          error: '',
        })
      }
    } finally {
      this.busy = false
      const elapsed = Date.now() - tickStarted
      const wait = this.failCount >= 3
        ? 600
        : Math.max(60, this.intervalMs - elapsed)
      this.schedule(wait)
    }
  }
}

const weightMonitor = new CasWeightMonitor()

module.exports = {
  syncCasPlu,
  readLiveWeight,
  parseWeightResponse,
  evaluateStability,
  STABLE_TOLERANCE_G,
  STABLE_DURATION_MS,
  weightMonitor,
  CasWeightMonitor,
}
