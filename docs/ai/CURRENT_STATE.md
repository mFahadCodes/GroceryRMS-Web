# Current State

Last updated: 2026-07-21 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `4dd28a067b1937094878905e4832213077e86777`
  (merge of PR #8, chore/cursor-plugin-governance; includes merged SEC-02B)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **SEC-04A** — Remove authorization-bypassing order actions from the generic
  order update path. Implemented and verified on branch
  `fix/sec-04a-order-action-bypass` (base `main`
  `4dd28a067b1937094878905e4832213077e86777`); not merged. Converts
  `PUT /api/orders/{id}` `updateMeta` into a strict metadata allowlist
  (`notes`, `customerId`), removes magic note command dispatch, and rejects
  protected financial/state/approval fields. Discount and void remain on their
  dedicated grant-protected routes. See
  `docs/security/order-generic-update-boundary.md`.

## Verified counts

- Prisma migration head (main): `20260723_000000_add_manager_approval_grants`
  (history: `20260720_000000_baseline` → `20260720_010000_authoritative_sessions`
  → `20260721_000000_add_password_rotation_state` →
  `20260722_000000_add_pin_security_state` →
  `20260723_000000_add_manager_approval_grants`)
- Test files on main: **42** (all passing)
- Tests on main: **406** (all passing, zero skipped, no `.only`)
- On branch `fix/sec-04a-order-action-bypass`: no schema/migration change.
  Focused SEC-04A coverage: **7 files / 180 tests**. Verified branch totals:
  **49 test files, 586 tests, all passing, zero skipped**.
  SEC-04A adds **7 focused files and 180 tests**.
- CI: GitHub Actions workflow **"Quality Gates"** (`.github/workflows/quality-gates.yml`)
  — npm ci, prisma generate, lint, typecheck, test, build on Node 22
- Local toolchain at verification: Node v24.18.0, npm 11.16.0

## Completed phases

- **Phase 4A** — quality gates and CI
- **SEC-01A** — secure environment-driven administrator bootstrap (no fixed credentials)
- **SEC-03A** — authoritative database sessions, `authVersion` invalidation, transactional revocation
- **SEC-01B** — mandatory password rotation for bootstrapped admins, transactional password change
- **SEC-02A** — versioned peppered PIN hashing, explicit-user verification, persistent throttling and lockout
- **SEC-02B** — terminal/session-bound manager approval grants for discount and void
  (`docs/security/manager-approval-grants.md`)
- Cursor plugin operating model (`docs/ai/PLUGIN_OPERATING_MODEL.md`)

## Backend contracts requiring future frontend changes

- `POST /api/auth/change-password` and `mustChangePassword` session flag → password-rotation UI and forced redirect.
- PIN login and `POST /api/auth/validate-pin` now require `{ userId, pin }` → explicit user selection UI (anonymous quick-login payloads no longer work).
- Manager approvals require `{ managerUserId, managerPin }` → explicit manager selection UI.
- SEC-02B adds `POST /api/auth/manager-approvals` returning a one-time approval
  token that must be attached as `managerApprovalToken` to discount/void calls →
  explicit manager step-up UI plus one-time token handling
  (`docs/security/manager-approval-grants.md`).
- SEC-04A (branch, not merged): clients must stop sending magic note commands
  (`hold` / `recall` / `void:…`) or financial fields
  (`discountAmount` / `adjustment` / `discountPercent` / `taxPercent`) to
  `PUT /api/orders/{id}` `updateMeta`. Use the dedicated hold/recall/discount/
  void/tax/adjustment routes instead. Plain `notes` and `customerId` remain
  valid (`docs/security/order-generic-update-boundary.md`).

## Current limitations

- Frontend is incomplete and behind the backend contracts above.
- SEC-04A is implemented and verified on `fix/sec-04a-order-action-bypass` but
  not merged; broader SEC-04, SEC-05, and the P0 business-integrity items are
  not complete (see `SECURITY_ROADMAP.md`).
- SQLite only; PostgreSQL production migration and deployment hardening are deferred.
- Terminal-level PIN throttling is deliberately skipped until a trustworthy terminal binding exists (IP throttling is mandatory).

## Maintenance rule

Update this file in the same branch whenever a merged task changes the hash-relevant
facts above (counts, migration head, completed phases, contracts).
