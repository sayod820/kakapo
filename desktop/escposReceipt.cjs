'use strict'

const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c

/**
 * Плотность печати для Xprinter/ESC-POS.
 * GS ( K fn=49 (0x31): m=0..8, где выше = темнее.
 * Фиксируем среднюю плотность — без лишних UI-настроек.
 */
function pushDensity(cmd) {
  const m = 3
  cmd(GS, 0x28, 0x4B, 0x02, 0x00, 0x31, m)
}

/** HTML-растр чека → ESC/POS GS v 0 */
function buildEscPosRaster(mono, opts = {}) {
  const height = Math.max(1, Number(mono?.height) || 0)
  const widthBytes = Math.max(1, Number(mono?.widthBytes) || Math.ceil((Number(mono?.width) || 8) / 8))
  const src = Buffer.isBuffer(mono?.data) ? mono.data : Buffer.alloc(widthBytes * height)
  const xL = widthBytes & 0xff
  const xH = (widthBytes >> 8) & 0xff
  const yL = height & 0xff
  const yH = (height >> 8) & 0xff
  const chunks = []
  const cmd = (...b) => chunks.push(Buffer.from(b))
  cmd(ESC, 0x40)
  cmd(FS, 0x2E)
  pushDensity(cmd)
  cmd(ESC, 0x61, 1)
  // GS v 0 — raster 1:1 под 384 dots @ 203 DPI (58 мм)
  cmd(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH)
  chunks.push(src.subarray(0, widthBytes * height))
  cmd(ESC, 0x61, 0)
  chunks.push(Buffer.from('\n', 'ascii'))
  if (opts.cut !== false) cmd(GS, 0x56, 0x01)
  return Buffer.concat(chunks)
}

module.exports = {
  buildEscPosRaster,
}
