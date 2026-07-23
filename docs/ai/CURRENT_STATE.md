# Current State

Last updated: 2026-07-23 (P0-D branch; verified against the repository)

## Baseline

- Approved `main` hash for this branch: `63eb8d3a40ab6f427f72ac54c08e02adba01e535`
  (merge of PR #17, manager-approval test clock-skew fix; includes merged
  P0-C2 void idempotency and prior security/P0 phases)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **P0-D** — Frontend financial idempotency (narrowed). Branch
  `feat/p0d-frontend-financial-idempotency`. Shared attempt infrastructure for
  all five backend financial operations; checkout UI is the only integrated
  caller. Partial-payment / refund / return / void / manager-approval UIs remain
  deferred. See `docs/security/frontend-financial-idempotency.md`.
- Parallel Codex ownership (do not modify): `feat/f1-frontend-shell-dashboard`
  (shell, sidebar, nav, header, breadcrumbs, dashboard).

## Verified counts

- Prisma migration head (main): `20260725_000000_add_order_item_return_quantity`
- Test files on approved main: **124** / tests **1266** (zero skipped)
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
- **P0-C2** — void idempotency and cross-operation concurrency (merged)
- Manager-approval test clock determinism (merged)
- Cursor plugin operating model

## Backend contracts requiring future frontend changes

- Password rotation, explicit PIN/manager selection, manager approval tokens,
  SEC-04A dedicated order routes (unchanged from prior phases).
- **P0-D (partial):** checkout now sends `Idempotency-Key` and recovers retained
  attempts. Remaining financial UIs (partial payment, refund, return, void,
  manager approval) still need product surfaces before client integration.

## Current limitations

- Frontend remains incomplete behind backend contracts.
- No offline queue or cross-tab financial-attempt coordination.
- Discount idempotency, physical historical return reconciliation tooling, and
  idempotency cleanup remain.
- SQLite only; PostgreSQL deferred.
- Legacy null-lineage return rows block further merchandise returns until
  controlled reconciliation (deferred).

## Maintenance rule

Update this file in the same branch whenever a merged task changes the
hash-relevant facts above. While on an unmerged branch, keep recorded `main`
hash at the approved baseline.
