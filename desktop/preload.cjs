'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kakapoDesktop', {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke('desktop:getInfo'),
  getPrinters: () => ipcRenderer.invoke('desktop:getPrinters'),
  getPrinterSettings: () => ipcRenderer.invoke('desktop:getPrinterSettings'),
  savePrinterSettings: data => ipcRenderer.invoke('desktop:savePrinterSettings', data),
  printHtml: (html, options) => ipcRenderer.invoke('desktop:printHtml', html, options),
  printReceipt: (payload) => ipcRenderer.invoke('desktop:printReceipt', payload),
  printLabelsBatch: (items, options) => ipcRenderer.invoke('desktop:printLabelsBatch', items, options),
  syncCasPlu: payload => ipcRenderer.invoke('desktop:syncCasPlu', payload),
  startCasWeight: payload => ipcRenderer.invoke('desktop:startCasWeight', payload),
  stopCasWeight: () => ipcRenderer.invoke('desktop:stopCasWeight'),
  readCasWeight: payload => ipcRenderer.invoke('desktop:readCasWeight', payload),
  getCasWeightStatus: () => ipcRenderer.invoke('desktop:getCasWeightStatus'),
  getLocalIpv4: () => ipcRenderer.invoke('desktop:getLocalIpv4'),
  onCasWeight: (handler) => {
    if (typeof handler !== 'function') return () => {}
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('desktop:casWeight', listener)
    return () => {
      ipcRenderer.removeListener('desktop:casWeight', listener)
    }
  },
  getUpdateStatus: () => ipcRenderer.invoke('desktop:getUpdateStatus'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:downloadUpdate'),
  quitAndInstall: () => ipcRenderer.invoke('desktop:quitAndInstall'),
  onUpdateStatus: (handler) => {
    if (typeof handler !== 'function') return () => {}
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('desktop:updateStatus', listener)
    return () => {
      ipcRenderer.removeListener('desktop:updateStatus', listener)
    }
  },
  localDbInfo: () => ipcRenderer.invoke('desktop:localDbInfo'),
  localDbKvGet: (key) => ipcRenderer.invoke('desktop:localDbKvGet', key),
  localDbKvSet: (key, value) => ipcRenderer.invoke('desktop:localDbKvSet', key, value),
  localDbKvDelete: (key) => ipcRenderer.invoke('desktop:localDbKvDelete', key),
  localDbQueueAll: () => ipcRenderer.invoke('desktop:localDbQueueAll'),
  localDbQueuePut: (row) => ipcRenderer.invoke('desktop:localDbQueuePut', row),
  localDbQueueDelete: (clientRef) => ipcRenderer.invoke('desktop:localDbQueueDelete', clientRef),
  localDbMetaGet: () => ipcRenderer.invoke('desktop:localDbMetaGet'),
  localDbMetaPatch: (patch) => ipcRenderer.invoke('desktop:localDbMetaPatch', patch),
  localDbMarkInstalled: () => ipcRenderer.invoke('desktop:localDbMarkInstalled'),
})
