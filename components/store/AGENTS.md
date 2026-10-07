# StoreApp Instructions

These rules apply to public StoreApp UI work in this directory. When StoreApp work touches `app/store`, `app/api`, or shared `lib` modules, apply these rules there as well in addition to the nearest filesystem instructions.

## Authority and trust boundaries

- The server is authoritative for product availability, stock, price, promotion, bulk price, weighted price, delivery fee, order total, and order acceptance.
- Never make a client-computed total canonical. Client totals are previews only; display the server response after checkout.
- Do not trust bonus, credit, VIP, loyalty, or account ownership claims without verified customer authentication. Production SMS authentication is currently deferred.
- StoreApp must not call staff-only endpoints or use staff/admin/device credentials as a shortcut.
- Guest/local state must not overwrite PostgreSQL CRM, debt, card, loyalty, order, or finance authority. A partial guest order list must not drive canonical account recalculation.

## Public privacy and checkout

- Public product/order/review payloads must be privacy-minimized. Never expose cost, supplier, margin, internal notes, other customers, unnecessary coordinates, or ownership credentials.
- Every order submission needs a stable `clientRef`. Retry only with the same reference and same semantic request; never blindly duplicate checkout after an uncertain response.
- Weighted lines must preserve the established gram-based server contract and catalog minimum/step behavior. Do not infer weight from displayed quantity or trust client price.
- Block unavailable/out-of-stock/invalid-price items in the UI, but keep the server check authoritative for races.

## Current boundaries

- K3 guest order tracking and guest review ownership are unfinished and uncommitted. Inspect and preserve the current work before changing it; do not assume the route is public or the frontend flow is complete.
- Do not reintroduce demo catalog merges, fake tracking, fake delivery times, unsupported payment/SMS claims, fixed VIP promises, or other invented commercial claims.
- Public restaurant checkout is currently disabled; do not imply it works merely because restaurant catalog data is visible.

## Verification

- Run focused Store/order/review helpers first, then the auth route tests when public access changes.
- Use `docs/KAKAPO_TEST_MATRIX.md` to select Store, orders, auth, and release regressions. Database suites must use only the guarded lab database.
