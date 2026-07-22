# Current State

Last updated: 2026-07-23 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `a03ae0c9a813f75b4ca42fe6dd82bc8f4862e141`
  (merge of PR #15, fix/p0c1-refund-return-idempotency; includes merged
  SEC-02B, SEC-04A, SEC-05A, SEC-05B, SEC-05C, P0-A, P0-B, and P0-C1)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **P0-C2** — Durable void idempotency and cross-operation concurrency.
  Implemented and verified on branch
  `fix/p0c2-void-idempotency-concurrency` (base `main`
  `a03ae0c9a813f75b4ca42fe6dd82bc8f4862e141`); not merged. See
  `docs/security/void-idempotency-concurrency.md`.

## Verified counts

- Prisma migration head (main): `20260725_000000_add_order_item_return_quantity`
- Test files on main: **111** / tests **1168** (zero skipped)
- Branch P0-C2 focused suite: **12** files / **86** tests (includes shared
  `idempotency-source-regression`)
- Branch totals after full `npm run test`: **122** files / **1234** tests
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
- **P0-C1** — refund/return idempotency and quantity CAS
- Cursor plugin operating model

## Backend contracts requiring future frontend changes

- Password rotation, explicit PIN/manager selection, manager approval tokens,
  SEC-04A dedicated order routes (unchanged from prior phases).
- **P0-A/P0-B:** checkout and partial-payment `Idempotency-Key` + 409 handling.
- **P0-C1:** refund and return clients must send `Idempotency-Key`; on
  financial/quantity `409` or `RETURN_HISTORY_RECONCILIATION_REQUIRED`,
  re-read order state before a new attempt.
- **P0-C2:** void clients must send `Idempotency-Key` in addition to
  `managerApprovalToken`; on void/financial `409`, re-read order state and use
  a new key for a new attempt. Replay does not need a fresh approval grant.

## Current limitations

- Frontend remains incomplete behind backend contracts.
- P0-C2 is on a branch, not merged. Discount idempotency, physical
  historical return reconciliation tooling, and idempotency cleanup remain.
- SQLite only; PostgreSQL deferred.
- Legacy null-lineage return rows block further merchandise returns until
  controlled reconciliation (deferred).

## Maintenance rule

Update this file in the same branch whenever a merged task changes the
hash-relevant facts above. While on an unmerged branch, keep recorded `main`
hash at the approved baseline.
