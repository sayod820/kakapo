'use strict'

/**
 * После упаковки Electron вставляет иконку через rcedit.
 * Нужно потому что winCodeSign на Windows без прав админа
 * падает на symlink’ах darwin — а без этого шага в exe
 * остаётся стандартная иконка Electron.
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const icoPath = path.join(__dirname, 'build', 'icon.ico')
  if (!fs.existsSync(exePath) || !fs.existsSync(icoPath)) {
    console.warn('[afterPack] нет exe или icon.ico — иконку не ставим')
    return
  }

  const cacheRoot = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign')
  let rcedit = ''
  if (fs.existsSync(cacheRoot)) {
    for (const dir of fs.readdirSync(cacheRoot)) {
      const candidate = path.join(cacheRoot, dir, 'rcedit-x64.exe')
      if (fs.existsSync(candidate)) { rcedit = candidate; break }
    }
  }
  if (!rcedit) {
    console.warn('[afterPack] rcedit-x64.exe не найден — иконку не ставим')
    return
  }

  const res = spawnSync(rcedit, [exePath, '--set-icon', icoPath], { stdio: 'inherit' })
  if (res.status !== 0) {
    console.warn('[afterPack] rcedit не смог поставить иконку, код', res.status)
  } else {
    console.log('[afterPack] иконка KAKAPO вставлена в', exeName)
  }
}
