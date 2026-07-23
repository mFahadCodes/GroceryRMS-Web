# Security and Integrity Roadmap

Last updated: 2026-07-23

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
- **P0-B** — Order financial concurrency for different-key checkout and
  partial payment. See `docs/security/order-financial-concurrency.md`.
- **P0-C1** — Refund/return idempotency, monetary remaining, and source-line
  quantity CAS. See `docs/security/refund-return-idempotency.md`.
- Cursor plugin operating model and security-review templates.

## In flight (implemented and verified on a branch, not merged)

- **P0-D** — Frontend financial idempotency (narrowed). Branch
  `feat/p0d-frontend-financial-idempotency` (base `main`
  `63eb8d3a40ab6f427f72ac54c08e02adba01e535`). Checkout is the only integrated
  UI; shared contracts cover all five financial operations. See
  `docs/security/frontend-financial-idempotency.md`.

## Next priorities (in order)

1. Remaining audit follow-ups — broad best-effort metadata builders, planned
   historical physical scrubbing (offline, separately approved).
2. **SEC-04 (remainder)** — Broader authorization review of remaining order
   surfaces beyond the generic update path.
3. Discount idempotency / concurrency (if still required after void).
4. **P0** — Order state and parent-child invariants.
5. **P0** — Configured tax and inclusive-tax correctness.
6. **P0** — Counted shift reconciliation (beyond close atomicity).
7. Production database (PostgreSQL) and deployment hardening.
8. Remaining frontend financial UIs (partial payment, refund, return, void,
   manager-approval) using `lib/financial-idempotency`.
9. Controlled historical return-lineage reconciliation tooling.

## Deferred

- PostgreSQL migration and production deployment hardening until P0/security items land.
- Frontend screens for partial payment, refund, return, void, and manager approval
  (P0-D infrastructure only; no placeholder workflows).
- Password-rotation UI, explicit user/manager selection, and other non-financial
  frontend contract surfaces.
- Physical purge of expired idempotency records.
- SEC-02B dual control; self-approval remains allowed through PIN+grant.
- SEC-02B strong trusted-terminal binding.
- PIN recovery, history, uniqueness, expiry, and employee-switching UX.
- Terminal-identity binding for terminal-level throttling.
- Consolidation of dedicated notes vs generic `updateMeta` notes.
- Physical scrubbing of pre-SEC-05A audit rows; audit encryption/signing/WORM/SIEM.
- Shift opening as transaction-required (close is SEC-05C).
- General order versioning / distributed locks / Redis.
- Schema `paidAmount` / `version` columns (not required for P0-B/P0-C2).
- Offline financial queues and cross-tab attempt coordination.

Do not mark any item complete without a merged implementation and passing gates.
