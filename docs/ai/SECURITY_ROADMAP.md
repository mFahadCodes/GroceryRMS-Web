# Security and Integrity Roadmap

Last updated: 2026-07-22

## Completed (verified on main)

- **Phase 4A** — Quality gates: lint, typecheck, tests, build in CI ("Quality Gates" workflow).
- **SEC-01A** — Secure administrator bootstrap: environment-driven, no fixed credentials, existing admins preserved.
- **SEC-03A** — Authoritative sessions: `UserSession` rows, `authVersion` invalidation, fail-closed validation, transactional revocation on credential/role/permission changes.
- **SEC-01B** — Mandatory password rotation: `mustChangePassword` guard, transactional `POST /api/auth/change-password`, re-authentication required.
- **SEC-02A** — PIN hardening: versioned peppered hashing (`pin-v2$`), explicit-user verification, persistent per-user and IP-bucket throttling with escalating lockouts, manager approval by explicit identity, lockout-reset endpoint.
- **SEC-02B** — Terminal/session-bound manager approval grants: one-time opaque tokens, digest-only storage, 120s TTL, transactional discount/void consumption. See `docs/security/manager-approval-grants.md`.
- **SEC-04A** — Generic order update narrowed to safe metadata; magic note command bus and financial self-approval bypasses removed. See `docs/security/order-generic-update-boundary.md`.
- **SEC-05A** — Centralized audit metadata redaction and safe audit read behavior. See `docs/security/audit-redaction.md`.
- Cursor plugin operating model and security-review templates.

## In flight (implemented and verified on a branch, not merged)

- **SEC-05B** — Audit integrity policy, explicit event metadata contracts, and
  transaction-policy standardization. Branch
  `fix/sec-05b-audit-integrity-policy` (base `main`
  `f62886916318f1fcf137b2954c88d588fa5f226b`). Central registry, controlled
  wrappers, free-text reason summarization for high-risk events, and
  same-transaction required audits for critical mutations. See
  `docs/security/audit-integrity-policy.md`. Do not mark physical historical
  scrubbing or cryptographic/tamper-evident auditing complete.

## Next priorities (in order)

1. Remaining SEC-05B follow-ups after merge — shift-close transaction redesign,
   remaining broad best-effort metadata builders, planned historical physical
   scrubbing (offline, separately approved).
2. **SEC-04 (remainder)** — Broader authorization review of remaining order
   surfaces beyond the generic update path (for example legacy
   `approvedByUserId` service overloads once callers are gone).
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
- Physical scrubbing of pre-SEC-05A audit rows; audit encryption/signing/WORM/SIEM.
- Shift close as transaction-required (requires shift-service redesign).

Do not mark any item complete without a merged implementation and passing gates.
