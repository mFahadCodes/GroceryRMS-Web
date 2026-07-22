# Current State

Last updated: 2026-07-22 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `8511945cc5015e13dc6c3332d8431a1ca57c68a4`
  (merge of PR #12, fix/sec-05c-shift-close-audit-atomicity; includes merged
  SEC-02B, SEC-04A, SEC-05A, SEC-05B, and SEC-05C)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **P0-A** — Durable checkout and payment idempotency. Implemented and verified
  on branch `fix/p0a-checkout-payment-idempotency` (base `main`
  `8511945cc5015e13dc6c3332d8431a1ca57c68a4`); not merged. Protects
  `POST /api/orders/[id]/checkout` and `POST /api/orders/[id]/partial-payment`
  with durable `Idempotency-Key` records. Full payment exists only inside
  checkout. See `docs/security/checkout-payment-idempotency.md`.

## Verified counts

- Prisma migration head (main): `20260723_000000_add_manager_approval_grants`
- On branch P0-A: migration
  `20260724_000000_add_financial_idempotency_records` added
- Test files on main: **75** / tests **861** (zero skipped)
- Branch totals after full verification: **88 files / 1024 tests**
  (zero skipped, no `.only`)
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
- Cursor plugin operating model

## Backend contracts requiring future frontend changes

- Password rotation, explicit PIN/manager selection, manager approval tokens,
  SEC-04A dedicated order routes (unchanged from prior phases).
- **P0-A:** checkout and partial-payment clients must send `Idempotency-Key`
  and retry with the same key on lost responses / `IDEMPOTENCY_IN_PROGRESS`.

## Current limitations

- Frontend remains incomplete behind backend contracts.
- P0-A is on a branch, not merged. Refund/return/void idempotency, physical
  idempotency-record cleanup, remaining SEC-04 work, and other P0 items remain.
- SQLite only; PostgreSQL deferred.
- Authoritative terminal binding for idempotency uses session terminal when
  present; otherwise sentinel `t:none`.

## Maintenance rule

Update this file in the same branch whenever a merged task changes the
hash-relevant facts above.
