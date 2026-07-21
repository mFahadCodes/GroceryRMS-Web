# Current State

Last updated: 2026-07-21 (verified against the repository, not assumed)

## Baseline

- Current `main` hash: `a6d737918ce74b8bcecb6e3eaeea0b569a0adc05`
  (merge of PR #5, SEC-02A PIN hardening)
- Original baseline tag: `groceryrms-web-baseline-2026-07-16`
  → commit `63ee18bd33ab4013821e75899d81fc66d0f827d7`
- Remote: `https://github.com/mFahadCodes/GroceryRMS-Web.git`

## Verified counts (at the hash above)

- Prisma migration head: `20260722_000000_add_pin_security_state`
  (history: `20260720_000000_baseline` → `20260720_010000_authoritative_sessions`
  → `20260721_000000_add_password_rotation_state` → `20260722_000000_add_pin_security_state`)
- Test files: **32** (all passing)
- Tests: **316** (all passing, zero skipped, no `.only`)
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
- SEC-02B (future) will add terminal/session-bound approval grants and their UX.

## Current limitations

- Frontend is incomplete and behind the backend contracts above.
- SEC-02B, SEC-04, SEC-05 and the P0 business-integrity items are not implemented (see `SECURITY_ROADMAP.md`).
- SQLite only; PostgreSQL production migration and deployment hardening are deferred.
- Terminal-level PIN throttling is deliberately skipped until a trustworthy terminal binding exists (IP throttling is mandatory).

## Maintenance rule

Update this file in the same branch whenever a merged task changes the hash-relevant
facts above (counts, migration head, completed phases, contracts).
