'use strict'
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync, execFileSync } = require('child_process')
const os = require('os')

const desktop = __dirname.includes('scripts') ? path.join(__dirname, '..') : __dirname
const dist = path.join(desktop, 'dist')
const exe = path.join(dist, 'KAKAPO-Kassa-Setup-1.2.175.exe')
const yml = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8')
const buf = fs.readFileSync(exe)
const sha = crypto.createHash('sha512').update(buf).digest('base64')
const shaY = (yml.match(/sha512:\s*(\S+)/) || [])[1]
const sizeY = Number((yml.match(/^\s*size:\s*(\d+)/m) || [])[1])
console.log(JSON.stringify({
  sha_ok: sha === shaY,
  size_ok: buf.length === sizeY,
  size: buf.length,
  version_yml: (yml.match(/version:\s*(\S+)/) || [])[1],
  blockmap: fs.existsSync(exe + '.blockmap'),
  buildInfo: JSON.parse(fs.readFileSync(path.join(desktop, 'ui', 'build-info.json'), 'utf8')),
  pkgVersion: JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version,
}, null, 2))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k175-'))
const asar = path.join(dist, 'win-unpacked', 'resources', 'app.asar')
for (const f of ['package.json', 'localDb.cjs', 'preload.cjs']) {
  execFileSync('npx', ['--yes', 'asar', 'extract-file', asar, f, path.join(tmp, f)], {
    cwd: desktop, shell: true, stdio: 'pipe',
  })
}
const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'))
const localDb = fs.readFileSync(path.join(tmp, 'localDb.cjs'), 'utf8')
console.log('asar_version', pkg.version)
console.log('localDb_saleCommit', /saleCommit|runSaleCommitTransaction|BEGIN IMMEDIATE/i.test(localDb))
console.log('preload_saleCommit', /localDbSaleCommit|saleCommit/i.test(fs.readFileSync(path.join(tmp, 'preload.cjs'), 'utf8')))

const nm = path.join(dist, 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
function findNode(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) findNode(p, acc)
    else if (n.endsWith('.node')) acc.push(p)
  }
  return acc
}
const nodes = findNode(nm)
console.log('sqlite_nodes', nodes.length, nodes.map(p => path.basename(p)))

// Electron ABI smoke
const electronPath = require('electron')
const script = path.join(tmp, 'abi.cjs')
fs.writeFileSync(script, `
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const Module = require('module')
const nm = ${JSON.stringify(path.join(dist, 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules'))}
process.env.NODE_PATH = nm + path.delimiter + (process.env.NODE_PATH || '')
Module._initPaths()
app.whenReady().then(() => {
  let out = { ok: false }
  try {
    const Database = require('better-sqlite3')
    const db = new Database(path.join(${JSON.stringify(tmp)}, 't.sqlite'))
    db.exec("CREATE TABLE t(v TEXT); INSERT INTO t VALUES ('ok')")
    const row = db.prepare('SELECT v FROM t').get()
    db.close()
    out = { ok: row.v === 'ok', electron: process.versions.electron, modules: process.versions.modules }
  } catch (e) { out = { ok: false, error: String(e && e.stack || e) } }
  fs.writeFileSync(path.join(${JSON.stringify(tmp)}, 'abi.json'), JSON.stringify(out))
  app.exit(out.ok ? 0 : 1)
})
`)
const r = spawnSync(electronPath, [script], { cwd: desktop, encoding: 'utf8', timeout: 60000 })
const abiFile = path.join(tmp, 'abi.json')
console.log('electron_status', r.status)
console.log('abi', fs.existsSync(abiFile) ? fs.readFileSync(abiFile, 'utf8') : (r.stderr || r.stdout || '').slice(-500))
process.exit(sha === shaY && pkg.version === '1.2.175' && r.status === 0 ? 0 : 1)
