'use strict'

/**
 * Обработка фото товара:
 * — автоповорот по EXIF
 * — удаление фона на сервере (rembg / U^2-Net), если доступно
 * — обрезка полей (прозрачных после rembg, иначе однотонных)
 * — центрирование в квадрате 1200×1200 с полями
 * — WebP высокого качества + миниатюра 400×400
 * — удаление старых файлов uploads
 */

import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import sharp from 'sharp'
import { DATA_DIR } from './db.js'
import { removeBackground, isRembgAvailable } from './removeBg.js'

export const UPLOAD_ROOT = join(DATA_DIR, 'uploads')
export const PRODUCT_UPLOAD_DIR = join(UPLOAD_ROOT, 'products')
export const PRODUCT_PHOTO_SIZE = 1200
export const PRODUCT_THUMB_SIZE = 400
export const PRODUCT_WEBP_QUALITY = 92
export const PRODUCT_THUMB_QUALITY = 86

export function ensureUploadDirs() {
  mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true })
}

function publicUrl(fileName) {
  return `/api/kakapo/uploads/products/${fileName}`
}

function isManagedProductPhotoUrl(url) {
  if (!url || typeof url !== 'string') return false
  return /\/uploads\/products\/[A-Za-z0-9._-]+\.webp(?:\?|$)/i.test(url)
    || /\/api\/kakapo\/uploads\/products\/[A-Za-z0-9._-]+\.webp(?:\?|$)/i.test(url)
}

function fileNameFromUrl(url) {
  try {
    const clean = String(url).split('?')[0]
    const name = basename(clean)
    if (!name || name.includes('..') || !name.endsWith('.webp')) return null
    return name
  } catch {
    return null
  }
}

export function deleteManagedProductPhoto(url) {
  if (!isManagedProductPhotoUrl(url)) return false
  const name = fileNameFromUrl(url)
  if (!name) return false
  const full = join(PRODUCT_UPLOAD_DIR, name)
  try {
    if (existsSync(full)) unlinkSync(full)
    // paired thumb: xxx.webp → xxx-thumb.webp
    const thumb = name.replace(/\.webp$/i, '-thumb.webp')
    const thumbFull = join(PRODUCT_UPLOAD_DIR, thumb)
    if (existsSync(thumbFull)) unlinkSync(thumbFull)
    return true
  } catch {
    return false
  }
}

function makeBaseName(productId) {
  const idPart = productId != null && Number(productId) > 0 ? `p${Number(productId)}` : 'new'
  const hash = createHash('sha1').update(randomBytes(16)).digest('hex').slice(0, 10)
  return `${idPart}-${hash}`
}

/**
 * @param {Buffer} input
 * @param {{ productId?: number, replaceUrl?: string }} [opts]
 */
export async function processAndSaveProductPhoto(input, opts = {}) {
  ensureUploadDirs()
  if (!Buffer.isBuffer(input) || input.length < 32) {
    throw new Error('Пустой файл изображения')
  }
  if (input.length > 200 * 1024 * 1024) {
    throw new Error('Файл слишком большой (макс. 200 МБ)')
  }

  // Нормализуем вход в PNG (с автоповоротом по EXIF) для rembg
  const normalizedPng = await sharp(input, { failOn: 'none', animated: false })
    .rotate()
    .png()
    .toBuffer()

  // Удаление фона на сервере (rembg). Если недоступно — работаем по оригиналу.
  let bgRemoved = false
  let workingBuffer = normalizedPng
  if (opts.removeBg !== false && (await isRembgAvailable())) {
    const cut = await removeBackground(normalizedPng)
    if (cut && cut.length > 64) {
      workingBuffer = cut
      bgRemoved = true
    }
  }

  let pipeline = sharp(workingBuffer, { failOn: 'none', animated: false })

  // После вырезания фона обрезаем прозрачные поля; иначе — однотонные (белый стол/студия)
  try {
    pipeline = bgRemoved
      ? pipeline.trim({ threshold: 0 })
      : pipeline.trim({ background: undefined, threshold: 18, lineArt: false })
  } catch {
    pipeline = sharp(workingBuffer, { failOn: 'none', animated: false })
  }

  const meta = await pipeline.metadata()
  const srcW = meta.width || PRODUCT_PHOTO_SIZE
  const srcH = meta.height || PRODUCT_PHOTO_SIZE

  // Запас ~8% полей вокруг товара
  const padRatio = 0.08
  const inner = Math.round(PRODUCT_PHOTO_SIZE * (1 - padRatio * 2))
  const scale = Math.min(inner / srcW, inner / srcH, 1.35)
  const drawW = Math.max(1, Math.round(srcW * scale))
  const drawH = Math.max(1, Math.round(srcH * scale))

  const resized = await pipeline
    .resize(drawW, drawH, {
      fit: 'inside',
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .png()
    .toBuffer()

  const left = Math.floor((PRODUCT_PHOTO_SIZE - drawW) / 2)
  const top = Math.floor((PRODUCT_PHOTO_SIZE - drawH) / 2)

  const square = await sharp({
    create: {
      width: PRODUCT_PHOTO_SIZE,
      height: PRODUCT_PHOTO_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .webp({ quality: PRODUCT_WEBP_QUALITY, alphaQuality: 100, effort: 5 })
    .toBuffer()

  const thumb = await sharp(square)
    .resize(PRODUCT_THUMB_SIZE, PRODUCT_THUMB_SIZE, { fit: 'inside' })
    .webp({ quality: PRODUCT_THUMB_QUALITY, alphaQuality: 100, effort: 4 })
    .toBuffer()

  const base = makeBaseName(opts.productId)
  const mainName = `${base}.webp`
  const thumbName = `${base}-thumb.webp`
  writeFileSync(join(PRODUCT_UPLOAD_DIR, mainName), square)
  writeFileSync(join(PRODUCT_UPLOAD_DIR, thumbName), thumb)

  // Старое — только после успешной записи нового
  if (opts.replaceUrl) {
    deleteManagedProductPhoto(opts.replaceUrl)
  }

  return {
    url: publicUrl(mainName),
    thumbUrl: publicUrl(thumbName),
    width: PRODUCT_PHOTO_SIZE,
    height: PRODUCT_PHOTO_SIZE,
    bytes: square.length,
    bgRemoved,
  }
}
