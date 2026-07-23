# Current State

Last updated: 2026-07-24 (P0-E branch; verified against the repository)

## Baseline

- Approved `main` hash for this branch: `83db9fd824c6e4ccf580a0b021b50774ea9af62e`
  (merge of PR #19, frontend shell/dashboard; includes prior security/P0 phases)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **P0-E** — Discount idempotency and Open-only financial concurrency. Branch
  `fix/p0e-discount-idempotency-concurrency`. Operation `order.discount` on
  `PATCH /api/orders/[id]/discount`. Approved business rule: discounts are
  pre-payment / `Open` only. Frontend discount UI remains deferred. See
  `docs/security/discount-idempotency-concurrency.md`.

## Verified counts

- Prisma migration head (main): `20260725_000000_add_order_item_return_quantity`
- Focused P0-E coverage: **14 files / 94 tests** (discount suites)
- Verified branch totals: **156 test files / 1526 tests**, all passing, zero skipped
- CI: GitHub Actions workflow **"Quality Gates"**
- Local toolchain at verification: Node v24.18.0, npm 11.16.0

## Completed phases

- **Phase 4A** — quality gates and CI
- **SEC-01A** — secure administrator bootstrap
- **SEC-03A** — authoritative database sessions
- **SEC-01B** — mandatory password rotation
- **SEC-02A** — PIN hardening and throttling
- **SEC-02B** — manager approval grants
- **SEC-04A** — generic order update boundary
- **SEC-05A** — audit metadata redaction
- **SEC-05B** — audit integrity policy and transactional required audits
- **SEC-05C** — shift-close and required audit atomicity
- **P0-A** — durable checkout and payment idempotency
- **P0-B** — order financial concurrency (different-key checkout/payment)
- **P0-C1** — refund/return idempotency and quantity CAS
- **P0-C2** — void idempotency and cross-operation concurrency
- Manager-approval test clock determinism
- Frontend shell/dashboard (F1)
- Cursor plugin operating model

## Backend contracts requiring future frontend changes

- Password rotation, explicit PIN/manager selection, manager approval tokens,
  SEC-04A dedicated order routes (unchanged from prior phases).
- Financial UIs for partial payment, refund, return, void, discount, and
  manager approval still need product surfaces before client integration.
  Checkout already sends `Idempotency-Key` (P0-D merged or pending per main).

## Current limitations

- Frontend remains incomplete behind backend contracts.
- No offline queue or cross-tab financial-attempt coordination.
- Physical historical return reconciliation tooling and idempotency cleanup
  remain.
- SQLite only; PostgreSQL deferred.
- Legacy null-lineage return rows block further merchandise returns until
  controlled reconciliation (deferred).

## Maintenance rule

Update this file in the same branch whenever a merged task changes the
hash-relevant facts above. While on an unmerged branch, keep recorded `main`
hash at the approved baseline.
