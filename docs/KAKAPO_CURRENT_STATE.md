# KAKAPO Current State

LAST_AUDITED_DATE: `2026-10-07`
AUDITED_BRANCH: `release/online-v1`
AUDITED_HEAD: `2c206496ee13e698d5c97be746a767e71fe54f7f`
AUDITED_TAG: `online-v1.0.78`

This document records the repository state found during a read-only audit. The status labels have precise meanings:

- **PROVEN_FROM_REPOSITORY**: directly supported by the audited checkout, Git metadata, source, configuration, or stored reports.
- **KNOWN_BUT_NOT_PROVEN_IN_PRODUCTION**: represented in the repository but not verified against the live deployment or live data.
- **UNFINISHED**: present work is incomplete, inconsistent, or uncommitted.
- **KNOWN_RISK**: an identified correctness, concurrency, operational, or maintenance hazard.

## Git and release state

**PROVEN_FROM_REPOSITORY**

- The audited worktree was on `release/online-v1` at `2c206496ee13e698d5c97be746a767e71fe54f7f`, exactly tagged `online-v1.0.78`.
- The local remote-tracking comparison with `origin/release/online-v1` was ahead 0 / behind 0. This does not prove the live remote had not advanced since the last fetch.
- `.78`, dated 2026-10-05, is the latest committed release in this checkout and is titled `store K2: remove fake and empty store content`.
- There are 78 `online-v1` tags in the checkout.
- The release branch is 101 commits ahead of its merge-base with `origin/main`. Local `main` also contains separate recovery-era commits not present in the release branch.
- The worktree was dirty at audit time. Exact unfinished files are recorded below.
- No dedicated current roadmap was found. Release commits/tags, implementation notes, and regression runners are the effective development history.

**KNOWN_BUT_NOT_PROVEN_IN_PRODUCTION**

- The repository contains Hetzner/Docker deployment configuration, but the audit did not establish which commit, image, or UI build is running in production.

## Current ONLINE architecture

**PROVEN_FROM_REPOSITORY**

- Next.js 14 serves the application surfaces: StoreApp at `/`, Trade/POS at `/trade`, and the Admin, Restaurant, Courier, and Assembler applications. `/store` redirects to `/`; `/pos` redirects to `/trade`.
- An Express API and WebSocket server provide business operations and events. A substantial portion of routing remains concentrated in `server/kakapo-api/index.js`.
- PostgreSQL 16 is authoritative for ONLINE operation. Production startup requires `DATABASE_URL`, and readiness requires a successful PostgreSQL query.
- Persistence uses `kv_meta`, JSONB `docs`, monotonic `sync_changes`, and hashed-token `api_sessions` tables.
- The server loads document state into memory, writes changed documents with hash/`updated_at` guards, and uses PostgreSQL transactions for critical business mutations.
- nginx proxies Next.js, API, WebSocket, update, health, and readiness traffic. Docker Compose defines PostgreSQL, API, web, nginx, certbot, and persistent volumes.
- Principals include ADMIN, STAFF, CASHIER, CLIENT, and DEVICE, with route capability checks. Passwords use bcrypt; offline employee credentials use salted PBKDF2-SHA256. Stored sessions contain token hashes rather than raw tokens.
- WebSocket credentials use protocol/Bearer authentication; production does not accept query-string authentication.
- Production guards reject insecure test/lab authentication configuration and unsafe CORS configuration.

**KNOWN_BUT_NOT_PROVEN_IN_PRODUCTION**

- Live PostgreSQL schema/data, environment variables, nginx configuration, TLS certificates, CORS, health/readiness, backups, and running container versions were not inspected.

## Online synchronization

**PROVEN_FROM_REPOSITORY**

- v1 provides timestamp-based full/delta synchronization.
- v2 uses PostgreSQL `sync_changes.change_seq` as its authoritative monotonic cursor when PostgreSQL is enabled.
- v2 does not silently substitute an in-memory journal after PostgreSQL journal failure.
- Sync supports full, POS-lite, warehouse, and finance scopes. Filtered pages still advance the global cursor safely.
- Safe-prefix handling allows for sequence gaps caused by in-flight transactions.
- `CURSOR_EXPIRED` recovery falls back to the implemented v1/full recovery flow and then adopts a safe current v2 cursor.
- The configured runtime journal retention is 60 days, with daily upkeep.
- Desktop sync protects pending local overlays while applying inbound changes.
- WebSocket messages are hints; HTTP synchronization remains the durable source of reconciliation.

**KNOWN_RISK**

- Cursor advancement, safe-prefix logic, retention, scope filtering, and the pending-overlay rules are tightly coupled. Manual sequence edits or casual pruning can make clients miss durable changes.

## Debt and financial consistency

**PROVEN_FROM_REPOSITORY**

- Per-client `debtLedger` entries are canonical. Client and card debt fields are mirrors reconciled from remaining ledger balances.
- Debt can originate from a sale, order, or cash advance. Targeted repayment addresses a specific obligation; untargeted repayment uses FIFO behavior.
- Debt and bonus mutation paths use optimistic versions such as `debtPayVersion` and `bonusPayVersion`.
- Credit limits, overdue strikes, block state, reminders, manual unblock behavior, and preservation of open ledger entries are implemented.
- `clientRef`, operation references, and fingerprints support idempotency and lost-ack replay.
- Cash repayment affects the active shift/current till or is reconciled to the main vault when late.
- Receipt debt status is derived from the ledger entry's remaining balance rather than a stale sale flag.
- Desktop debt repayment is transactionally coupled across its SQLite outbox and local mirrors.

**KNOWN_RISK**

- Ledger, client, card, sale/order, shift, till, and vault data must not be modified independently.
- Wallet spending does not have debt/bonus-style optimistic version protection.

## StoreApp

**PROVEN_FROM_REPOSITORY**

- StoreApp uses the real API in production and implements catalog, categories, search, favorites, cart, promotions, weighted/bulk pricing, delivery calculation, checkout, orders, reviews, help, and showcase content.
- Product ranking uses real recent POS sales. Invalid-price, blocked, and unavailable products are filtered where applicable.
- Public order price, promotion, weight, delivery, and stock validation are server-authoritative.
- Public checkout is cash-only and ignores client-side attempts to use credit, bonus, or VIP benefits.
- Public catalog and WebSocket responses redact internal cost and supplier data.
- Store K2 removed fake live tracking, fixed delivery-time, payment, VIP, priority, referral, chat, and demo-address claims from current StoreApp content.
- Restaurant data can be displayed, but public restaurant checkout is deliberately rejected.
- Production customer SMS authentication is deferred; production OTP send returns unavailable unless a real provider is added. Sensitive customer functions remain disabled without verified login.

**UNFINISHED**

- Anonymous order tracking and guest review ownership are not complete end-to-end. See “Current uncommitted work.”
- The web manifest still contains an obsolete 45-minute delivery statement and shortcuts that do not correspond to current pages.

## Trade/POS, warehouse, suppliers, products, and clients

**PROVEN_FROM_REPOSITORY**

- Trade navigation covers POS, Products, Clients, Debts, Warehouse, Suppliers, Finance, and Reports, subject to employee permissions.
- POS supports barcode/search entry, weighted goods, multiple payment compositions, discounts, bonus/debt interactions, receipt printing, shifts, and returns.
- Server-side sale creation couples idempotency, stock-layer consumption, finance records, client/loyalty effects, and shift totals in a critical mutation path.
- Returns restore stock and reverse payment, loyalty, and debt effects. Closed-shift returns can be paid from the current till.
- Shift ownership is tied to the authenticated employee. Closing a shift logs the employee out; startup bypasses a password only for that employee's open offline shift.
- POS devices support pairing, bound keys, heartbeat, revocation, and limited previous-key grace.
- Warehouse includes FIFO stock layers, receipts, write-offs, exact reconciliation, revisions, expiry handling, and queued/coordinated work.
- Supplier balances and payments use concurrency checks and overpayment guards; cash payments are tied to a real till or vault movement.
- Products/categories/promotions include barcode, label, CSV import, photo, pricing, and stock workflows.
- Client/card indexes and mirrors support POS performance and loyalty/debt behavior.
- Finance covers cashbook, expected-versus-actual cash, vault, shifts, conversion, profit, alerts, and Asia/Dushanbe business-day calculations.

**KNOWN_RISK**

- Multi-process sale idempotency has a `clientRef` check/insert TOCTOU window because logical `clientRef` uniqueness is not enforced across API workers at the database level.
- FIFO layers, supplier balances, returns, shifts, finance movements, and client/debt mirrors are cross-domain invariants and must be changed atomically.

## Admin, Restaurant, Courier, and Assembler

**PROVEN_FROM_REPOSITORY**

- Admin covers dashboard/orders, catalog and promotions, restaurants/reviews/pickups, couriers/assemblers/employees/POS devices, clients/cards/debts, finance/reports/cash/tariff, banners, audit, settings, and optional AI integration.
- Dashboard totals use real POS plus online revenue and report open/stale shifts and low/out-of-stock products.
- Reports include daily, cashier, product, and low-stock forecasting plus client/debt exports.
- Restaurant menu/order and commission operations are implemented for back-office use.
- Courier orders, assembler operations, employee permissions, employee-to-cashier links, and device administration are implemented.
- Empty operational sections are hidden unless they contain data or are explicitly opened.
- Warehouse operations live in Trade; the old Admin inventory route redirects to Products.

**KNOWN_BUT_NOT_PROVEN_IN_PRODUCTION**

- Optional AI and external operational integrations depend on live credentials/configuration not present in repository evidence.

## Desktop and offline state

**PROVEN_FROM_REPOSITORY**

- Electron loads remote `/trade` when online and a bundled standalone Next.js UI when offline.
- Desktop SQLite stores durable key/value state, queue operations, metadata, mirrors, entities, and recovery audit records.
- Local sale processing atomically records outbox, stock layers, sale/shift mirrors, and queue sequence. Restart recovery reconstructs UI state from durable local data.
- Initial bootstrap downloads catalog, POS snapshot, clients, cards, layers, employee offline-auth material, and a sync cursor.
- Queue processing implements classification, retry/backoff, pending-first reconciliation, and inbound progress despite failed outbound entries.
- UI updates use ranged downloads, size checks, staging/backup, and atomic replacement. Older POS data is split into daily archives.
- Electron enforces a single running instance.
- Browser operation is online-only. Android has offline persistence but not Desktop's full multi-record SQLite transaction parity.
- `desktop/package.json` reports `1.2.205`, while a recent commit title refers to `1.2.206`. Android reports version `1.2.174` / code 56.

**KNOWN_RISK**

- Android can crash between queueing a sale and applying related stock/local-state changes, leaving a half-applied local operation.
- Desktop SQLite, outbox, recovery mirrors, archives, and installed user data must never be reset or cleaned casually.

## Tests and recorded results

**PROVEN_FROM_REPOSITORY**

- The checkout contains 98 tracked `scripts/*test*.mjs` files, including helpers.
- `run-online-regression.mjs` aggregates 27 online suites.
- `run-online-clean-regression.mjs` operates on a guarded lab PostgreSQL database and performs destructive truncation there.
- `run-debt-predeploy-suite.mjs` aggregates 20 debt/predeploy suites plus syntax/import/startup checks.
- Coverage includes PostgreSQL atomicity, auth/sessions/devices, cursor sync, local-first recovery, WebSocket reconnect, debt/loyalty/idempotency, POS shifts/returns/reconciliation, warehouse/products/suppliers, Admin reports, finance, readiness, performance, and soak behavior.
- Stored regression reports inspected during the audit contained no reported failures.
- A read-only UTF-8 syntax check passed for the current server index and the untracked guest-order module.

**KNOWN_BUT_NOT_PROVEN_IN_PRODUCTION**

- Stored reports mostly predate the latest October changes. The complete suites were not rerun during the read-only audit because they mutate lab databases, temporary files, or reports.
- Repository results do not prove current production behavior or prove that current HEAD plus uncommitted work is fully green.

## Current uncommitted work

**UNFINISHED**

At audit time there were no staged files. Existing dirty work was:

- Modified: `server/kakapo-api/index.js`
- Untracked: `server/kakapo-api/storeGuestOrders.js`
- Modified: `desktop/publish-ui-out/README.txt`
- Modified: `desktop/publish-ui-out/latest.json`
- Deleted: `desktop/publish-ui-out/ui-omdFjszBfvXpTRQfVB_uL.zip`
- Untracked: `desktop/publish-ui-out/ui-L9iuBaqV49_Lnn6uILnnP.zip`

The guest-order module implements phone-normalized lookup for supplied order IDs, public order projection, and delivered-order review ownership checks. The server index imports it, adds `/orders/track`, applies pickup redaction, and adds the guest review gate.

The work is incomplete because:

- `/orders/track` is not included in the anonymous/public route inventory and therefore remains staff-protected under the default GET policy.
- StoreApp has no tracking request/UI or persisted order-ID-and-phone workflow.
- The StoreApp review proxy/payload does not send the phone required by the new guest ownership gate.
- No focused tests cover guest tracking, guest review ownership, or public pickup projection.

The uncommitted desktop feed points to `ui-L9iuBaqV49_Lnn6uILnnP.zip`, built on 2026-10-05. Its SHA-256 at audit time was `CE886E8F52B3FF1D6394ADE58B32A51C5DA0C597FBAF3D6858F62FDCDCC0B490`. The artifact contains no source commit stamp, so its exact source revision is unknown.

## Known issues and risks

**KNOWN_RISK**

- Multi-process `clientRef` sale-idempotency TOCTOU race.
- Wallet optimistic-concurrency gap.
- Android local atomicity gap.
- Next.js configuration permits builds to ignore TypeScript and ESLint errors.
- Health/version metadata, some documentation, and some schema comments are stale relative to current behavior.
- Append-oriented sales, orders, finance, operation-reference, and sync history must not be deleted blindly.
- Authentication inventory/default policy, session hashing, device keys, and WebSocket authorization must not be weakened.
- UI feed metadata, filenames, archive hashes, versions, and published URLs must remain consistent.

## Production unknowns

**KNOWN_BUT_NOT_PROVEN_IN_PRODUCTION**

- The production commit, tag, API image, web build, and Desktop update artifact.
- Live database migration state, integrity, backups, debt/stock consistency, duplicate operation references, and sync cursor health.
- Live health/readiness, WebSocket, reverse proxy, TLS, CORS, and production feature-flag behavior.
- Installed Desktop/Android versions and the contents of device-local queues or SQLite databases.
- External routing/geocoding, AI, SMS, certificate, and secret configuration.
- Whether the live remote branch advanced after the local remote-tracking reference was last fetched.
- The owner, intended release, and completion criteria for the uncommitted guest-order implementation.
