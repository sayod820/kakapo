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
  onCasWeight: (handler) => {
    if (typeof handler !== 'function') return () => {}
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('desktop:casWeight', listener)
    return () => {
      ipcRenderer.removeListener('desktop:casWeight', listener)
    }
  },
})
