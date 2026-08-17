'use strict'

/**
 * Обработка фото товара:
 * — автоповорот по EXIF
 * — конвертация в WebP (без обрезки фона и без кадрирования)
 * — миниатюра 400×400 для списков
 * — удаление старых файлов uploads
 */

import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import sharp from 'sharp'
import { DATA_DIR } from './db.js'

export const UPLOAD_ROOT = join(DATA_DIR, 'uploads')
export const PRODUCT_UPLOAD_DIR = join(UPLOAD_ROOT, 'products')
/** Макс. длинная сторона основного фото (только уменьшение, без кадрирования) */
export const PRODUCT_PHOTO_MAX_SIDE = 1400
export const PRODUCT_THUMB_SIZE = 400
export const PRODUCT_WEBP_QUALITY = 78
export const PRODUCT_THUMB_QUALITY = 70

export function ensureUploadDirs() {
  mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true })
}

function publicUrl(fileName) {
  return `/api/kakapo/uploads/products/${fileName}`
}

function isConvertedWebpUrl(url) {
  if (!url || typeof url !== 'string') return false
  return /\/uploads\/products\/[A-Za-z0-9._-]+\.webp(?:\?|$)/i.test(url)
    || /\/api\/kakapo\/uploads\/products\/[A-Za-z0-9._-]+\.webp(?:\?|$)/i.test(url)
}

function isManagedProductPhotoUrl(url) {
  return isConvertedWebpUrl(url)
}

function uploadFileName(url) {
  const name = basename(String(url || '').split('?')[0])
  if (!name || name.includes('..')) return null
  if (!/^[A-Za-z0-9._-]+\.(webp|jpe?g|png|gif|bmp|heic|heif|tiff?)$/i.test(name)) return null
  return name
}

function unlinkQuiet(full) {
  try {
    if (full && existsSync(full)) unlinkSync(full)
  } catch { /* ignore */ }
}

function deleteCompanionThumbs(fileName) {
  const stem = String(fileName || '').replace(/\.[^.]+$/i, '')
  if (!stem) return
  for (const extra of ['-thumb.webp', '-thumb.jpg', '-thumb.jpeg', '-thumb.png']) {
    unlinkQuiet(join(PRODUCT_UPLOAD_DIR, `${stem}${extra}`))
  }
}

/** Удаляет файл фото на диске (JPEG/PNG/WebP) и его миниатюру */
export function deleteProductPhotoFiles(url) {
  const name = uploadFileName(url)
  if (!name) return false
  unlinkQuiet(join(PRODUCT_UPLOAD_DIR, name))
  deleteCompanionThumbs(name)
  return true
}

export function deleteManagedProductPhoto(url) {
  return deleteProductPhotoFiles(url)
}

function makeBaseName(productId) {
  const idPart = productId != null && Number(productId) > 0 ? `p${Number(productId)}` : 'new'
  const hash = createHash('sha1').update(randomBytes(16)).digest('hex').slice(0, 10)
  return `${idPart}-${hash}`
}

/**
 * @param {Buffer} input
 * @param {{ productId?: number, replaceUrl?: string, replaceThumbUrl?: string }} [opts]
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

  if (opts.replaceUrl && opts.replaceUrl !== publicUrl(mainName)) {
    deleteProductPhotoFiles(opts.replaceUrl)
  }
  if (opts.replaceThumbUrl && opts.replaceThumbUrl !== publicUrl(thumbName)) {
    deleteProductPhotoFiles(opts.replaceThumbUrl)
  }

  return {
    url: publicUrl(mainName),
    thumbUrl: publicUrl(thumbName),
    width: outMeta.width || srcW,
    height: outMeta.height || srcH,
    bytes: webp.length,
  }
}

function isDataPhoto(url) {
  return /^data:image\//i.test(String(url || ''))
}

function bufferFromDataUrl(url) {
  const m = String(url || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/i)
  if (!m) return null
  try {
    const buf = Buffer.from(m[1].replace(/\s/g, ''), 'base64')
    return buf.length > 32 ? buf : null
  } catch {
    return null
  }
}

function localProductFile(url) {
  const name = uploadFileName(url)
  if (!name) return null
  const full = join(PRODUCT_UPLOAD_DIR, name)
  return existsSync(full) ? full : null
}

export function stripHeavyPhotoFields(product) {
  if (!product || typeof product !== 'object') return product
  const next = { ...product }
  if (isDataPhoto(next.photo)) next.photo = null
  if (isDataPhoto(next.photoThumb)) next.photoThumb = null
  return next
}

export function productPhotoNeedsConvert(product) {
  const photo = String(product?.photo || '').trim()
  const thumb = String(product?.photoThumb || '').trim()
  if (!photo) return false
  if (isDataPhoto(photo) || isDataPhoto(thumb)) return true
  if (!isManagedProductPhotoUrl(photo)) return true
  if (!isManagedProductPhotoUrl(thumb)) return true
  if (!localProductFile(photo)) return true
  if (!localProductFile(thumb)) return true
  return false
}

async function writeThumbFromMain(mainPath, productId) {
  const thumb = await sharp(mainPath, { failOn: 'none' })
    .rotate()
    .resize(PRODUCT_THUMB_SIZE, PRODUCT_THUMB_SIZE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: PRODUCT_THUMB_QUALITY, effort: 4 })
    .toBuffer()
  const mainName = basename(mainPath)
  const thumbName = mainName.replace(/\.webp$/i, '-thumb.webp')
  if (thumbName === mainName) {
    const base = makeBaseName(productId)
    const newThumb = `${base}-thumb.webp`
    writeFileSync(join(PRODUCT_UPLOAD_DIR, newThumb), thumb)
    return publicUrl(newThumb)
  }
  writeFileSync(join(PRODUCT_UPLOAD_DIR, thumbName), thumb)
  return publicUrl(thumbName)
}

/**
 * Старое JPEG/PNG/base64 → WebP + миниатюра. Уже готовые WebP не трогаем.
 * @returns {Promise<boolean>} true если запись товара изменилась
 */
export async function convertStoredProductPhoto(product) {
  if (!product || typeof product !== 'object') return false
  const photo = String(product.photo || '').trim()
  const thumb = String(product.photoThumb || '').trim()
  if (!photo) return false
  if (!productPhotoNeedsConvert(product)) return false

  const mainFile = localProductFile(photo)
  if (
    mainFile
    && isConvertedWebpUrl(photo)
    && (!thumb || !isConvertedWebpUrl(thumb) || !localProductFile(thumb))
  ) {
    const oldThumb = thumb
    product.photoThumb = await writeThumbFromMain(mainFile, product.id)
    if (oldThumb && oldThumb !== product.photoThumb) deleteProductPhotoFiles(oldThumb)
    return true
  }

  let input = null
  if (isDataPhoto(photo)) input = bufferFromDataUrl(photo)
  else if (mainFile) input = readFileSync(mainFile)
  if (!input) return false

  const result = await processAndSaveProductPhoto(input, { productId: product.id })
  product.photo = result.url
  product.photoThumb = result.thumbUrl
  if (photo && photo !== result.url) deleteProductPhotoFiles(photo)
  if (thumb && thumb !== result.thumbUrl && thumb !== photo) deleteProductPhotoFiles(thumb)
  return true
}

export async function migrateProductPhotos(products, { persist, onConverted } = {}) {
  let converted = 0
  let failed = 0
  let skipped = 0
  for (const p of products || []) {
    if (!productPhotoNeedsConvert(p)) {
      skipped++
      continue
    }
    try {
      const ok = await convertStoredProductPhoto(p)
      if (ok) {
        converted++
        persist?.()
        onConverted?.(p)
      } else {
        skipped++
      }
    } catch (e) {
      failed++
      console.warn('[photos] не удалось конвертировать товар', p?.id, e?.message || e)
    }
  }
  return { converted, failed, skipped }
}
