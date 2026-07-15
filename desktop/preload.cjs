'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kakapoDesktop', {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke('desktop:getInfo'),
  getPrinters: () => ipcRenderer.invoke('desktop:getPrinters'),
  getPrinterSettings: () => ipcRenderer.invoke('desktop:getPrinterSettings'),
  savePrinterSettings: data => ipcRenderer.invoke('desktop:savePrinterSettings', data),
  printHtml: (html, options) => ipcRenderer.invoke('desktop:printHtml', html, options),
  syncCasPlu: payload => ipcRenderer.invoke('desktop:syncCasPlu', payload),
})
