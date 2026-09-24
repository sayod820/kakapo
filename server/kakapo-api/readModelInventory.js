/**
 * ONLINE-O7 — production GET/read endpoint inventory (UNKNOWN must stay 0).
 * Classifications are for report/read audit — not OpenAPI.
 */

/** @typedef {'ENTITY_READ'|'DERIVED_READ'|'REPORT'|'DASHBOARD'|'SEARCH'|'HISTORY'|'ADMIN_READ'|'HEALTH/TELEMETRY'|'EPHEMERAL'} ReadKind */

/**
 * @type {{ route: string, kind: ReadKind, sources?: string, canonical?: string, derived?: string, timeFilter?: string, tz?: string, aggregation?: string, pagination?: string, sort?: string }[]}
 */
export const READ_ENDPOINTS = [
  { route: 'GET /', kind: 'HEALTH/TELEMETRY' },
  { route: 'GET /health', kind: 'HEALTH/TELEMETRY' },
  { route: 'GET /updates/kassa', kind: 'EPHEMERAL' },
  { route: 'GET /updates/kassa-ui', kind: 'EPHEMERAL' },
  { route: 'GET /sync/changes', kind: 'ENTITY_READ', sources: 'sync_changes', canonical: 'PG sync cursor', pagination: 'cursor', sort: 'seq ASC' },
  { route: 'GET /sync/debt-op-status', kind: 'EPHEMERAL' },
  { route: 'GET /auth/admin', kind: 'ADMIN_READ' },

  { route: 'GET /products', kind: 'ENTITY_READ', sources: 'products', canonical: 'products.stock + stock layers', sort: 'id' },
  { route: 'GET /products/next-codes', kind: 'EPHEMERAL' },
  { route: 'GET /products/:id/stock-layers', kind: 'ENTITY_READ', sources: 'stockLayers', canonical: 'layer.remainingQty' },
  { route: 'GET /stock/layers', kind: 'ENTITY_READ', sources: 'stockLayers', canonical: 'layer.remainingQty' },
  { route: 'GET /categories', kind: 'ENTITY_READ', sources: 'categories' },
  { route: 'GET /categories/tree', kind: 'DERIVED_READ', sources: 'categories', aggregation: 'tree by parent' },
  { route: 'GET /promos', kind: 'ENTITY_READ', sources: 'promos' },

  { route: 'GET /orders', kind: 'ENTITY_READ', sources: 'orders', timeFilter: 'optional status', sort: 'createdAtIso DESC' },
  { route: 'GET /orders/assembler', kind: 'DERIVED_READ', sources: 'orders', aggregation: 'filter assembler statuses' },
  { route: 'GET /orders/courier', kind: 'DERIVED_READ', sources: 'orders', aggregation: 'filter courier map sync' },
  { route: 'GET /orders/:id', kind: 'ENTITY_READ', sources: 'orders', canonical: 'orders.id' },

  { route: 'GET /restaurants', kind: 'ENTITY_READ', sources: 'restaurants' },
  { route: 'GET /restaurants/:id', kind: 'ENTITY_READ', sources: 'restaurants' },
  { route: 'GET /payouts', kind: 'HISTORY', sources: 'payouts' },
  { route: 'GET /pickups', kind: 'ENTITY_READ', sources: 'pickups' },
  { route: 'GET /couriers', kind: 'ENTITY_READ', sources: 'couriers' },
  { route: 'GET /couriers/:id/wallet/transactions', kind: 'HISTORY', sources: 'courierWalletTx' },
  { route: 'GET /couriers/wallet/transactions', kind: 'HISTORY', sources: 'courierWalletTx' },
  { route: 'GET /assemblers', kind: 'ENTITY_READ', sources: 'assemblers' },
  { route: 'GET /cashiers', kind: 'ENTITY_READ', sources: 'cashiers' },
  { route: 'GET /employees', kind: 'ENTITY_READ', sources: 'employees' },
  { route: 'GET /employees/directory', kind: 'DERIVED_READ', sources: 'employees' },
  { route: 'GET /employees/local-auth', kind: 'ADMIN_READ' },

  { route: 'GET /pos/points', kind: 'ENTITY_READ', sources: 'posPoints' },
  { route: 'GET /pos/devices/status', kind: 'DERIVED_READ', sources: 'posDevices' },
  { route: 'GET /pos/devices/check', kind: 'EPHEMERAL' },
  { route: 'GET /pos/shifts', kind: 'ENTITY_READ', sources: 'posShifts', canonical: 'shift.salesCash/salesCard/cashIn/expense' },
  {
    route: 'GET /pos/sales',
    kind: 'ENTITY_READ',
    sources: 'posSales',
    canonical: 'posSales (net paid*/debt after returns)',
    timeFilter: 'from/to Asia/Dushanbe',
    tz: 'Asia/Dushanbe',
    pagination: 'optional limit/offset',
    sort: 'number DESC, createdAtIso DESC, id DESC',
  },

  { route: 'GET /stock/receipts', kind: 'ENTITY_READ', sources: 'stockReceipts', canonical: 'receipt layers' },
  { route: 'GET /stock/writeoffs', kind: 'ENTITY_READ', sources: 'writeOffs' },
  { route: 'GET /stock/revisions', kind: 'ENTITY_READ', sources: 'stockRevisions' },
  { route: 'GET /stock/revisions/queue', kind: 'DERIVED_READ', sources: 'stockRevisions' },
  { route: 'GET /stock/expiry', kind: 'DERIVED_READ', sources: 'stockLayers', aggregation: 'daysLeft sort' },

  { route: 'GET /suppliers', kind: 'ENTITY_READ', sources: 'suppliers', canonical: 'supplier.payableAmount/totalPaid' },
  { route: 'GET /suppliers/:id/payments', kind: 'HISTORY', sources: 'supplierPayments', canonical: 'supplierPayments (not financeMoves)' },
  { route: 'GET /expenses', kind: 'ENTITY_READ', sources: 'expenses' },
  { route: 'GET /finance/moves', kind: 'HISTORY', sources: 'financeMoves', derived: 'audit/ops; do not sum with supplierPayments' },

  {
    route: 'GET /finance/truth',
    kind: 'REPORT',
    sources: 'moneyLedger,posShifts,posSales,cashVault',
    canonical: 'moneyLedger cashAffect + posSales for profit',
    derived: 'financeMoves not revenue',
    timeFilter: 'from/to date-only inclusive end day; half-open [from, toExclusive)',
    tz: 'Asia/Dushanbe',
    aggregation: 'cashBook + profit + expectedVsActual',
  },
  {
    route: 'GET /finance/cashbook',
    kind: 'REPORT',
    sources: 'moneyLedger',
    canonical: 'moneyLedger where cashAffect',
    timeFilter: 'from/to date-only inclusive end day; half-open [from, toExclusive)',
    tz: 'Asia/Dushanbe',
    aggregation: 'running balance by day (ymdBusiness)',
  },
  {
    route: 'GET /finance/expected-vs-actual',
    kind: 'REPORT',
    sources: 'posShifts',
    canonical: 'opening+salesCash+cashIn-expense',
    timeFilter: 'from/to on close/open; date-only inclusive end',
    tz: 'Asia/Dushanbe',
  },
  {
    route: 'GET /finance/profit',
    kind: 'REPORT',
    sources: 'posSales',
    canonical: 'posSales.total − sale COGS (FIFO layers on sale)',
    derived: 'skips status=returned; qty−returnedQty',
    timeFilter: 'from/to date-only inclusive end day; half-open [from, toExclusive)',
    tz: 'Asia/Dushanbe',
  },
  {
    route: 'GET /finance/journal',
    kind: 'HISTORY',
    sources: 'moneyLedger',
    canonical: 'moneyLedger audit trail',
    timeFilter: 'from/to date-only inclusive end day',
    tz: 'Asia/Dushanbe',
    pagination: 'limit≤1000',
    sort: 'createdAtIso DESC',
  },
  { route: 'GET /finance/alerts', kind: 'DERIVED_READ', sources: 'posShifts', canonical: 'expected vs actual diffs' },
  { route: 'GET /finance/vault', kind: 'ENTITY_READ', sources: 'cashVault', canonical: 'cashVault.cashTotal/cardTotal' },
  {
    route: 'GET /finance/cashbox',
    kind: 'DASHBOARD',
    sources: 'cashVault,posShifts',
    canonical: 'vault + open shift expected cash',
  },
  {
    route: 'GET /finance/summary',
    kind: 'DASHBOARD',
    sources: 'orders,restaurants',
    canonical: 'delivered market items (shop) + restaurant month counters',
    derived: 'not POS posSales',
  },
  {
    route: 'GET /finance/pos-summary',
    kind: 'REPORT',
    sources: 'posSales,expenses,supplierPayments,suppliers,clients',
    canonical: 'net posSales revenue/paid*; sale COGS; client.debt; supplierPayments once',
    aggregation: 'getPosFinanceSummary',
  },
  {
    route: 'GET /reports/pos',
    kind: 'REPORT',
    sources: 'posSales,posShifts',
    canonical: 'getPosReport → summary + topProducts net of returns',
  },

  { route: 'GET /clients', kind: 'ENTITY_READ', sources: 'clients', canonical: 'client.debt/bonus (card is mirror)' },
  { route: 'GET /clients/deleted-phones', kind: 'ADMIN_READ' },
  { route: 'GET /clients/session-check', kind: 'EPHEMERAL' },
  { route: 'GET /cards', kind: 'ENTITY_READ', sources: 'cards', derived: 'mirror of client when linked' },
  {
    route: 'GET /debt/ledger',
    kind: 'HISTORY',
    sources: 'client.debtLedger',
    canonical: 'client.debtLedger + client.debt',
    derived: 'card.debt must not be added again',
  },

  { route: 'GET /settings/pricing', kind: 'ENTITY_READ', sources: 'settings' },
  { route: 'GET /settings/loyalty', kind: 'ENTITY_READ', sources: 'settings' },
  { route: 'GET /settings/admin', kind: 'ADMIN_READ' },
  { route: 'GET /settings/store', kind: 'ENTITY_READ', sources: 'settings' },

  { route: 'GET /reviews', kind: 'ENTITY_READ', sources: 'reviews' },
  { route: 'GET /push', kind: 'ADMIN_READ' },
  { route: 'GET /notifications', kind: 'HISTORY', sources: 'notifications' },
  { route: 'GET /audit', kind: 'HISTORY', sources: 'auditLog', pagination: 'query filters', sort: 'createdAtIso DESC' },
  {
    route: 'GET /admin/dashboard',
    kind: 'DASHBOARD',
    sources: 'orders',
    canonical: 'orders where ymdBusiness(createdAtIso)=today',
    tz: 'Asia/Dushanbe',
  },
  { route: 'GET /admin/ai/status', kind: 'EPHEMERAL' },
]

export function inventoryUnknownCount() {
  return READ_ENDPOINTS.filter(e => !e.kind || e.kind === 'UNKNOWN').length
}

export function reportEndpoints() {
  return READ_ENDPOINTS.filter(e => e.kind === 'REPORT' || e.kind === 'DASHBOARD' || e.kind === 'DERIVED_READ')
}
