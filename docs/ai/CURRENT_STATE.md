# Current State

Last updated: 2026-07-22 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `e9507bb38a6ace597900793a83537eb0f19162df`
  (merge of PR #14, fix/p0b-order-financial-concurrency; includes merged
  SEC-02B, SEC-04A, SEC-05A, SEC-05B, SEC-05C, P0-A, and P0-B)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **P0-C1** — Durable refund/return idempotency and different-key monetary /
  quantity concurrency. Implemented and verified on branch
  `fix/p0c1-refund-return-idempotency` (base `main`
  `e9507bb38a6ace597900793a83537eb0f19162df`); not merged. See
  `docs/security/refund-return-idempotency.md`.

## Verified counts

- Prisma migration head (main): `20260724_000000_add_financial_idempotency_records`
- On branch P0-C1: migration
  `20260725_000000_add_order_item_return_quantity` added
- Test files on main: **98** / tests **1100** (zero skipped)
- Branch P0-C1 focused suite: **14** files / **87** tests (includes shared
  `idempotency-source-regression` coverage of the four financial ops)
- Branch totals after full `npm run test`: **111** files / **1168** tests
  (zero skipped)
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
- Cursor plugin operating model

## Backend contracts requiring future frontend changes

- Password rotation, explicit PIN/manager selection, manager approval tokens,
  SEC-04A dedicated order routes (unchanged from prior phases).
- **P0-A/P0-B:** checkout and partial-payment `Idempotency-Key` + 409 handling.
- **P0-C1:** refund and return clients must send `Idempotency-Key`; on
  financial/quantity `409` or `RETURN_HISTORY_RECONCILIATION_REQUIRED`,
  re-read order state before a new attempt.

## Current limitations

- Frontend remains incomplete behind backend contracts.
- P0-C1 is on a branch, not merged. Void idempotency (P0-C2), physical
  historical return reconciliation tooling, and idempotency cleanup remain.
- SQLite only; PostgreSQL deferred.
- Legacy null-lineage return rows block further merchandise returns until
  controlled reconciliation (deferred).

## Maintenance rule

Update this file in the same branch whenever a merged task changes the
hash-relevant facts above. While on an unmerged branch, keep recorded `main`
hash at the approved baseline.
