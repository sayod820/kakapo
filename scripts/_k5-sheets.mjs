import fs from 'node:fs'

const F = 'components/store/StoreApp.tsx'
let s = fs.readFileSync(F, 'utf8')
const EOL = s.includes('\r\n') ? '\r\n' : '\n'
const j = a => a.join(EOL)

const reps = [
  // 1) DebtBottomSheet + 2) PublicReviewsSheet (идентичная разметка)
  [j([
    "    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>",
    "      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(23,37,27,.55)', backdropFilter: 'blur(8px)' }} />",
  ]),
  j([
    '    <div className="store-sheet-backdrop" style={{ zIndex: 300 }} onClick={onClose}>',
    '      <div className="store-sheet" onClick={e => e.stopPropagation()} style={{ padding: "20px 20px calc(36px + env(safe-area-inset-bottom, 0px))" }}>',
  ])],
  // 3) Address add sheet
  [j([
    "        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>",
    "          <div onClick={resetForm} style={{ position: 'absolute', inset: 0, background: 'rgba(23,37,27,.55)', backdropFilter: 'blur(8px)' }} />",
  ]),
  j([
    '        <div className="store-sheet-backdrop" style={{ zIndex: 300 }} onClick={resetForm}>',
    '          <div className="store-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: "92vh", overflowX: "hidden", boxSizing: "border-box", padding: "20px 16px calc(40px + env(safe-area-inset-bottom, 0px))" }}>',
  ])],
  // 4) OrderReviewModal
  [j([
    '    <div style={{ position:"fixed", inset:0, zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>',
    '      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(23,37,27,.55)", backdropFilter:"blur(8px)" }}/>',
  ]),
  j([
    '    <div className="store-sheet-backdrop" style={{ zIndex: 300 }} onClick={onClose}>',
    '      <div className="store-sheet" onClick={e => e.stopPropagation()} style={{ padding: "20px 20px calc(36px + env(safe-area-inset-bottom, 0px))" }}>',
  ])],
]

let n = 0
for (const [a, b] of reps) {
  if (!s.includes(a)) { console.log('MISS:', a.slice(0, 70).replace(/\n/g, ' / ')); continue }
  s = s.replace(a, b)
  n += 1
}

// убираем дублирующий ручной «ползунок» сверху листа? нет — он остаётся как часть контента.
fs.writeFileSync(F, s)
console.log('sheets converted:', n)
