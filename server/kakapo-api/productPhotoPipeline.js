'use strict'

/**
 * Обработка фото товара:
 * — автоповорот по EXIF
 * — конвертация в WebP (без обрезки фона и без кадрирования)
 * — миниатюра 400×400 для списков
 * — удаление старых файлов uploads
 */

import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import sharp from 'sharp'
import { DATA_DIR } from './db.js'

export const UPLOAD_ROOT = join(DATA_DIR, 'uploads')
export const PRODUCT_UPLOAD_DIR = join(UPLOAD_ROOT, 'products')
/** Макс. длинная сторона основного фото (только уменьшение, без кадрирования) */
export const PRODUCT_PHOTO_MAX_SIDE = 1600
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

  const rotated = sharp(input, { failOn: 'none', animated: false }).rotate()
  const meta = await rotated.metadata()
  const srcW = meta.width || PRODUCT_PHOTO_MAX_SIDE
  const srcH = meta.height || PRODUCT_PHOTO_MAX_SIDE

  // Только уменьшение, если фото больше лимита — пропорции сохраняем, без обрезки
  const needsDownscale = Math.max(srcW, srcH) > PRODUCT_PHOTO_MAX_SIDE
  let mainPipeline = rotated
  if (needsDownscale) {
    mainPipeline = rotated.resize({
      width: PRODUCT_PHOTO_MAX_SIDE,
      height: PRODUCT_PHOTO_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
  }

  const webp = await mainPipeline
    .webp({ quality: PRODUCT_WEBP_QUALITY, effort: 5 })
    .toBuffer()

  const outMeta = await sharp(webp).metadata()

  const thumb = await sharp(webp)
    .resize(PRODUCT_THUMB_SIZE, PRODUCT_THUMB_SIZE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: PRODUCT_THUMB_QUALITY, effort: 4 })
    .toBuffer()

  const base = makeBaseName(opts.productId)
  const mainName = `${base}.webp`
  const thumbName = `${base}-thumb.webp`
  writeFileSync(join(PRODUCT_UPLOAD_DIR, mainName), webp)
  writeFileSync(join(PRODUCT_UPLOAD_DIR, thumbName), thumb)

  if (opts.replaceUrl) {
    deleteManagedProductPhoto(opts.replaceUrl)
  }

  return {
    url: publicUrl(mainName),
    thumbUrl: publicUrl(thumbName),
    width: outMeta.width || srcW,
    height: outMeta.height || srcH,
    bytes: webp.length,
  }
}
