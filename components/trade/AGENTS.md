# Trade and POS Instructions

These rules apply to Trade/POS UI modules here, including cashier, products, clients, debt, warehouse, suppliers, finance, and reports. `components/pos/PosApp.tsx` is a compatibility re-export; `/pos` redirects to `/trade`.

## Canonical operations

- The server is authoritative for ONLINE sales, returns, debt, bonus, stock layers, finance movements, and shift totals.
- Every cashier action must use the authenticated employee and the employee's valid shift. Never infer or silently switch shift ownership in the browser.
- Sale and return effects are coupled across payment, shift/till, stock layers, client/card, debt ledger, loyalty, finance, and receipts. Preserve the established atomic server path.
- Do not reconstruct canonical paid/unpaid receipt state from stale sale flags or UI history. Use `debtLedger.remaining`/server projections.
- Preserve stable `clientRef`/opRef semantics. Retry the same operation with the same reference after uncertain delivery; never create a second logical sale to recover from a timeout.

## Cash, warehouse, and suppliers

- Cash movement must have a real source/destination: current till, main vault, card, or the established reconciliation path. Closed-shift returns and late repayments have specific current-till/vault behavior.
- Stock layers and warehouse documents own FIFO quantity/cost history. Do not patch aggregate product stock independently of receipts, write-offs, returns, revisions, and layer invariants.
- Supplier receipt, debt, deletion, and payment effects must remain coupled and overpayment-protected.
- Browser Trade is online-only. UI optimism must roll back on server rejection and must not claim durable offline completion.

## Offline boundary and verification

- Any change affecting queueing, replay, bootstrap, cursor sync, shift remapping, local snapshots, or offline credentials requires a separate Desktop/Local-First review using `desktop/AGENTS.md`.
- Run the focused sale/return/debt/shift/warehouse/supplier/finance tests selected from `docs/KAKAPO_TEST_MATRIX.md`; use guarded lab PostgreSQL only where required.
