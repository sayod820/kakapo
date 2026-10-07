# Next API Route Instructions

These rules apply to Next.js API routes under this directory. Root `AGENTS.md` remains in force. Store-facing routes must also preserve the Store security and privacy boundaries documented for StoreApp.

## Trust and authorization boundaries

- Treat every route as a trust boundary, not a transparent backend pass-through.
- Confirm the backend route policy before proxying it. Never expose a staff, admin, cashier, or device endpoint through a public Next route for convenience.
- Preserve backend principal, session, capability, device, and self-only checks. Never invent client-side authorization or use server credentials to elevate an anonymous caller.
- A phone, name, order ID, card number, or other supplied identifier is not proof of identity or ownership.

## Payload and privacy rules

- Whitelist and validate request fields and return only the response fields required by the caller. Do not blindly forward arbitrary bodies, query parameters, headers, or backend responses.
- Do not forward credentials, bearer tokens, phone numbers, private customer fields, internal notes, cost/supplier data, or operational metadata unless the route contract explicitly requires them and authorization is established.
- Keep errors privacy-safe; do not expose backend configuration, stack traces, secrets, or unrelated records.
- Public Store routes must keep the server authoritative for price, promotion, stock, delivery, identity, order acceptance, loyalty, debt, bonus, credit, and all financial effects.

## Mutation safety

- Preserve stable `clientRef`/opRef and request-fingerprint semantics. Retry a write only when the established idempotency contract makes it safe.
- Keep proxy contracts compatible with all current callers. Coordinate request or response changes with the shared client and backend route.
- Route, public-access, auth, privacy, order, or review changes require the focused coverage identified in `docs/KAKAPO_TEST_MATRIX.md`; use only guarded lab PostgreSQL where a suite mutates data.
