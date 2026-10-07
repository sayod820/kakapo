# KAKAPO Agent Instructions

## Project

KAKAPO is a multi-application retail, POS, warehouse, finance, delivery, and customer-store system. Its main applications are:

- StoreApp: public customer catalog and ordering.
- Trade/POS: cashier sales, shifts, products, clients, debt, warehouse, suppliers, finance, and reports.
- Admin: business administration, operational reporting, staff, devices, content, and configuration.
- Restaurant: restaurant menu and order operations.
- Courier: delivery workflow.
- Assembler: order assembly workflow.
- Desktop/Offline: Electron application with durable local-first state and synchronization.

## Authority and runtime model

- PostgreSQL is authoritative for ONLINE state.
- Desktop SQLite is the durable local-first/offline state and outbox.
- Browser operation is online-only.
- The active release line is `release/online-v1`.
- Do not treat READMEs, commit subjects, cached reports, or local UI snapshots as more authoritative than current code and persisted data.

## Synchronization invariants

- PostgreSQL `sync_changes` and monotonic `change_seq` are authoritative for v2 sync.
- WebSocket messages are hints only; HTTP cursor sync provides durable reconciliation.
- Handle `CURSOR_EXPIRED` through the implemented full/v1 recovery path, then adopt a safe v2 cursor.
- Do not casually change cursor advancement, scope filtering, safe-prefix handling, journal retention, or pending-local-overlay behavior.

## Debt and money invariants

- `debtLedger` is canonical. Client and card debt fields are derived mirrors that must be reconciled with it.
- Preserve `clientRef`/operation-reference idempotency and existing replay semantics.
- Preserve optimistic versions for debt and bonus mutations.
- Debt creation, repayment, return, cash advance, shift totals, current till, late-payment reconciliation, and main-vault movement are coupled business operations.
- Never update only one side of the ledger/client/card/shift/vault relationship.

## Critical safety rules

- Never reset, revert, clean, overwrite, or discard user work unless explicitly requested.
- Never mutate production or deploy automatically. Require explicit approval.
- Never truncate a production database.
- Never delete append-oriented business history blindly, including sales, orders, finance movements, operation references, or sync records.
- Never bypass or weaken authentication, authorization, session, device-key, or WebSocket security.
- Never weaken idempotency or replay protection.
- Never modify sync cursor semantics casually.
- Do not commit, push, publish, or deploy unless explicitly requested.

## Commit, push, and deploy authorization

- “Fix/make it” authorizes editing and testing only: no commit, push, or deploy.
- “Fix and commit” additionally authorizes the intended commit only: no push or deploy.
- “Commit and push” additionally authorizes push only: no production deploy.
- Production deployment requires an explicit deploy instruction. Passing tests never implies production approval.
- When commit, push, and deploy are all explicitly requested, preserve unrelated work; test and run required regressions; review the diff; commit only intended files; push `release/online-v1`; then verify `HEAD` equals `origin/release/online-v1` before deploying the exact full 40-character pushed SHA through the approved Hetzner wrapper.

## Required workflow for every task

1. Inspect the current Git branch, HEAD, status, and existing dirty files.
2. Inspect the relevant current code and tests; do not rely on historical assumptions.
3. Explain the scoped plan before editing.
4. Make the smallest change that satisfies the task and preserve unrelated work.
5. Run focused tests appropriate to the changed area.
6. Run required regression suites when safe; never point destructive suites at production.
7. Report the exact files changed and the verification performed.
8. Do not commit, push, publish, or deploy unless explicitly requested.

## Current unfinished work

Guest order tracking and guest review ownership are incomplete and uncommitted. At the 2026-10-07 audit, this work touched `server/kakapo-api/index.js` and added `server/kakapo-api/storeGuestOrders.js`; the frontend flow and route/test coverage were incomplete. Preserve it unless the user explicitly scopes work to it.

## Known architectural risks

- Multi-process `clientRef` TOCTOU race: logical sale idempotency is not guaranteed by a database uniqueness constraint across API workers.
- Wallet optimistic-concurrency gap: wallet spending lacks debt/bonus-style version protection.
- Android atomicity gap: queueing and stock/local-state changes do not have Desktop SQLite transaction parity.

See `docs/KAKAPO_CURRENT_STATE.md` for the audited repository state and evidence boundaries.
