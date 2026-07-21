# Security and Integrity Roadmap

Last updated: 2026-07-21

## Completed (verified on main)

- **Phase 4A** — Quality gates: lint, typecheck, tests, build in CI ("Quality Gates" workflow).
- **SEC-01A** — Secure administrator bootstrap: environment-driven, no fixed credentials, existing admins preserved.
- **SEC-03A** — Authoritative sessions: `UserSession` rows, `authVersion` invalidation, fail-closed validation, transactional revocation on credential/role/permission changes.
- **SEC-01B** — Mandatory password rotation: `mustChangePassword` guard, transactional `POST /api/auth/change-password`, re-authentication required.
- **SEC-02A** — PIN hardening: versioned peppered hashing (`pin-v2$`), explicit-user verification, persistent per-user and IP-bucket throttling with escalating lockouts, manager approval by explicit identity, lockout-reset endpoint.

## Next priorities (in order — none started)

1. **SEC-02B** — Terminal/session-bound manager approval grants (step-up sessions, action/order-bound grants, replay prevention, grant consumption).
2. **SEC-04** — Remove authorization-bypassing order action paths.
3. **SEC-05** — Audit-log secret and sensitive-data redaction.
4. **P0** — Refund/return/void idempotency.
5. **P0** — Order state and parent-child invariants.
6. **P0** — Atomic checkout and stock enforcement.
7. **P0** — Configured tax and inclusive-tax correctness.
8. **P0** — Counted shift reconciliation.
9. Production database (PostgreSQL) and deployment hardening.
10. Frontend contract integration (see deferred list in `CURRENT_STATE.md`).

## Deferred

- PostgreSQL migration and production deployment hardening (item 9) until P0/security items land.
- All frontend work, including password-rotation UI, explicit user/manager selection, and SEC-02B UX.
- PIN recovery, history, uniqueness, expiry, and employee-switching UX (explicitly out of SEC-02A scope).
- Terminal-identity binding for terminal-level throttling.

Do not mark any item complete without a merged implementation and passing gates.
