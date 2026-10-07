# KAKAPO API Server Instructions

These rules apply to the ONLINE API, PostgreSQL persistence, authentication, business mutations, WebSocket delivery, and sync journal under this directory. Root `AGENTS.md` remains in force.

## Persistence and transaction boundaries

- PostgreSQL is authoritative for ONLINE. The persisted model is JSONB `docs`, metadata in `kv_meta`, cursor history in `sync_changes`, and hashed sessions in `api_sessions`.
- The in-memory document model is a runtime view, not a second authority. Preserve changed-document hashes, `updated_at` guards, explicit deletion handling, and rollback behavior.
- Cross-entity business operations must use the established transaction boundary. Do not replace `runBusinessMutationTx`/durable mutation paths with ad hoc object edits followed by snapshot `persist()`.
- Append-oriented sales, orders, money/finance movements, operation references, and sync history must never be deleted or rewritten casually.

## Idempotency and business invariants

- Preserve `clientRef`, opRef, operation-kind, and request-fingerprint behavior. A retry must reuse the same reference and semantically identical payload; never generate a fresh reference for an uncertain result.
- `debtLedger` is canonical. Client/card debt values are mirrors that must be reconciled with ledger remaining balances and protected by the established optimistic versions.
- Sale, return, debt repayment, cash advance, bonus, stock, shift totals, current till, late reconciliation, finance ledger, and main-vault effects are coupled. Never update only one side.
- Stock layers are authoritative for FIFO quantity/cost history. Preserve receipt/write-off/return/revision coupling, stock guards, supplier balances, and revision coordination.
- Supplier payment must correspond to an actual approved money source; do not introduce book-only settlement paths.

## Security and public data

- Keep route classification exhaustive. Public routes require an explicit `PUBLIC_STORE` policy; unclassified reads default to staff and unclassified writes must not be opened as a shortcut.
- Preserve capability, principal, session, device-key, self-only, and horizontal-authorization checks. Do not rely on UI hiding.
- WebSocket connections and event payloads must enforce the same role/data boundaries as HTTP. WebSocket is notification only, not persistence authority.
- Public product and order data must never expose cost, purchase price, supplier, margin, internal notes, secrets, unrelated customer data, or unnecessary personal fields.
- Production must not enable lab auto-auth, demo OTP, wildcard CORS, query-string WebSocket tokens, or test-only routes.

## Synchronization

- PostgreSQL `sync_changes.change_seq` is authoritative for v2 cursor sync.
- Preserve safe-prefix gap handling, scoped cursor advancement, `CURSOR_EXPIRED` recovery, retention, pending-overlay compatibility, and the no-memory-fallback rule for PostgreSQL journal failure.
- Do not prune or resequence the journal outside the existing guarded upkeep path.

## Operations and verification

- Never mutate production, run migrations, reset data, or deploy without explicit approval.
- Start with syntax/import checks and the smallest domain test from `docs/KAKAPO_TEST_MATRIX.md`.
- Route/auth changes require route-inventory plus O8/O8B coverage. Sync changes require cursor/journal tests. Financial, debt, stock, supplier, order, sale, or return changes require their focused invariant tests.
- Release-critical server changes require the appropriate ONLINE regression runner against the guarded lab database. Never aim a mutating suite at production.
