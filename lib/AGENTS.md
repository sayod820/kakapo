# Shared Library Instructions

These rules apply to shared client, state, API, synchronization, financial, and platform helpers under this directory. Root `AGENTS.md` remains in force.

## Shared-contract discipline

- Code here is consumed across StoreApp, Trade/POS, Admin, Restaurant, Courier, Assembler, Desktop, Android, and server-side Next routes. Identify all importers and runtime consumers before editing.
- Preserve public types, payload shapes, error behavior, storage keys, and backward compatibility unless every affected consumer is deliberately migrated.
- Do not let browser cache, localStorage, renderer state, or derived UI projections become authority for ONLINE business state.

## Cross-runtime invariants

- Do not mix browser ONLINE behavior with Desktop/Android offline or local-first semantics casually. Review queueing, persistence, replay, bootstrap, recovery, and server effects together when a shared path crosses those runtimes.
- Preserve `clientRef`, opRef, operation-kind, fingerprint, and lost-ACK replay behavior. Never generate a second logical mutation to recover from an uncertain result.
- Preserve PostgreSQL `sync_changes.change_seq`, safe cursor advancement, `CURSOR_EXPIRED` recovery, pending-local overlays, and the rule that WebSocket is only a hint.
- Shared debt helpers must treat `debtLedger.remaining` as canonical and client/card totals as reconciled mirrors. Preserve targeted/FIFO repayment and debt/bonus optimistic versions.
- Keep auth tokens, device credentials, phone numbers, customer data, and internal product/finance fields within their established trust boundaries.

## Verification

- Select focused tests by every affected consumer and invariant, not only by the file edited. Use `docs/KAKAPO_TEST_MATRIX.md`; never run mutating suites against production or live user Desktop data.
