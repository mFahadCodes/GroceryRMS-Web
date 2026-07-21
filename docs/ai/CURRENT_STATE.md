# Current State

Last updated: 2026-07-21 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `0b45c3081a50d0904961e8d50dd6ad5697b466e1`
  (merge of PR #6, chore/cursor-workspace-migration)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **SEC-02B** — Terminal/session-bound manager approval grants. Implemented and
  verified on branch `fix/sec-02b-manager-approval-grants` (base `main`
  `0b45c3081a50d0904961e8d50dd6ad5697b466e1`); not merged. Adds
  `POST /api/auth/manager-approvals` (one-time raw token, SHA-256 digest stored, 120s
  TTL, action/order/requester/terminal-bound single-use grants) and transactional grant
  consumption inside the discount/void order paths. Discovered a SEC-04 `updateMeta`
  self-approval bypass in `PUT /api/orders/{id}` (deferred to SEC-04). See
  `docs/security/manager-approval-grants.md`.

## Verified counts

- Prisma migration head (main): `20260722_000000_add_pin_security_state`
  (history: `20260720_000000_baseline` → `20260720_010000_authoritative_sessions`
  → `20260721_000000_add_password_rotation_state` → `20260722_000000_add_pin_security_state`)
- Test files: **32** (all passing)
- Tests: **316** (all passing, zero skipped, no `.only`)
- On branch `fix/sec-02b-manager-approval-grants`: adds migration
  `20260723_000000_add_manager_approval_grants` (manager_approval_grants table).
  Verified branch totals: **42 test files, 406 tests, all passing, zero skipped**.
  SEC-02B adds **10 focused files and 90 tests**.
- CI: GitHub Actions workflow **"Quality Gates"** (`.github/workflows/quality-gates.yml`)
  — npm ci, prisma generate, lint, typecheck, test, build on Node 22
- Local toolchain at verification: Node v24.18.0, npm 11.16.0

## Completed phases

- **Phase 4A** — quality gates and CI
- **SEC-01A** — secure environment-driven administrator bootstrap (no fixed credentials)
- **SEC-03A** — authoritative database sessions, `authVersion` invalidation, transactional revocation
- **SEC-01B** — mandatory password rotation for bootstrapped admins, transactional password change
- **SEC-02A** — versioned peppered PIN hashing, explicit-user verification, persistent throttling and lockout

## Backend contracts requiring future frontend changes

- `POST /api/auth/change-password` and `mustChangePassword` session flag → password-rotation UI and forced redirect.
- PIN login and `POST /api/auth/validate-pin` now require `{ userId, pin }` → explicit user selection UI (anonymous quick-login payloads no longer work).
- Manager approvals require `{ managerUserId, managerPin }` → explicit manager selection UI.
- SEC-02B (branch, not merged) adds `POST /api/auth/manager-approvals` returning a
  one-time approval token that must be attached as `managerApprovalToken` to the
  discount/void calls → explicit manager step-up UI plus one-time token handling
  (`docs/security/manager-approval-grants.md`).

## Current limitations

- Frontend is incomplete and behind the backend contracts above.
- SEC-02B is implemented and verified on `fix/sec-02b-manager-approval-grants` but not
  merged; SEC-04, SEC-05 and the P0 business-integrity items are not implemented (see
  `SECURITY_ROADMAP.md`).
- A SEC-04 authorization bypass is confirmed: `PUT /api/orders/{id}` `updateMeta`
  self-approves discounts/voids and sets discount/adjustment directly, sidestepping the
  manager approval grant. Deferred to SEC-04.
- SQLite only; PostgreSQL production migration and deployment hardening are deferred.
- Terminal-level PIN throttling is deliberately skipped until a trustworthy terminal binding exists (IP throttling is mandatory).

## Maintenance rule

Update this file in the same branch whenever a merged task changes the hash-relevant
facts above (counts, migration head, completed phases, contracts).
