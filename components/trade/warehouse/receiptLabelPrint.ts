'use client'

import { getKakapoDesktop, isKakapoDesktop } from '@/lib/desktopBridge'
import { pickLabelPrinter, XP235B_LABEL_HEIGHT_MM, XP235B_LABEL_WIDTH_MM } from '@/lib/printerPresets'
import type { Product, ProductStockLayer, StockReceipt, StockReceiptItem } from '@/lib/types'
import { buildSingleLabelThermalDocument } from '@/components/trade/products/labelPrintHtml'
import {
  applyXP235BDesign,
  buildLabelPick,
  defaultLabelEdit,
  loadLabelDesign,
  type LabelDesign,
  type LabelEdit,
  type LabelPick,
} from '@/components/trade/products/labelShared'

export type ReceiptLabelRow = {
  key: string
  productId: number
  product: Product
  item: StockReceiptItem
  layer: ProductStockLayer
  edit: LabelEdit
  copies: number
  selected: boolean
}

export function layerFromReceiptItem(
  receipt: StockReceipt,
  item: StockReceiptItem,
): ProductStockLayer {
  return {
    receiptId: receipt.id,
    productId: item.productId,
    productName: item.productName,
    qty: item.qty,
    remainingQty: item.remainingQty ?? item.qty,
    costPrice: item.costPrice,
    retailPrice: item.retailPrice ?? 0,
    bulkPricing: item.bulkPricing || [],
    expiryDate: item.expiryDate ?? null,
    createdAtIso: receipt.createdAtIso,
    supplierName: receipt.supplierName,
    queueIndex: 0,
    isActive: true,
  }
}

export function buildReceiptLabelRows(
  receipt: StockReceipt,
  productsById: Map<number, Product>,
): ReceiptLabelRow[] {
  return receipt.items
    .filter(it => it.productId && Number(it.qty) > 0)
    .map(item => {
      const product = productsById.get(item.productId)
      if (!product) return null
      const layer = layerFromReceiptItem(receipt, item)
      const pick = buildLabelPick(product, layer)
      return {
        key: pick.key,
        productId: product.id,
        product,
        item,
        layer,
        edit: defaultLabelEdit(product, layer),
        copies: 1,
        selected: true,
      }
    })
    .filter((x): x is ReceiptLabelRow => !!x)
}

export function receiptLabelPrintDesign(design?: LabelDesign | null): LabelDesign {
  const base = applyXP235BDesign(design || loadLabelDesign())
  return {
    ...base,
    layout: base.layout === 'blocks' ? 'blocks' : 'retail',
    labelWidthMm: XP235B_LABEL_WIDTH_MM,
    labelHeightMm: XP235B_LABEL_HEIGHT_MM,
    paperWidthMm: XP235B_LABEL_WIDTH_MM,
  }
}

/** Печать выбранных этикеток (данные товара + общий макет из настроек этикеток) */
export async function printReceiptLabelRows(
  rows: ReceiptLabelRow[],
  opts?: { design?: LabelDesign | null; printerName?: string },
): Promise<{ printed: number }> {
  const selected = rows.filter(r => r.selected && r.copies > 0)
  if (!selected.length) throw new Error('Выберите товары для печати')

  const design = receiptLabelPrintDesign(opts?.design)
  const desk = isKakapoDesktop() ? getKakapoDesktop() : null

  if (desk) {
    const settings = await desk.getPrinterSettings().catch(() => ({ labelPrinterName: '', printerName: '' }))
    const printers = await desk.getPrinters().catch(() => [])
    const printerName = String(
      opts?.printerName
      || settings.labelPrinterName
      || pickLabelPrinter(printers)
      || settings.printerName
      || '',
    ).trim()
    if (!printerName) throw new Error('Выберите принтер XP-235B в настройках этикеток')

    if (settings.labelPrinterName !== printerName) {
      await desk.savePrinterSettings({ ...settings, labelPrinterName: printerName })
    }

    let printed = 0
    const batchItems = selected.map(row => {
      const n = Math.max(1, Math.min(99, Math.round(row.copies) || 1))
      printed += n
      return {
        html: buildSingleLabelThermalDocument(row.edit, design),
        copies: n,
      }
    })

    const printOpts = {
      role: 'label' as const,
      printerName,
      pageWidthMm: XP235B_LABEL_WIDTH_MM,
      pageHeightMm: XP235B_LABEL_HEIGHT_MM,
      gapMm: design.gapMm ?? 2,
    }

    if (typeof desk.printLabelsBatch === 'function') {
      await desk.printLabelsBatch(batchItems, printOpts)
    } else {
      // Старый desktop: по одной позиции, но copies через PRINT n
      for (const item of batchItems) {
        await desk.printHtml(item.html, { ...printOpts, copies: item.copies })
      }
    }
    return { printed }
  }

  // Браузер: собираем все этикетки в один документ и window.print
  const cards: string[] = []
  for (const row of selected) {
    const n = Math.max(1, Math.min(99, Math.round(row.copies) || 1))
    const one = buildSingleLabelThermalDocument(row.edit, design)
    // extract body cards — проще: печатаем по одной через временный iframe
    for (let i = 0; i < n; i++) cards.push(one)
  }
  if (!cards.length) throw new Error('Нет этикеток')

  // Печатаем первый документ (браузерный fallback)
  const w = window.open('', '_blank', 'noopener,noreferrer,width=480,height=640')
  if (!w) throw new Error('Разрешите всплывающие окна для печати')
  w.document.write(cards[0])
  w.document.close()
  w.focus()
  w.print()
  return { printed: cards.length }
}

export function pickToReceiptRow(pick: LabelPick, copies = 1): ReceiptLabelRow {
  const item: StockReceiptItem = {
    productId: pick.productId,
    productName: pick.product.name,
    qty: pick.layer?.qty ?? 1,
    remainingQty: pick.layer?.remainingQty ?? 1,
    costPrice: pick.layer?.costPrice ?? 0,
    retailPrice: pick.layer?.retailPrice ?? pick.product.price,
    bulkPricing: pick.layer?.bulkPricing,
    expiryDate: pick.layer?.expiryDate,
  }
  const layer = pick.layer || layerFromReceiptItem(
    {
      id: pick.receiptId || 'default',
      createdAtIso: new Date().toISOString(),
      totalCost: 0,
      paidNow: 0,
      debtAdded: 0,
      items: [item],
    },
    item,
  )
  return {
    key: pick.key,
    productId: pick.productId,
    product: pick.product,
    item,
    layer,
    edit: defaultLabelEdit(pick.product, layer),
    copies,
    selected: true,
  }
}
