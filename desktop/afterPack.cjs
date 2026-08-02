'use strict'

/**
 * Ставит иконку KAKAPO в exe через rcedit.
 * После правки exe отключаем asar-integrity fuse — иначе Electron
 * падает при старте (хеш уже не совпадает).
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

function findRcedit() {
  const cacheRoot = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign')
  if (!fs.existsSync(cacheRoot)) return ''
  for (const dir of fs.readdirSync(cacheRoot)) {
    const candidate = path.join(cacheRoot, dir, 'rcedit-x64.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return ''
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const icoPath = path.join(__dirname, 'build', 'icon.ico')
  if (!fs.existsSync(exePath) || !fs.existsSync(icoPath)) {
    console.warn('[afterPack] нет exe или icon.ico — иконку не ставим')
    return
  }

  const rcedit = findRcedit()
  if (!rcedit) {
    console.warn('[afterPack] rcedit-x64.exe не найден — иконку не ставим')
    return
  }

  const res = spawnSync(rcedit, [exePath, '--set-icon', icoPath], { stdio: 'inherit' })
  if (res.status !== 0) {
    console.warn('[afterPack] rcedit не смог поставить иконку, код', res.status)
    return
  }
  console.log('[afterPack] иконка KAKAPO вставлена в', exeName)

  // Иначе после rcedit приложение не запускается (integrity mismatch)
  try {
    const fusesPath = require.resolve('@electron/fuses')
    const { flipFuses, FuseVersion, FuseV1Options } = require(fusesPath)
    await flipFuses(exePath, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    })
    console.log('[afterPack] asar integrity отключён (чтобы иконка не ломала запуск)')
  } catch (e) {
    console.warn('[afterPack] не удалось отключить integrity fuse:', e?.message || e)
  }
}
