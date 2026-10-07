# Desktop and Local-First Instructions

These rules apply to Electron packaging/runtime, SQLite persistence, UI synchronization, and Desktop update artifacts. Root and relevant Trade/server instructions also apply when a change crosses those boundaries.

## Local authority and recovery

- Desktop SQLite is the durable local-first state for Desktop. LocalStorage or renderer state is not a substitute for committed SQLite state.
- Preserve atomic local sale/debt operations, outbox sequence, mirrors, entities, metadata, archives, and recovery audit records.
- Outbound synchronization is pending-first. Failed outbound operations must not starve inbound synchronization.
- Restart recovery must be able to reconstruct visible state from SQLite and the outbox. Never delete or clear queues to “fix” reconciliation errors.
- Preserve ACK-lost replay behavior: an uncertain request retries with the same `clientRef`/operation identity and compatible fingerprint.
- Inbound cursor sync, `CURSOR_EXPIRED` recovery, periodic backstop, and pending-local overlays must remain compatible with ONLINE `change_seq` behavior.
- Shift ID remapping, closed-shift late sales, employee ownership, revision reconciliation, and recovery records are sensitive coupled paths.

## Architecture boundaries

- Do not mix Desktop and ONLINE changes casually. Review API idempotency, cursor semantics, and server transaction effects whenever Desktop payloads or replay behavior change.
- `revisionCoordinator` and broader Local-First work are their own architecture scope; review server, client sync, stock layers, queue replay, and recovery together.
- Android has offline persistence but does not have full Desktop SQLite multi-record atomicity parity. Do not assume Desktop fixes automatically make Android safe.
- UI update feed metadata, archive names, build identifiers, hashes, and packaged version must remain consistent.

## Safety and verification

- Tests must never open, modify, migrate, reset, or delete a live user's Desktop database or Electron user-data directory. Use explicit temporary fixtures only.
- Do not modify or publish `publish-ui-out` artifacts unless the task explicitly requests a Desktop UI release.
- Run focused outbox/recovery/snapshot/sync tests from `docs/KAKAPO_TEST_MATRIX.md`. Packaging smoke scripts are version-specific and require prepared artifacts; inspect their expected version before running.
