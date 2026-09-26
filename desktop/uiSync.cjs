'use strict'

/**
 * Синхронизация офлайн-интерфейса с сервера.
 *
 * Сайт (https://kakappo.shop/trade) обновляется деплоем Next.
 * Встроенный resources/ui в установщике — актуальный на момент Setup.exe.
 * Этот модуль качает пакет в userData/ui-cache только если он НОВЕЕ
 * встроенного UI (по builtAt), иначе свежий Setup снова «откатывается»
 * к старому zip с канала kassa-ui.
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

/** Дата сборки UI из build-info.json / built-at.txt (ms) или 0. */
function readUiBuiltAtMs(dir) {
  if (!dir) return 0
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8'))
    const iso = info.builtAtIso || info.builtAt
    const t = Date.parse(String(iso || ''))
    if (Number.isFinite(t) && t > 0) return t
  } catch { /* ignore */ }
  try {
    const iso = fs.readFileSync(path.join(dir, 'built-at.txt'), 'utf8').trim()
    const t = Date.parse(iso)
    if (Number.isFinite(t) && t > 0) return t
  } catch { /* ignore */ }
  return 0
}

function findBundledUiDir() {
  const dirs = []
  if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'ui'))
  dirs.push(path.join(__dirname, 'ui'))
  for (const dir of dirs) {
    try {
      if (fs.existsSync(path.join(dir, 'server.js'))) return dir
    } catch { /* ignore */ }
  }
  return ''
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

// Some shop networks drop any HTTP connection after ~60 s, so the zip is fetched
// in short Range chunks and the .part file survives failures and restarts.
const CHUNK_BYTES = 512 * 1024
const CHUNK_IDLE_TIMEOUT_MS = 30000
const MAX_FAILS_IN_ROW = 12

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function fileSize(p) {
  try { return fs.statSync(p).size } catch { return 0 }
}

/**
 * One GET with Range: bytes=start-end; appends body to tmp.
 * Settles only after the write stream is closed, so the next chunk never
 * starts while bytes from this one are still being flushed.
 */
function fetchRange(target, tmp, start, end, expectedSize = 0, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let settled = false
    let out = null
    let result = null
    let error = null
    let resRef = null
    const settle = () => {
      if (settled) return
      settled = true
      if (!error && !result) error = new Error('incomplete chunk')
      if (error) reject(error)
      else resolve(result)
    }
    const done = (err, val) => {
      if (error || result) return
      if (err) error = err
      else result = val
      if (!out) { settle(); return }
      if (err) {
        try { if (resRef) resRef.unpipe(out) } catch { /* ignore */ }
        try { out.end() } catch { /* ignore */ }
      }
    }
    let u
    try { u = new URL(target) } catch (e) { done(e); return }
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.get(target, {
      timeout: CHUNK_IDLE_TIMEOUT_MS,
      headers: { Range: `bytes=${start}-${end}`, 'Cache-Control': 'no-cache' },
    }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirectsLeft <= 0) return done(new Error('too many redirects'))
        fetchRange(new URL(res.headers.location, target).toString(), tmp, start, end, expectedSize, redirectsLeft - 1)
          .then(v => done(null, v), done)
        return
      }
      if (res.statusCode === 416) {
        res.resume()
        done(Object.assign(new Error('HTTP 416'), { code: 'RANGE_416' }))
        return
      }
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        res.resume()
        done(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let total = 0
      let append = true
      if (res.statusCode === 206) {
        const m = /\/(\d+)\s*$/.exec(String(res.headers['content-range'] || ''))
        total = m ? Number(m[1]) : 0
      } else {
        // Server ignored Range: restart the file from zero.
        total = Number(res.headers['content-length']) || 0
        append = false
      }
      if (expectedSize > 0 && total > 0 && total !== expectedSize) {
        res.resume()
        done(Object.assign(new Error(`size mismatch ${total} != ${expectedSize}`), { fatal: true }))
        return
      }
      resRef = res
      out = fs.createWriteStream(tmp, { flags: append ? 'a' : 'w' })
      out.on('close', settle)
      out.on('error', (e) => { done(e); settle() })
      res.on('error', (e) => done(e))
      res.on('aborted', () => done(new Error('aborted')))
      res.on('end', () => {
        if (!res.complete) return
        done(null, { total, full: !append })
      })
      res.pipe(out)
    })
    req.on('error', done)
    req.on('timeout', () => {
      try { req.destroy() } catch { /* ignore */ }
      done(new Error('timeout'))
    })
  })
}

async function downloadFile(url, destPath, { expectedSize = 0, log = () => {} } = {}) {
  const tmp = `${destPath}.part`
  const urlFile = `${destPath}.part-url`
  try { fs.mkdirSync(path.dirname(destPath), { recursive: true }) } catch { /* ignore */ }

  let prevUrl = ''
  try { prevUrl = fs.readFileSync(urlFile, 'utf8').trim() } catch { /* ignore */ }
  if (prevUrl !== url) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    fs.writeFileSync(urlFile, url, 'utf8')
  }

  let total = expectedSize > 0 ? expectedSize : 0
  let failsInRow = 0
  let restartedOn416 = false
  for (;;) {
    const have = fileSize(tmp)
    if (total > 0 && have > total) {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      continue
    }
    if (total > 0 && have === total) break
    const end = have + CHUNK_BYTES - 1
    try {
      const r = await fetchRange(url, tmp, have, total > 0 ? Math.min(end, total - 1) : end, expectedSize)
      if (r.total > 0) {
        if (expectedSize > 0 && r.total !== expectedSize) {
          try { fs.unlinkSync(tmp) } catch { /* ignore */ }
          try { fs.unlinkSync(urlFile) } catch { /* ignore */ }
          throw Object.assign(new Error(`size mismatch ${r.total} != ${expectedSize}`), { fatal: true })
        }
        total = r.total
      }
      if (r.full) {
        if (!total) total = fileSize(tmp)
        break
      }
      failsInRow = 0
    } catch (e) {
      if (e && e.fatal) {
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
        try { fs.unlinkSync(urlFile) } catch { /* ignore */ }
        throw e
      }
      if (e && e.code === 'RANGE_416' && !restartedOn416) {
        restartedOn416 = true
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
        continue
      }
      failsInRow += 1
      log('ui-sync chunk fail', { have: fileSize(tmp), total, fails: failsInRow, err: e?.message || String(e) })
      if (failsInRow >= MAX_FAILS_IN_ROW) throw e
      await sleep(Math.min(30000, 1000 * failsInRow))
    }
  }

  const got = fileSize(tmp)
  if (!got || (total > 0 && got !== total)) {
    throw new Error(`incomplete download ${got}/${total}`)
  }
  try { fs.unlinkSync(destPath) } catch { /* ignore */ }
  fs.renameSync(tmp, destPath)
  try { fs.unlinkSync(urlFile) } catch { /* ignore */ }
  return destPath
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
 * Не подменяет UI из Setup более старым пакетом с сервера.
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

      const remoteBuiltAt = Date.parse(String(meta?.builtAt || meta?.builtAtIso || '')) || 0
      const bundledDir = findBundledUiDir()
      const bundledAt = readUiBuiltAtMs(bundledDir)
      if (bundledAt > 0) {
        if (!remoteBuiltAt) {
          log('ui-sync skip: no remote builtAt, keep bundled', { version, bundledAt })
          return { updated: false, version, reason: 'bundled-newer' }
        }
        if (remoteBuiltAt <= bundledAt) {
          log('ui-sync skip: bundled newer than feed', {
            version,
            remoteBuiltAt: new Date(remoteBuiltAt).toISOString(),
            bundledAt: new Date(bundledAt).toISOString(),
          })
          return { updated: false, version, reason: 'bundled-newer' }
        }
      }

      const current = readCachedVersion(userDataPath)
      const cacheAt = readUiBuiltAtMs(cacheRoot(userDataPath))
      if (current === version && uiCacheReady(userDataPath)) {
        if (!remoteBuiltAt || !cacheAt || cacheAt >= remoteBuiltAt) {
          log('ui-sync already current', version)
          return { updated: false, version, reason: 'current' }
        }
      }

      log('ui-sync download', { version, fileUrl, remoteBuiltAt: remoteBuiltAt || null })
      const staging = path.join(userDataPath, 'ui-cache-staging')
      const zipPath = path.join(userDataPath, 'ui-cache-download.zip')
      rmrf(staging)
      fs.mkdirSync(staging, { recursive: true })

      const expectedSize = Number(meta?.size) > 0 ? Number(meta.size) : 0
      await downloadFile(fileUrl, zipPath, { expectedSize, log })
      try {
        await extractArchive(zipPath, staging)
      } catch (e) {
        try { fs.unlinkSync(zipPath) } catch { /* ignore */ }
        throw e
      }
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
      const builtIso = remoteBuiltAt
        ? new Date(remoteBuiltAt).toISOString()
        : new Date().toISOString()
      try {
        fs.writeFileSync(path.join(finalDir, 'built-at.txt'), `${builtIso}\n`, 'utf8')
      } catch { /* ignore */ }
      try {
        let info = {}
        try {
          info = JSON.parse(fs.readFileSync(path.join(finalDir, 'build-info.json'), 'utf8'))
        } catch { /* ignore */ }
        info.builtAtIso = builtIso
        info.feedVersion = version
        fs.writeFileSync(path.join(finalDir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8')
      } catch { /* ignore */ }
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
  readUiBuiltAtMs,
  findBundledUiDir,
}
