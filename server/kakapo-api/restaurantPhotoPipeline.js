'use strict'

/**
 * Фото блюд ресторанов:
 * — автоповорот EXIF
 * — уменьшение без обрезки
 * — конвертация в WebP
 * — удаление заменённых/удалённых файлов
 */
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import sharp from 'sharp'
import { DATA_DIR } from './db.js'

const RESTAURANT_UPLOAD_DIR = join(DATA_DIR, 'uploads', 'restaurants')
const MAX_SIDE = 1600
const WEBP_QUALITY = 90

function safePart(value, fallback) {
  const clean = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
  return clean || fallback
}

function publicUrl(fileName) {
  return `/api/kakapo/uploads/restaurants/${fileName}`
}

function fileNameFromUrl(url) {
  if (!url || typeof url !== 'string' || !/\/uploads\/restaurants\//i.test(url)) return null
  const name = basename(String(url).split('?')[0])
  if (!name || name.includes('..') || !name.endsWith('.webp')) return null
  return name
}

export function deleteManagedRestaurantPhoto(url) {
  const name = fileNameFromUrl(url)
  if (!name) return false
  try {
    const full = join(RESTAURANT_UPLOAD_DIR, name)
    if (existsSync(full)) unlinkSync(full)
    return true
  } catch {
    return false
  }
}

export async function processAndSaveRestaurantPhoto(input, opts = {}) {
  mkdirSync(RESTAURANT_UPLOAD_DIR, { recursive: true })
  if (!Buffer.isBuffer(input) || input.length < 32) throw new Error('Пустой файл изображения')
  if (input.length > 200 * 1024 * 1024) throw new Error('Файл слишком большой (макс. 200 МБ)')

  const source = sharp(input, { failOn: 'none', animated: false }).rotate()
  const meta = await source.metadata()
  const srcW = meta.width || MAX_SIDE
  const srcH = meta.height || MAX_SIDE
  const pipeline = Math.max(srcW, srcH) > MAX_SIDE
    ? source.resize({
      width: MAX_SIDE,
      height: MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    : source
  const webp = await pipeline.webp({ quality: WEBP_QUALITY, effort: 5 }).toBuffer()
  const outMeta = await sharp(webp).metadata()
  const hash = createHash('sha1').update(randomBytes(16)).digest('hex').slice(0, 10)
  const fileName = `${safePart(opts.restaurantId, 'restaurant')}-${safePart(opts.dishId, 'dish')}-${hash}.webp`
  writeFileSync(join(RESTAURANT_UPLOAD_DIR, fileName), webp)

  if (opts.replaceUrl) deleteManagedRestaurantPhoto(opts.replaceUrl)

  return {
    url: publicUrl(fileName),
    width: outMeta.width || srcW,
    height: outMeta.height || srcH,
    bytes: webp.length,
  }
}
