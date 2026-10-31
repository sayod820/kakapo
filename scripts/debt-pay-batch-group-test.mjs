/**
 * Unit-ish checks for pay grouping rules (no DOM).
 * Run: node scripts/debt-pay-batch-group-test.mjs
 */
import assert from 'node:assert/strict'

const PAY_CLUSTER_MS = 2500

function groupPays(rows) {
  const paySortedAsc = [...rows].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
  const payGroups = []
  let cluster = []
  const flush = () => {
    if (!cluster.length) return
    const parts = [...cluster]
    cluster = []
    const amount = Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100
    payGroups.push({
      id: parts[0].batchId || parts[0].clientRef || `cluster-${parts[0].id}`,
      amount,
      parts,
    })
  }
  for (const row of paySortedAsc) {
    const last = cluster[cluster.length - 1]
    const sameBatch = !!(row.batchId && last?.batchId && row.batchId === last.batchId)
      || !!(row.clientRef && last?.clientRef && row.clientRef === last.clientRef)
    const closeInTime = !row.batchId && !last?.batchId && !row.clientRef && !last?.clientRef && last
      && Math.abs(row.ts - last.ts) <= PAY_CLUSTER_MS
    if (!cluster.length || sameBatch || closeInTime) cluster.push(row)
    else {
      flush()
      cluster.push(row)
    }
  }
  flush()
  return payGroups
}

// 1) One repay 200 across 3 checks with shared batchId → one group 200
{
  const batchId = 'payb-1'
  const groups = groupPays([
    { id: 'a', amount: 80, ts: 1000, batchId, orderId: 's1' },
    { id: 'b', amount: 70, ts: 1000, batchId, orderId: 's2' },
    { id: 'c', amount: 50, ts: 1000, batchId, orderId: 's3' },
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].amount, 200)
  assert.equal(groups[0].parts.length, 3)
}

// 2) Sale 50 + debt 400 same batch → one group 450
{
  const batchId = 'payb-2'
  const groups = groupPays([
    { id: 'sale', amount: 50, ts: 2000, batchId, payScope: 'sale', orderId: 'new' },
    { id: 'd1', amount: 200, ts: 2000, batchId, orderId: 'old1' },
    { id: 'd2', amount: 200, ts: 2000, batchId, orderId: 'old2' },
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].amount, 450)
}

// 3) clientRef links parts without batchId
{
  const clientRef = 'ref-9'
  const groups = groupPays([
    { id: 'a', amount: 100, ts: 3000, clientRef },
    { id: 'b', amount: 100, ts: 9000, clientRef },
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].amount, 200)
}

// 4) Unrelated pays without batch stay separate when far apart
{
  const groups = groupPays([
    { id: 'a', amount: 10, ts: 1000 },
    { id: 'b', amount: 20, ts: 1000 + PAY_CLUSTER_MS + 100 },
  ])
  assert.equal(groups.length, 2)
}

console.log('debt-pay-batch-group-test: ok')
