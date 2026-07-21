# Current State

Last updated: 2026-07-21 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `bdd731f129fbd412a77ca83eeee37d0d2fab64b0`
  (merge of PR #9, fix/sec-04a-order-action-bypass; includes merged SEC-02B and SEC-04A)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## In-flight (not merged)

- **SEC-05A** — Centralized audit-log redaction, bounded metadata serialization,
  and safe audit read behavior. Implemented and verified on branch
  `fix/sec-05a-audit-redaction` (base `main`
  `bdd731f129fbd412a77ca83eeee37d0d2fab64b0`); not merged. Adds
  `lib/security/audit-sanitizer.ts`, write-boundary enforcement in `lib/audit.ts`,
  security-event metadata builders, and read-time redaction in
  `getAuditLogReport`. See `docs/security/audit-redaction.md`.

## Verified counts

- Prisma migration head (main): `20260723_000000_add_manager_approval_grants`
  (history: `20260720_000000_baseline` → `20260720_010000_authoritative_sessions`
  → `20260721_000000_add_password_rotation_state` →
  `20260722_000000_add_pin_security_state` →
  `20260723_000000_add_manager_approval_grants`)
- Test files on main: **49** (all passing)
- Tests on main: **586** (all passing, zero skipped, no `.only`)
- On branch `fix/sec-05a-audit-redaction`: no schema/migration change.
  Focused SEC-05A coverage: **9 files / 107 tests**. Verified branch totals:
  **58 test files, 693 tests, all passing, zero skipped**.
  SEC-05A adds **9 focused files and 107 tests**.
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
- **SEC-04A** — generic order update narrowed to safe metadata; magic command bus removed
  (`docs/security/order-generic-update-boundary.md`)
- Cursor plugin operating model (`docs/ai/PLUGIN_OPERATING_MODEL.md`)

## Backend contracts requiring future frontend changes

- `POST /api/auth/change-password` and `mustChangePassword` session flag → password-rotation UI and forced redirect.
- PIN login and `POST /api/auth/validate-pin` now require `{ userId, pin }` → explicit user selection UI (anonymous quick-login payloads no longer work).
- Manager approvals require `{ managerUserId, managerPin }` → explicit manager selection UI.
- SEC-02B adds `POST /api/auth/manager-approvals` returning a one-time approval
  token that must be attached as `managerApprovalToken` to discount/void calls →
  explicit manager step-up UI plus one-time token handling
  (`docs/security/manager-approval-grants.md`).
- SEC-04A: clients must stop sending magic note commands or financial fields to
  `PUT /api/orders/{id}` `updateMeta`; use dedicated routes instead
  (`docs/security/order-generic-update-boundary.md`).
- SEC-05A (branch, not merged): audit report responses continue to use the same
  envelope, but `oldValues` / `newValues` are sanitized strings and related user
  objects expose only `id` / `username` / `fullName`
  (`docs/security/audit-redaction.md`).

## Current limitations

- Frontend is incomplete and behind the backend contracts above.
- SEC-05A is implemented and verified on `fix/sec-05a-audit-redaction` but not
  merged; SEC-05B (audit transaction-policy standardization and historical
  physical scrubbing), remaining SEC-04 work, and P0 business-integrity items
  are not complete (see `SECURITY_ROADMAP.md`).
- SQLite only; PostgreSQL production migration and deployment hardening are deferred.
- Terminal-level PIN throttling is deliberately skipped until a trustworthy terminal binding exists (IP throttling is mandatory).

## Maintenance rule

Update this file in the same branch whenever a merged task changes the hash-relevant
facts above (counts, migration head, completed phases, contracts).
