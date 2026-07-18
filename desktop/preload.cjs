'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kakapoDesktop', {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke('desktop:getInfo'),
  getPrinters: () => ipcRenderer.invoke('desktop:getPrinters'),
  getPrinterSettings: () => ipcRenderer.invoke('desktop:getPrinterSettings'),
  savePrinterSettings: data => ipcRenderer.invoke('desktop:savePrinterSettings', data),
  getReceiptTemplate: () => ipcRenderer.invoke('desktop:getReceiptTemplate'),
  saveReceiptTemplate: data => ipcRenderer.invoke('desktop:saveReceiptTemplate', data),
  openReceiptEditor: () => ipcRenderer.invoke('desktop:openReceiptEditor'),
  closeReceiptEditor: () => ipcRenderer.invoke('desktop:closeReceiptEditor'),
  printHtml: (html, options) => ipcRenderer.invoke('desktop:printHtml', html, options),
  printReceipt: (payload) => ipcRenderer.invoke('desktop:printReceipt', payload),
  printLabelsBatch: (items, options) => ipcRenderer.invoke('desktop:printLabelsBatch', items, options),
  syncCasPlu: payload => ipcRenderer.invoke('desktop:syncCasPlu', payload),
})
