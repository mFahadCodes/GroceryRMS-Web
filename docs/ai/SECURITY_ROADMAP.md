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
- **SEC-05B** — Audit integrity policy, explicit event metadata contracts, and transaction-policy standardization. See `docs/security/audit-integrity-policy.md`.
- **SEC-05C** — Shift-close and required audit atomicity. See `docs/security/shift-close-audit-atomicity.md`.
- **P0-A** — Durable checkout and payment idempotency. See `docs/security/checkout-payment-idempotency.md`.
- Cursor plugin operating model and security-review templates.

## In flight (implemented and verified on a branch, not merged)

- **P0-B** — Order financial concurrency for different-key checkout and
  partial-payment races. Branch `fix/p0b-order-financial-concurrency` (base
  `main` `11b1a918a32ca8a453bb2735c089c02faf316172`). Conditional order status
  transitions, in-transaction remaining-balance checks, no schema change. See
  `docs/security/order-financial-concurrency.md`.

## Next priorities (in order)

1. Remaining audit follow-ups — broad best-effort metadata builders, planned
   historical physical scrubbing (offline, separately approved).
2. **SEC-04 (remainder)** — Broader authorization review of remaining order
   surfaces beyond the generic update path.
3. **P0** — Refund/return/void idempotency and concurrency.
4. **P0** — Order state and parent-child invariants.
5. **P0** — Configured tax and inclusive-tax correctness.
6. **P0** — Counted shift reconciliation (beyond close atomicity).
7. Production database (PostgreSQL) and deployment hardening.
8. Frontend contract integration (Idempotency-Key UX and 409 financial-conflict handling).

## Deferred

- PostgreSQL migration and production deployment hardening until P0/security items land.
- All frontend work (password-rotation UI, explicit user/manager selection, SEC-02B token UX, SEC-04A client migration, P0-A/P0-B key and conflict UX).
- Physical purge of expired idempotency records.
- SEC-02B dual control; self-approval remains allowed through PIN+grant.
- SEC-02B strong trusted-terminal binding.
- PIN recovery, history, uniqueness, expiry, and employee-switching UX.
- Terminal-identity binding for terminal-level throttling.
- Consolidation of dedicated notes vs generic `updateMeta` notes.
- Physical scrubbing of pre-SEC-05A audit rows; audit encryption/signing/WORM/SIEM.
- Shift opening as transaction-required (close is SEC-05C).
- General order versioning / distributed locks / Redis.
- Schema `paidAmount` / `version` columns (not required for P0-B).

Do not mark any item complete without a merged implementation and passing gates.
