'use strict'

/**
 * Синхронизация офлайн-интерфейса с сервера.
 *
 * Сайт (https://kakappo.shop/trade) обновляется деплоем Next.
 * Встроенный resources/ui в установщике — старый, пока не выйдет Setup.exe.
 * Этот модуль качает свежий standalone-пакет в userData/ui-cache,
 * чтобы без интернета открывался уже новый UI.
 *
 * Канал: https://kakappo.shop/updates/kassa-ui/latest.json + ui-*.zip
 */

const { execFile } = require('child_process')
const fs = require('fs')
const https = require('https')
const http = require('http')
const path = require('path')
const { URL } = require('url')

const FEED_URL = 'https://kakappo.shop/updates/kassa-ui/latest.json'

let syncInFlight = null

function cacheRoot(userDataPath) {
  return path.join(userDataPath, 'ui-cache')
}

function versionPath(userDataPath) {
  return path.join(cacheRoot(userDataPath), 'version.txt')
}

function readCachedVersion(userDataPath) {
  try {
    return fs.readFileSync(versionPath(userDataPath), 'utf8').trim()
  } catch {
    return ''
  }
}

function uiCacheReady(userDataPath) {
  try {
    return fs.existsSync(path.join(cacheRoot(userDataPath), 'server.js'))
  } catch {
    return false
  }
}

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (err, val) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(val)
    }
    try {
      const u = new URL(url)
      const lib = u.protocol === 'http:' ? http : https
      const req = lib.get(url, { timeout: timeoutMs }, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          fetchJson(res.headers.location, timeoutMs).then(v => done(null, v), done)
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume()
          done(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          try {
            done(null, JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            done(e)
          }
        })
      })
      req.on('error', done)
      req.on('timeout', () => {
        try { req.destroy() } catch { /* ignore */ }
        done(new Error('timeout'))
      })
    } catch (e) {
      done(e)
    }
  })
}

function downloadFile(url, destPath, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const tmp = `${destPath}.part`
    try { fs.mkdirSync(path.dirname(destPath), { recursive: true }) } catch { /* ignore */ }
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }

    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      reject(err)
    }
    const ok = () => {
      if (settled) return
      settled = true
      try {
        fs.renameSync(tmp, destPath)
        resolve(destPath)
      } catch (e) {
        fail(e)
      }
    }

    const get = (target, redirectsLeft) => {
      let u
      try { u = new URL(target) } catch (e) { fail(e); return }
      const lib = u.protocol === 'http:' ? http : https
      const req = lib.get(target, { timeout: timeoutMs }, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) return fail(new Error('too many redirects'))
          get(res.headers.location, redirectsLeft - 1)
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume()
          fail(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const out = fs.createWriteStream(tmp)
        res.pipe(out)
        out.on('finish', () => out.close(ok))
        out.on('error', fail)
        res.on('error', fail)
      })
      req.on('error', fail)
      req.on('timeout', () => {
        try { req.destroy() } catch { /* ignore */ }
        fail(new Error('timeout'))
      })
    }
    get(url, 5)
  })
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

function extractArchive(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true })
    execFile('tar', ['-xf', archivePath, '-C', destDir], { windowsHide: true }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/**
 * Проверяет канал kassa-ui и при новой версии качает zip в userData/ui-cache.
 * @returns {{ updated: boolean, version: string, reason?: string }}
 */
async function syncOfflineUi(userDataPath, { log = () => {} } = {}) {
  if (syncInFlight) return syncInFlight
  syncInFlight = (async () => {
    try {
      const meta = await fetchJson(`${FEED_URL}?_=${Date.now()}`)
      const version = String(meta?.version || meta?.v || '').trim()
      const fileUrl = String(meta?.url || meta?.zip || '').trim()
      if (!version || !fileUrl) {
        return { updated: false, version: '', reason: 'no-feed' }
      }
      const current = readCachedVersion(userDataPath)
      if (current === version && uiCacheReady(userDataPath)) {
        log('ui-sync already current', version)
        return { updated: false, version, reason: 'current' }
      }

      log('ui-sync download', { version, fileUrl })
      const staging = path.join(userDataPath, 'ui-cache-staging')
      const zipPath = path.join(userDataPath, 'ui-cache-download.zip')
      rmrf(staging)
      fs.mkdirSync(staging, { recursive: true })

      await downloadFile(fileUrl, zipPath)
      await extractArchive(zipPath, staging)
      try { fs.unlinkSync(zipPath) } catch { /* ignore */ }

      if (!fs.existsSync(path.join(staging, 'server.js'))) {
        rmrf(staging)
        return { updated: false, version, reason: 'bad-pack' }
      }

      const finalDir = cacheRoot(userDataPath)
      const backup = path.join(userDataPath, 'ui-cache-old')
      rmrf(backup)
      if (fs.existsSync(finalDir)) {
        try { fs.renameSync(finalDir, backup) } catch { rmrf(finalDir) }
      }
      try {
        fs.renameSync(staging, finalDir)
      } catch {
        // fallback copy
        fs.cpSync(staging, finalDir, { recursive: true })
        rmrf(staging)
      }
      rmrf(backup)
      fs.writeFileSync(versionPath(userDataPath), `${version}\n`, 'utf8')
      try {
        const { app } = require('electron')
        const appVer = app && typeof app.getVersion === 'function' ? String(app.getVersion() || '') : ''
        if (appVer) {
          fs.writeFileSync(path.join(finalDir, 'app-version.txt'), `${appVer}\n`, 'utf8')
        }
      } catch { /* ignore */ }
      log('ui-sync ready', version)
      return { updated: true, version }
    } catch (err) {
      log('ui-sync fail', err?.message || String(err))
      return { updated: false, version: '', reason: err?.message || 'error' }
    } finally {
      syncInFlight = null
    }
  })()
  return syncInFlight
}

module.exports = {
  FEED_URL,
  syncOfflineUi,
  readCachedVersion,
  uiCacheReady,
  cacheRoot,
}
