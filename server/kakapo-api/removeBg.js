'use strict'

/**
 * Удаление фона фото товара через rembg (Python, модель U^2-Net / IS-Net).
 * Node вызывает rembg как подпроцесс: PNG на вход (stdin) → PNG с альфой (stdout).
 * Если rembg не установлен (например, локальная разработка на Windows) —
 * возвращаем null, и пайплайн просто обрежет однотонные поля.
 */

import { spawn } from 'child_process'

const REMBG_BIN = process.env.REMBG_BIN || 'rembg'
const REMBG_MODEL = process.env.REMBG_MODEL || 'isnet-general-use'
const REMBG_TIMEOUT_MS = Number(process.env.REMBG_TIMEOUT_MS || 60_000)

let cachedAvailable = null

/** Однократная проверка, что бинарь rembg существует. */
export function isRembgAvailable() {
  if (cachedAvailable !== null) return Promise.resolve(cachedAvailable)
  return new Promise(resolve => {
    let done = false
    const finish = ok => {
      if (done) return
      done = true
      cachedAvailable = ok
      resolve(ok)
    }
    try {
      const proc = spawn(REMBG_BIN, ['--help'], { stdio: 'ignore' })
      proc.on('error', () => finish(false))
      proc.on('close', () => finish(true))
      setTimeout(() => {
        try { proc.kill() } catch {}
        finish(false)
      }, 8000)
    } catch {
      finish(false)
    }
  })
}

/**
 * @param {Buffer} pngInput  PNG-буфер (лучше подавать уже как PNG)
 * @returns {Promise<Buffer|null>}  PNG с прозрачным фоном или null при ошибке
 */
export function removeBackground(pngInput) {
  return new Promise(resolve => {
    let settled = false
    const done = val => {
      if (settled) return
      settled = true
      resolve(val)
    }

    let proc
    try {
      proc = spawn(REMBG_BIN, ['i', '-m', REMBG_MODEL, '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      return done(null)
    }

    const chunks = []
    const errChunks = []

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      done(null)
    }, REMBG_TIMEOUT_MS)

    proc.stdout.on('data', d => chunks.push(d))
    proc.stderr.on('data', d => errChunks.push(d))
    proc.on('error', () => {
      clearTimeout(timer)
      done(null)
    })
    proc.on('close', code => {
      clearTimeout(timer)
      const out = Buffer.concat(chunks)
      if (code === 0 && out.length > 64) {
        done(out)
      } else {
        done(null)
      }
    })

    proc.stdin.on('error', () => {})
    proc.stdin.write(pngInput)
    proc.stdin.end()
  })
}
