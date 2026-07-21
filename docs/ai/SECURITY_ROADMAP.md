# Security and Integrity Roadmap

Last updated: 2026-07-21

## Completed (verified on main)

- **Phase 4A** — Quality gates: lint, typecheck, tests, build in CI ("Quality Gates" workflow).
- **SEC-01A** — Secure administrator bootstrap: environment-driven, no fixed credentials, existing admins preserved.
- **SEC-03A** — Authoritative sessions: `UserSession` rows, `authVersion` invalidation, fail-closed validation, transactional revocation on credential/role/permission changes.
- **SEC-01B** — Mandatory password rotation: `mustChangePassword` guard, transactional `POST /api/auth/change-password`, re-authentication required.
- **SEC-02A** — PIN hardening: versioned peppered hashing (`pin-v2$`), explicit-user verification, persistent per-user and IP-bucket throttling with escalating lockouts, manager approval by explicit identity, lockout-reset endpoint.

## In flight (implemented and verified on a branch, not merged)

- **SEC-02B** — Terminal/session-bound manager approval grants. Branch
  `fix/sec-02b-manager-approval-grants` (base `main`
  `0b45c3081a50d0904961e8d50dd6ad5697b466e1`). `POST /api/auth/manager-approvals`
  issues a single-use, action/order/requester/terminal-bound grant with a 120s TTL; the
  raw token is returned exactly once and only its SHA-256 digest is stored; discount and
  void routes consume the grant transactionally with full revalidation; opportunistic
  cleanup and cascade deletion apply. Self-approval is preserved through PIN+grant; dual
  control is deferred. The branch has 10 focused SEC-02B test files / 90 tests
  (42 files / 406 tests total, zero skipped). Do not mark complete until merged with
  passing gates. See
  `docs/security/manager-approval-grants.md`.

## Next priorities (in order)

1. **SEC-04** — Remove authorization-bypassing order action paths. Confirmed instance:
   `PUT /api/orders/{id}` `updateMeta` self-approves discounts/voids and writes
   discount/adjustment directly, bypassing the manager approval grant required by the
   dedicated discount/void routes. Discovered during SEC-02B; deferred here.
2. **SEC-05** — Audit-log secret and sensitive-data redaction.
3. **P0** — Refund/return/void idempotency.
4. **P0** — Order state and parent-child invariants.
5. **P0** — Atomic checkout and stock enforcement.
6. **P0** — Configured tax and inclusive-tax correctness.
7. **P0** — Counted shift reconciliation.
8. Production database (PostgreSQL) and deployment hardening.
9. Frontend contract integration (see deferred list in `CURRENT_STATE.md`).

## Deferred

- PostgreSQL migration and production deployment hardening (item 9) until P0/security items land.
- All frontend work, including password-rotation UI, explicit user/manager selection, and SEC-02B manager step-up / one-time approval-token UX.
- SEC-02B dual control (approver distinct from requester); self-approval remains allowed through PIN+grant.
- SEC-02B strong trusted-terminal binding until a trustworthy end-to-end terminal identity exists (grants remain session/requester bound).
- PIN recovery, history, uniqueness, expiry, and employee-switching UX (explicitly out of SEC-02A scope).
- Terminal-identity binding for terminal-level throttling.

Do not mark any item complete without a merged implementation and passing gates.
