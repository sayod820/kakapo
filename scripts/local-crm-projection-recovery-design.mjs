/**
 * LOCAL CRM projection recovery design (DRY-RUN documentation / future operator).
 *
 * DO NOT RUN against production without explicit operator approval after:
 *  1) Server authoritative recovery postVerify PASS
 *  2) Desktop ≥ 1.2.188 deployed (identity write gate + server 409 guards)
 *  3) App CLOSED on cashier PC
 *
 * Scope: replace ONLY CRM projections for U-01 / U-03 / КАКАПО-0001 / КАКАПО-0003
 * from a fresh READ-ONLY server GET /clients + GET /cards response.
 *
 * Preserve untouched:
 *  - mirror sales / entities sale
 *  - stock / stock_layer
 *  - moneyLedger / finance_truth
 *  - shifts / debt_repay_cash_ledger
 *  - queue / queue_idmap
 *  - revisionCoordinator data
 *
 * Keys to rewrite (Desktop SQLite kv):
 *  - data_clients   (rows U-01, U-03 only — or full array replace from GET /clients)
 *  - catalog_clients (same)
 *  - data_cards     (rows 0001, 0003)
 *  - entities kind=client id U-01/U-03 identity+debt blob from server
 *  - entities kind=card for 0001/0003 from server
 *
 * Do NOT:
 *  - replace entire kakapo.sqlite
 *  - hardcode 1741.31 / 912.24
 *  - push local stale PATCH to server
 *  - open Desktop 1.2.184 after server recovery
 *
 * Suggested operator flow (manual, after code deploy):
 *  A. Stop Desktop
 *  B. Backup live sqlite
 *  C. GET server clients/cards (RO) → confirm U-01/U-03/0001/0003
 *  D. On COPY: patch CRM keys; verify picker simulation
 *  E. Apply same patch to live sqlite CRM keys only
 *  F. Start Desktop ≥ 1.2.188 → fetchFromApi → confirm data_* matches server
 */

export const LOCAL_CRM_RECOVERY_KEYS = [
  'data_clients',
  'catalog_clients',
  'data_cards',
]

export const LOCAL_CRM_RECOVERY_IDS = {
  clients: ['U-01', 'U-03'],
  cards: ['КАКАПО-0001', 'КАКАПО-0003'],
}
