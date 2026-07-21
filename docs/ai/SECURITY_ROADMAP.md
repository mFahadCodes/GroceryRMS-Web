# Security and Integrity Roadmap

Last updated: 2026-07-21

## Completed (verified on main)

- **Phase 4A** — Quality gates: lint, typecheck, tests, build in CI ("Quality Gates" workflow).
- **SEC-01A** — Secure administrator bootstrap: environment-driven, no fixed credentials, existing admins preserved.
- **SEC-03A** — Authoritative sessions: `UserSession` rows, `authVersion` invalidation, fail-closed validation, transactional revocation on credential/role/permission changes.
- **SEC-01B** — Mandatory password rotation: `mustChangePassword` guard, transactional `POST /api/auth/change-password`, re-authentication required.
- **SEC-02A** — PIN hardening: versioned peppered hashing (`pin-v2$`), explicit-user verification, persistent per-user and IP-bucket throttling with escalating lockouts, manager approval by explicit identity, lockout-reset endpoint.
- **SEC-02B** — Terminal/session-bound manager approval grants: one-time opaque tokens, digest-only storage, 120s TTL, transactional discount/void consumption. See `docs/security/manager-approval-grants.md`.
- Cursor plugin operating model and security-review templates.

## In flight (implemented and verified on a branch, not merged)

- **SEC-04A** — Remove authorization-bypassing order actions from the generic
  order update path. Branch `fix/sec-04a-order-action-bypass` (base `main`
  `4dd28a067b1937094878905e4832213077e86777`). Closes the confirmed
  `PUT /api/orders/{id}` `updateMeta` command-bus bypass: magic note commands
  (`hold` / `recall` / `void:…`), direct discount/adjustment writes, and
  self-approved discount/void paths are removed. The generic route accepts only
  a strict metadata allowlist (`notes`, `customerId`); privileged actions stay
  on dedicated endpoints with their existing permission and manager-approval
  requirements. See `docs/security/order-generic-update-boundary.md`. Do not
  mark broader SEC-04 complete until remaining order-surface review lands.

## Next priorities (in order)

1. **SEC-04 (remainder)** — Broader authorization review of remaining order
   surfaces beyond the generic update path (for example legacy
   `approvedByUserId` service overloads once callers are gone).
2. **SEC-05** — Audit-log secret and sensitive-data redaction.
3. **P0** — Refund/return/void idempotency.
4. **P0** — Order state and parent-child invariants.
5. **P0** — Atomic checkout and stock enforcement.
6. **P0** — Configured tax and inclusive-tax correctness.
7. **P0** — Counted shift reconciliation.
8. Production database (PostgreSQL) and deployment hardening.
9. Frontend contract integration (see deferred list in `CURRENT_STATE.md`).

## Deferred

- PostgreSQL migration and production deployment hardening (item 8) until P0/security items land.
- All frontend work, including password-rotation UI, explicit user/manager selection, SEC-02B manager step-up / one-time approval-token UX, and SEC-04A client migration off magic note/financial `updateMeta` fields.
- SEC-02B dual control (approver distinct from requester); self-approval remains allowed through PIN+grant.
- SEC-02B strong trusted-terminal binding until a trustworthy end-to-end terminal identity exists (grants remain session/requester bound).
- PIN recovery, history, uniqueness, expiry, and employee-switching UX (explicitly out of SEC-02A scope).
- Terminal-identity binding for terminal-level throttling.
- Consolidation of dedicated notes vs generic `updateMeta` notes into a single public API surface.

Do not mark any item complete without a merged implementation and passing gates.
