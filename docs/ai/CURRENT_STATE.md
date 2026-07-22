# Current State

Last updated: 2026-07-22 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `11b1a918a32ca8a453bb2735c089c02faf316172`
  (merge of PR #13, fix/p0a-checkout-payment-idempotency; includes merged
  SEC-02B, SEC-04A, SEC-05A, SEC-05B, SEC-05C, and P0-A)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **P0-B** — Order financial concurrency for different-key checkout and
  partial-payment races. Implemented and verified on branch
  `fix/p0b-order-financial-concurrency` (base `main`
  `11b1a918a32ca8a453bb2735c089c02faf316172`); not merged. See
  `docs/security/order-financial-concurrency.md`.

## Verified counts

- Prisma migration head (main): `20260724_000000_add_financial_idempotency_records`
- Test files on main: **88** / tests **1024** (zero skipped)
- Branch totals after P0-B verification: **98 files / 1100 tests**
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
- **P0-A** — durable checkout and payment idempotency
- Cursor plugin operating model

## Backend contracts requiring future frontend changes

- Password rotation, explicit PIN/manager selection, manager approval tokens,
  SEC-04A dedicated order routes (unchanged from prior phases).
- **P0-A:** checkout and partial-payment clients must send `Idempotency-Key`
  and retry with the same key on lost responses / `IDEMPOTENCY_IN_PROGRESS`.
- **P0-B:** on `409` order financial conflicts, re-read order state before
  starting a new attempt with a **new** idempotency key.

## Current limitations

- Frontend remains incomplete behind backend contracts.
- P0-B is on a branch, not merged. Refund/return/void concurrency and
  idempotency, physical idempotency-record cleanup, remaining SEC-04 work,
  and other P0 items remain.
- SQLite only; PostgreSQL deferred. P0-B does not claim PostgreSQL locking
  has been production-tested.
- Authoritative terminal binding for idempotency uses session terminal when
  present; otherwise sentinel `t:none`.
- General order locking / versioning is **not** complete—only checkout and
  partial-payment financial transitions.

## Maintenance rule

Update this file in the same branch whenever a merged task changes the
hash-relevant facts above. While on an unmerged branch, keep recorded `main`
hash at the approved baseline.
