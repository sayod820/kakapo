/**
 * READ-ONLY production repair report: today's sales attached to closed shifts.
 * Does NOT mutate server/local data.
 * Run: node scripts/shift-sale-repair-report.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://kakappo.shop/api/kakapo'
const root = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const [shiftsRes, salesRes] = await Promise.all([
    fetch(`${API}/pos/shifts`),
    fetch(`${API}/pos/sales`),
  ])
  const shifts = await shiftsRes.json()
  const sales = await salesRes.json()
  const shiftById = new Map((Array.isArray(shifts) ? shifts : []).map(s => [String(s.id), s]))

  // Local calendar day 2026-09-11 in UTC+5
  const todayStart = new Date('2026-09-11T00:00:00+05:00').toISOString()
  const tomorrowStart = new Date('2026-09-12T00:00:00+05:00').toISOString()

  const openShifts = (Array.isArray(shifts) ? shifts : []).filter(s => String(s.status) === 'open')
  const preferOpen = openShifts.find(s => String(s.posId) === 'POS-DEFAULT') || openShifts[0]

  const todaySales = (Array.isArray(sales) ? sales : []).filter(s => {
    const t = String(s.createdAtIso || '')
    return t >= todayStart && t < tomorrowStart
  })

  const rows = []
  for (const sale of todaySales) {
    const shiftId = String(sale.shiftId || '')
    const sh = shiftById.get(shiftId)
    const status = String(sh?.status || 'MISSING')
    const onOpen = !!(sh && status === 'open')
    let candidate = ''
    let reason = ''
    let classification = 'DO_NOT_TOUCH'

    if (onOpen) {
      reason = 'already on open shift'
      classification = 'DO_NOT_TOUCH'
    } else if (
      preferOpen
      && String(sale.posId || preferOpen.posId || '') === String(preferOpen.posId || '')
      && String(sale.cashierId || preferOpen.cashierId || '') === String(preferOpen.cashierId || '')
    ) {
      candidate = String(preferOpen.id)
      reason = 'same POS+cashier as current open server shift; created today while that open shift exists'
      classification = 'SAFE_TO_REMAP'
    } else if (preferOpen && String(sale.posId || '') === String(preferOpen.posId || '')) {
      candidate = String(preferOpen.id)
      reason = 'same POS as open shift; cashier mismatch or missing — verify manually'
      classification = 'AMBIGUOUS'
    } else {
      reason = 'no clear open-shift candidate'
      classification = 'AMBIGUOUS'
    }

    rows.push({
      saleId: sale.id,
      clientRef: sale.clientRef || '',
      currentShiftId: shiftId,
      currentShiftStatus: status,
      currentShiftOpenedAt: sh?.openedAtIso || null,
      currentShiftClosedAt: sh?.closedAtIso || null,
      createdAt: sale.createdAtIso,
      posId: sale.posId || '',
      cashierId: sale.cashierId || '',
      total: sale.total,
      candidateCorrectShiftId: candidate,
      reason,
      classification,
    })
  }

  const report = {
    generatedAtIso: new Date().toISOString(),
    mode: 'READ_ONLY',
    todayLocal: '2026-09-11',
    openShifts: openShifts.map(s => ({
      id: s.id,
      posId: s.posId,
      cashierId: s.cashierId,
      openedAtIso: s.openedAtIso,
      salesCount: s.salesCount,
    })),
    todaySalesTotal: todaySales.length,
    SAFE_TO_REMAP: rows.filter(r => r.classification === 'SAFE_TO_REMAP'),
    AMBIGUOUS: rows.filter(r => r.classification === 'AMBIGUOUS'),
    DO_NOT_TOUCH: rows.filter(r => r.classification === 'DO_NOT_TOUCH'),
    counts: {
      SAFE_TO_REMAP: rows.filter(r => r.classification === 'SAFE_TO_REMAP').length,
      AMBIGUOUS: rows.filter(r => r.classification === 'AMBIGUOUS').length,
      DO_NOT_TOUCH: rows.filter(r => r.classification === 'DO_NOT_TOUCH').length,
    },
    notes: [
      'Projection/reference repair only — do not replay stock/finance/loyalty/debt.',
      'Do not execute remap until explicitly approved.',
    ],
  }

  const out = path.join(root, 'shift-sale-repair-report.json')
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('Wrote', out)
  console.log('COUNTS', report.counts)
  console.log('OPEN', report.openShifts)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
