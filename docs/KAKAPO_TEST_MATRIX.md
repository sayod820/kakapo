# KAKAPO Test and Verification Matrix

Use this map after inspecting the actual change. Run the smallest focused tests first, then the listed regression runner when the change crosses a release boundary. There is no root `npm test` command.

## Safety legend

- **DB_MUTATING = No**: no PostgreSQL mutation found in the listed primary test.
- **DB_MUTATING = Yes — lab only**: the test starts the API and changes PostgreSQL. It must pass the repository's test-database guard and must never receive a production URL.
- **DB_MUTATING = Conditional**: part of the script runs only when `DATABASE_URL` is present.
- **SAFE_READ_ONLY = Yes**: reads source/in-memory fixtures and does not write a repository report.
- **SAFE_READ_ONLY = Temp only**: writes only an explicit temporary fixture/database.
- **SAFE_READ_ONLY = No — report/files**: writes a report or fixture in the repository even though it does not mutate PostgreSQL.
- A skipped PG section is not a passing proof of PG behavior.

| DOMAIN | PRIMARY_TESTS | REGRESSION_RUNNER | DB_MUTATING? | SAFE_READ_ONLY? | WHEN_REQUIRED |
|---|---|---|---|---|---|
| Auth, sessions, capabilities | `durable-sessions-test.mjs`; `online-o8-auth-hardening-test.mjs`; `online-o8b-auth-closure-test.mjs`; `online-s2-device-key-test.mjs`; `online-o11d-customer-otp-deferred-test.mjs` | `run-online-regression.mjs` (O8, O8B, S2, O11D) | Mixed; O8/O8B/S2/O11D mutate lab PG | Mixed; `durable-sessions` is read-only | Any route policy, login/session, capability, client isolation, device-key, CORS, OTP, or WS-auth change. Route changes require O8/O8B. |
| Orders and order actions | `store-order-guard-test.mjs`; `online-o6b-order-action-test.mjs`; `online-o6-legacy-closure-test.mjs`; `fixe-order-loyalty-idempotency-test.mjs` | `run-online-regression.mjs` (O6, O6B) | O6/O6B use lab PG; Store guard does not | Store guard is Yes; Fix E writes a report | Checkout/pricing, order creation/status, stock reservation, assignments, deletion, opRef, replay, or order/loyalty effects. |
| Public StoreApp | `store-order-guard-test.mjs`; `online-o11d-customer-otp-deferred-test.mjs`; `online-final-hardening-test.mjs` | O8/O8B/O11D through `run-online-regression.mjs` when public API/auth changes | O11D uses lab PG; others no PG | Store guard/final hardening are Yes | Public catalog/order payload, pricing, stock, customer auth, privacy, API proxy, or public-route changes. UI-only changes also require a build/type-focused check appropriate to the files touched. |
| Sales and shifts | `phase5-atomic-sale-test.mjs`; `shift-sale-totals-test.mjs`; `shift-lifecycle-test.mjs`; `shift-owner-test.mjs`; `shift-reconcile-test.mjs`; `online-o8a-durable-mutation-test.mjs` | `run-debt-predeploy-suite.mjs`; `run-online-regression.mjs` (O8A) | O8A mutates lab PG; local tests do not | Mixed; Phase 5 and predeploy runner write reports | Sale creation, local atomic commit, shift ownership/open/close, totals, restart reconciliation, or sale idempotency. |
| Returns | `closed-shift-return-test.mjs`; `shift-return-cash-test.mjs`; relevant O8A order/sale cases | O8A via `run-online-regression.mjs` for server mutation changes | Focused return tests no PG; O8A lab PG | Focused return tests are Yes | Return payment reversal, stock restoration, debt/bonus reversal, closed-shift return, current-till, or expected-cash changes. |
| Debt and cards | `debt-predeploy-regression-test.mjs`; `debt-ledger-cap-test.mjs`; `debt-ledger-per-sale-test.mjs`; `debt-local-atomic-d3-test.mjs`; `debt-server-idempotency-d4-test.mjs`; `debt-unblock-test.mjs`; `card-ownership-guard-test.mjs` | `run-debt-predeploy-suite.mjs`; D4 in `run-online-regression.mjs` | Primary module tests no PG; runner may spawn mixed checks | Mixed; several tests and the runner write reports/temp files | Any debtLedger, repayment, cash advance, receipt projection, card mirror/ownership, unblock, debt OCC, shift/vault debt effect, or replay change. |
| Loyalty and bonus | `fixa-loyalty-underapply-test.mjs`; `fixe-order-loyalty-idempotency-test.mjs`; `loyalty-money-ops-test.mjs`; `provision-loyalty-hydrate-import-test.mjs` | `run-debt-predeploy-suite.mjs`; relevant O4/O6/O8A suites | Focused tests are primarily in-memory; ONLINE suites use lab PG | Fix A/Fix E write reports; inspect before running | Bonus spend/earn, delivery/cancel reversal, loyalty hydration, level derivation, order linkage, or replay changes. |
| Warehouse and stock revisions | `online-warehouse-contract-test.mjs`; `revision-o8-tx-test.mjs`; `product-conflict-test.mjs`; `online-o3-stock-conservation-test.mjs`; `online-o3b-stock-final-closure-test.mjs`; `online-o3c-stock-concurrency-test.mjs` | `run-online-regression.mjs` (O3/O3B/O3C) | Contract/revision tests no PG; O3 family mutates lab PG | Contract/revision tests are Yes | Stock layers, receipt, write-off, adjustment, return stock, revision, FIFO, concurrency, or product-stock change. |
| Suppliers | `supplier-overpay-guard-test.mjs`; `online-o1-supplier-accounting-test.mjs`; `online-o1b-supplier-closure-test.mjs` | `run-online-regression.mjs` (O1/O1B) | Supplier guard no PG; O1 family mutates lab PG | Supplier guard is Yes | Supplier receipt/debt/payment, settlement source, overpayment, layer deletion, or restart durability changes. |
| Finance, vault, and cash | `online-money-ops-contract-test.mjs`; `phase9-finance-idempotency-test.mjs`; `online-o2-finance-conservation-test.mjs`; `online-o2b-finance-closure-test.mjs`; `debt-repay-cash-journal-test.mjs` | `run-debt-predeploy-suite.mjs`; `run-online-regression.mjs` (O2/O2B) | Contracts/local logic no PG; O2 family mutates lab PG | Contract is Yes; Phase 9/predeploy write reports | Finance moves, expected cash, vault/till transfers, supplier payment source, debt cash flow, shift close, or money idempotency. |
| Sync and cursor | `sync-changes-v2-test.mjs`; `sync-journal-upkeep-test.mjs`; `snapshot-diff-write-test.mjs`; `online-l13-local-first-test.mjs` | `run-online-regression.mjs` (L13); clean runner for release proof | Sync v2 no PG; upkeep Conditional; snapshot/L13 mutate guarded test PG and L13 truncates it | Sync v2 is Yes; PG tests are No | `change_seq`, journal emission/pruning, safe-prefix, scopes, cursor expiry, snapshot persistence, inbound application, or Local-First protocol changes. |
| WebSocket | `phase7-ws-coalesce-keepalive-test.mjs`; WS sections in O8/O8B/S2/O9 | `run-online-regression.mjs` (O8/O8B/O9/S2) | Phase 7 no PG; ONLINE suites mutate lab PG | Phase 7 writes a report | WS authentication, role filtering, event privacy, reconnect, ping/pong, coalescing, or HTTP-backstop behavior. |
| Desktop recovery and snapshots | `phase8-snapshot-ipc-test.mjs`; `pos-sales-inbound-repair-test.mjs`; `pos-snapshot-archive-test.mjs`; `sayod-holov-recovery-test.mjs` | No single umbrella beyond relevant predeploy/ONLINE suites | No production PG; tests use source/in-memory/temp fixtures | Mixed; Phase 8/inbound repair write reports; recovery writes fixture files | SQLite snapshot, IPC, archive, inbound repair, restart reconstruction, or recovery-operator changes. Use only temporary user data. |
| Offline/outbox/local-first | `outbox-error-classifier-test.mjs`; `phase1-ghost-outbox-test.mjs`; `phase4-reconnect-timer-test.mjs`; `phase6-push-pull-starvation-test.mjs`; `employee-offline-login-test.mjs`; `online-l13-local-first-test.mjs` | L13 through `run-online-regression.mjs` | Local tests no PG; L13 mutates and truncates guarded lab PG | Classifier is Yes; employee test is Temp only; phase tests write reports | Queue semantics, retries, ACK loss, pending overlays, reconnect, bootstrap, offline auth, shift remap, or Local-First convergence. |
| Release and readiness | `online-o10-release-readiness-test.mjs`; `online-o9-soak-release-test.mjs`; `online-final-hardening-test.mjs` | `run-online-regression.mjs`; `run-online-clean-regression.mjs` | O9/O10 and both runners mutate lab PG; clean runner truncates guarded lab tables | Final hardening is Yes; ONLINE runners are No | Before an explicitly requested release/deploy or after broad server/auth/persistence changes. `run-online-clean-regression.mjs` is the authoritative clean chain only for `kakapo_l11_test*`. |
| Desktop package artifact | `desktop/scripts/validate-175.cjs`; `desktop/scripts/smoke-unpacked-175.cjs` | None | No PG | Temp/artifact mutation; not repository-read-only | Only for the exact prepared 1.2.175 artifacts expected by these scripts. Do not treat them as validation for the current Desktop version without updating the task scope. |

## Regression runners

### `node scripts/run-online-regression.mjs`

- Runs 27 named suites: O8A, O1/O1B, O2/O2B, O3/O3B/O3C, O4/O4B/O4C/O4D/O4E, O5/O5B, O6/O6B, O7, O8/O8B, O9, O10, O11D, D4, L13, S2, and S3.
- Most suites require real guarded PostgreSQL. It cleans test-prefixed data between suites.
- Never provide a production `DATABASE_URL`.

### `node scripts/run-online-clean-regression.mjs`

- Requires `DATABASE_URL` identifying `kakapo_l11_test` or `kakapo_l11_test_*`.
- Truncates the guarded lab `docs`, `sync_changes`, and `kv_meta` state before the chain and performs an orphan sweep afterward.
- Use only when full clean-chain proof is required.

### `node scripts/run-debt-predeploy-suite.mjs`

- Runs 20 debt, shift, finance, loyalty, outbox, and atomic-sale suites plus syntax/import/startup checks.
- Writes temporary scripts and `scripts/_diag_out/debt-predeploy-regression-report.json`.
- It is not read-only and must not be used against production data.

## Standard task workflow

1. Read root and nearest module `AGENTS.md` files.
2. Inspect Git status and branch/HEAD.
3. Identify and preserve current dirty work.
4. Inspect the relevant implementation and tests.
5. State the smallest safe plan.
6. Modify only the task scope.
7. Run focused tests from the matching row above.
8. Run the required regression runner when the change crosses its boundary.
9. Review `git diff` and `git status`.
10. Report exact changed files, tests, and unresolved risks.
11. Never commit, push, publish, or deploy unless explicitly requested.
