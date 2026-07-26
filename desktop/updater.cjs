'use strict'

/**
 * Автообновление KAKAPO Касса (electron-updater + generic provider).
 * Канал: https://kakappo.shop/updates/kassa
 */

const { app, ipcMain } = require('electron')

const UPDATE_FEED_URL = 'https://kakappo.shop/updates/kassa'

/** @type {import('electron').BrowserWindow | null} */
let targetWindow = null
let lastStatus = {
  state: 'idle',
  currentVersion: '',
  availableVersion: '',
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
  error: '',
  message: '',
}

function broadcast(payload) {
  lastStatus = { ...lastStatus, ...payload, currentVersion: app.getVersion() }
  const win = targetWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send('desktop:updateStatus', lastStatus)
  }
  return lastStatus
}

function getAutoUpdater() {
  // require лениво — в unpackaged/dev пакет может вести себя иначе
  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL })
  } catch { /* publish из package.json */ }
  return autoUpdater
}

function installUpdaterIpc(getMainWindow) {
  targetWindow = typeof getMainWindow === 'function' ? getMainWindow() : getMainWindow
  lastStatus.currentVersion = app.getVersion()

  const autoUpdater = getAutoUpdater()

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking', error: '', message: 'Проверка обновлений…' })
  })

  autoUpdater.on('update-available', info => {
    broadcast({
      state: 'available',
      availableVersion: String(info?.version || ''),
      error: '',
      message: `Доступна версия ${info?.version || ''}`,
    })
  })

  autoUpdater.on('update-not-available', info => {
    broadcast({
      state: 'not-available',
      availableVersion: String(info?.version || app.getVersion()),
      error: '',
      message: 'У вас актуальная версия',
    })
  })

  autoUpdater.on('download-progress', progress => {
    broadcast({
      state: 'downloading',
      percent: Number(progress?.percent) || 0,
      bytesPerSecond: Number(progress?.bytesPerSecond) || 0,
      transferred: Number(progress?.transferred) || 0,
      total: Number(progress?.total) || 0,
      error: '',
      message: 'Скачивание…',
    })
  })

  autoUpdater.on('update-downloaded', info => {
    broadcast({
      state: 'downloaded',
      availableVersion: String(info?.version || lastStatus.availableVersion || ''),
      percent: 100,
      error: '',
      message: 'Готово к установке',
    })
  })

  autoUpdater.on('error', err => {
    const msg = err instanceof Error ? err.message : String(err || 'Ошибка обновления')
    broadcast({
      state: 'error',
      error: msg,
      message: msg,
    })
  })

  ipcMain.handle('desktop:getUpdateStatus', () => {
    targetWindow = typeof getMainWindow === 'function' ? getMainWindow() : targetWindow
    return { ...lastStatus, currentVersion: app.getVersion() }
  })

  ipcMain.handle('desktop:checkForUpdates', async () => {
    targetWindow = typeof getMainWindow === 'function' ? getMainWindow() : targetWindow
    if (!app.isPackaged) {
      return broadcast({
        state: 'error',
        error: 'Обновления доступны только в установленной программе',
        message: 'Обновления доступны только в установленной программе',
      })
    }
    try {
      broadcast({ state: 'checking', error: '', message: 'Проверка обновлений…' })
      const result = await autoUpdater.checkForUpdates()
      return { ...lastStatus, updateInfo: result?.updateInfo || null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return broadcast({ state: 'error', error: msg, message: msg })
    }
  })

  ipcMain.handle('desktop:downloadUpdate', async () => {
    targetWindow = typeof getMainWindow === 'function' ? getMainWindow() : targetWindow
    if (!app.isPackaged) {
      return broadcast({
        state: 'error',
        error: 'Обновления доступны только в установленной программе',
        message: 'Обновления доступны только в установленной программе',
      })
    }
    try {
      broadcast({ state: 'downloading', percent: 0, error: '', message: 'Скачивание…' })
      await autoUpdater.downloadUpdate()
      return lastStatus
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return broadcast({ state: 'error', error: msg, message: msg })
    }
  })

  ipcMain.handle('desktop:quitAndInstall', () => {
    if (!app.isPackaged) {
      return { ok: false, error: 'Только в установленной программе' }
    }
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true)
      } catch (e) {
        console.error('[updater] quitAndInstall', e)
      }
    })
    return { ok: true }
  })
}

module.exports = {
  UPDATE_FEED_URL,
  installUpdaterIpc,
  getUpdateStatus: () => ({ ...lastStatus, currentVersion: app.getVersion() }),
}
