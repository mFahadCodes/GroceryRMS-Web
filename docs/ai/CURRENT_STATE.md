# Current State

Last updated: 2026-07-22 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `a200cb69b2c3b8192ee6ffd714f11558c1449d93`
  (merge of PR #11, fix/sec-05b-audit-integrity-policy; includes merged
  SEC-02B, SEC-04A, SEC-05A, and SEC-05B)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **SEC-05C** — Shift-close and required audit atomicity. Implemented and
  verified on branch `fix/sec-05c-shift-close-audit-atomicity` (base `main`
  `a200cb69b2c3b8192ee6ffd714f11558c1449d93`); not merged. Makes
  `SHIFT_CLOSE` / `CLOSE_SHIFT` transaction-required inside one authoritative
  close transaction with conditional concurrency protection. See
  `docs/security/shift-close-audit-atomicity.md`.

## Verified counts

- Prisma migration head (main): `20260723_000000_add_manager_approval_grants`
- Test files on main: **67** (all passing)
- Tests on main: **796** (all passing, zero skipped, no `.only`)
- On branch `fix/sec-05c-shift-close-audit-atomicity`: no schema/migration
  change. Branch totals after full verification: **75 files / 861 tests**
  (zero skipped, no `.only`). Focused SEC-05C coverage: **8 new files** plus
  expanded audit policy/coverage regression tests (~65+ focused assertions).
- Vitest `testTimeout` raised to 20s so bcrypt-heavy concurrent PIN/password
  SQLite cases finish without aborting mid-write on slower hosts.
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
  (`docs/security/audit-integrity-policy.md`)
- Cursor plugin operating model

## Backend contracts requiring future frontend changes

- Password rotation, explicit PIN/manager selection, manager approval tokens,
  SEC-04A dedicated order routes (unchanged from prior phases).
- SEC-05B/C: audit report compatibility preserved; high-risk free-text reasons
  summarized in audit metadata only.

## Current limitations

- Frontend remains incomplete behind backend contracts.
- SEC-05C is on a branch, not merged. Shift opening remains best-effort.
  Physical historical scrubbing, signing/immutability, remaining SEC-04 work,
  and P0 business-integrity items are not complete.
- SQLite only; PostgreSQL deferred.
- Terminal-level PIN throttling deferred until trustworthy terminal binding.

## Maintenance rule

Update this file in the same branch whenever a merged task changes the
hash-relevant facts above.
