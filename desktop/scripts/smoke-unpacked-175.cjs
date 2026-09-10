/**
 * Unpacked-build smoke for KAKAPO Kassa 1.2.175
 * Validates: packaged version, production API URLs, better-sqlite3 ABI, localDb load.
 */
'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawnSync, execFileSync } = require('child_process')
const crypto = require('crypto')

const desktop = path.resolve(__dirname, '..')
const unpacked = path.join(desktop, 'dist', 'win-unpacked')
const resources = path.join(unpacked, 'resources')
const asarApp = path.join(resources, 'app.asar')
const asarUnpackedNm = path.join(resources, 'app.asar.unpacked', 'node_modules')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kakapo-smoke-175-'))
const report = { ok: false, steps: [], tmp }

function pass(name, detail) {
  report.steps.push({ name, ok: true, detail })
  console.log('PASS', name, detail != null ? JSON.stringify(detail).slice(0, 200) : '')
}
function fail(name, err) {
  report.steps.push({ name, ok: false, error: String(err) })
  console.error('FAIL', name, err)
}

try {
  // 1) installer artifacts
  const exe = path.join(desktop, 'dist', 'KAKAPO-Kassa-Setup-1.2.175.exe')
  const blockmap = exe + '.blockmap'
  const ymlPath = path.join(desktop, 'dist', 'latest.yml')
  if (!fs.existsSync(exe)) throw new Error('missing installer')
  if (!fs.existsSync(blockmap)) throw new Error('missing blockmap')
  if (!fs.existsSync(ymlPath)) throw new Error('missing latest.yml')
  const exeSize = fs.statSync(exe).size
  const yml = fs.readFileSync(ymlPath, 'utf8')
  const shaYml = (yml.match(/sha512:\s*(\S+)/) || [])[1]
  const sizeYml = Number((yml.match(/size:\s*(\d+)/) || [])[1])
  const sha = crypto.createHash('sha512').update(fs.readFileSync(exe)).digest('base64')
  if (sha !== shaYml) throw new Error('sha mismatch')
  if (sizeYml !== exeSize) throw new Error('size mismatch')
  if (!/version:\s*1\.2\.175/.test(yml)) throw new Error('yml version')
  pass('artifacts', { exeSize, shaMatch: true })

  // 2) packaged package.json version + files in asar
  const pkgOut = path.join(tmp, 'package.json')
  const localDbOut = path.join(tmp, 'localDb.cjs')
  const preloadOut = path.join(tmp, 'preload.cjs')
  execFileSync('npx', ['--yes', 'asar', 'extract-file', asarApp, 'package.json', pkgOut], {
    cwd: desktop, shell: true, stdio: 'pipe',
  })
  execFileSync('npx', ['--yes', 'asar', 'extract-file', asarApp, 'localDb.cjs', localDbOut], {
    cwd: desktop, shell: true, stdio: 'pipe',
  })
  execFileSync('npx', ['--yes', 'asar', 'extract-file', asarApp, 'preload.cjs', preloadOut], {
    cwd: desktop, shell: true, stdio: 'pipe',
  })
  const pkg = JSON.parse(fs.readFileSync(pkgOut, 'utf8'))
  if (pkg.version !== '1.2.175') throw new Error('packaged version ' + pkg.version)
  pass('asar_package', { version: pkg.version, hasLocalDb: fs.existsSync(localDbOut), hasPreload: fs.existsSync(preloadOut) })

  // 3) UI build-info production URLs
  const buildInfo = JSON.parse(fs.readFileSync(path.join(resources, 'ui', 'build-info.json'), 'utf8'))
  if (buildInfo.backendUrl !== 'https://kakappo.shop/api/kakapo') throw new Error(JSON.stringify(buildInfo))
  if (buildInfo.wsUrl !== 'wss://kakappo.shop') throw new Error(JSON.stringify(buildInfo))
  if (/localhost|127\.0\.0\.1/.test(JSON.stringify(buildInfo))) throw new Error('localhost in build-info')
  pass('production_urls', buildInfo)

  // 4) UI contains atomic sale bridge symbol
  let hit = false
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) walk(p)
      else if (name.endsWith('.js')) {
        const txt = fs.readFileSync(p, 'utf8')
        if (txt.includes('localDbSaleCommit')) hit = true
      }
    }
  }
  walk(path.join(resources, 'ui'))
  if (!hit) throw new Error('localDbSaleCommit not found in UI bundle')
  pass('ui_has_localDbSaleCommit', true)

  // 5) better-sqlite3 .node present
  const nodeFiles = []
  const walkNode = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) walkNode(p)
      else if (name.endsWith('.node')) nodeFiles.push(p)
    }
  }
  walkNode(path.join(asarUnpackedNm, 'better-sqlite3'))
  if (!nodeFiles.length) throw new Error('no better-sqlite3 .node in asarUnpack')
  pass('better_sqlite3_node', nodeFiles.map(p => path.relative(asarUnpackedNm, p)))

  // 6) Load better-sqlite3 under Electron ABI via electron binary
  const electronCli = require('electron')
  const electronScript = path.join(tmp, 'electron-sqlite-smoke.cjs')
  fs.writeFileSync(electronScript, `
    const { app } = require('electron')
    const path = require('path')
    const fs = require('fs')
    const Module = require('module')
    const nm = ${JSON.stringify(asarUnpackedNm)}
    process.env.NODE_PATH = nm + require('path').delimiter + (process.env.NODE_PATH || '')
    Module._initPaths()
    app.whenReady().then(() => {
      const out = { ok: false }
      try {
        const Database = require('better-sqlite3')
        const dbPath = path.join(${JSON.stringify(tmp)}, 'abi.sqlite')
        const db = new Database(dbPath)
        db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES (\\'ok\\');')
        const row = db.prepare('SELECT v FROM t').get()
        db.close()
        out.ok = row && row.v === 'ok'
        out.v = row && row.v
        out.electron = process.versions.electron
        out.modules = process.versions.modules
      } catch (e) {
        out.error = String(e && e.stack || e)
      }
      fs.writeFileSync(path.join(${JSON.stringify(tmp)}, 'abi-report.json'), JSON.stringify(out, null, 2))
      app.exit(out.ok ? 0 : 1)
    })
  `)
  const er = spawnSync(electronCli, [electronScript], {
    cwd: desktop,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env },
  })
  const abiReportPath = path.join(tmp, 'abi-report.json')
  if (!fs.existsSync(abiReportPath)) {
    fail('electron_sqlite_abi', (er.stderr || er.stdout || 'no abi report').slice(-800))
  } else {
    const abi = JSON.parse(fs.readFileSync(abiReportPath, 'utf8'))
    if (!abi.ok) fail('electron_sqlite_abi', abi.error || abi)
    else pass('electron_sqlite_abi', { electron: abi.electron, modules: abi.modules, v: abi.v })
  }

  // 7) localDb source in package contains saleCommit transaction API
  const localDbSrc = fs.readFileSync(localDbOut, 'utf8')
  if (!/saleCommit|runSaleCommit|BEGIN/i.test(localDbSrc)) throw new Error('localDb missing sale commit')
  pass('localDb_has_sale_commit', true)

  report.ok = report.steps.every(s => s.ok)
} catch (e) {
  fail('fatal', e && e.stack || e)
  report.ok = false
}

fs.writeFileSync(path.join(desktop, 'dist', 'smoke-1.2.175-report.json'), JSON.stringify(report, null, 2))
console.log('\nSMOKE', report.ok ? 'PASS' : 'FAIL')
process.exit(report.ok ? 0 : 1)
