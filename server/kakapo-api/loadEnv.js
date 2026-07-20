'use strict'

import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = join(__dirname, '.env')

/** Читает server/kakapo-api/.env и подставляет переменные в process.env */
export function loadLocalEnv() {
  if (!existsSync(ENV_PATH)) return
  try {
    for (const raw of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const i = line.indexOf('=')
      if (i <= 0) continue
      const key = line.slice(0, i).trim()
      let val = line.slice(i + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!key) continue
      if (key.startsWith('GEMINI_') || process.env[key] == null || process.env[key] === '') {
        process.env[key] = val
      }
    }
  } catch { /* ignore */ }
}

export function getGeminiApiKey() {
  loadLocalEnv()
  return String(process.env.GEMINI_API_KEY || '').trim()
}

export function getGeminiModel() {
  loadLocalEnv()
  return String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim()
}
