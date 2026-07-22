# Architecture Decisions

Decisions below are proven by current source, migrations, and tests on main
(`e9507bb…`). They are constraints, not suggestions. Decisions still on an unmerged
branch are collected under "In-flight decisions" and are not yet binding on main.

## Repository and process

- **Only GroceryRMS-Web is version-controlled.** Workspace reference material lives outside Git (see `ROOT_REFERENCE_MAP.md`).
- **Backend-first implementation.** Frontend integration is a later phase requiring explicit approval.
- **Reviewed Prisma migrations only.** Migration history starts at `20260720_000000_baseline`; no production `prisma db push` (`docs/database/migration-baseline.md`).
- **Disposable SQLite test databases** under `.tmp/`, created explicitly for clean CI. `dev.db` is never touched by automation.
- **No automatic frontend changes** when backend contracts move; contract changes are documented instead.
- **Installed Cursor plugins are advisory.** Use follows `docs/ai/PLUGIN_OPERATING_MODEL.md` and `.cursor/rules/80-plugin-usage.mdc`; plugins never override AGENTS.md, tests, migrations, or stop conditions.

## Security architecture

- **Database-authoritative sessions** (`lib/security/authoritative-session.ts`): JWT alone never authorizes; every protected request validates current DB state and fails closed.
- **`authVersion` invalidation**: credential, role, permission, and account-state changes increment `authVersion` and revoke sessions in the same transaction.
- **Secure environment bootstrap** (`prisma/seed/bootstrap-admin.ts`): no seeded credentials; runs only when no admin exists.
- **Mandatory password rotation** for bootstrapped admins; central API guard denies ordinary operations while pending.
- **Versioned peppered PIN hashing** (`pin-v2$`, bcrypt over a domain-separated HMAC bound to the user ID, deployment-only `PIN_PEPPER`).
- **Explicit-user PIN verification**: `{ userId, pin }` required. **No global PIN identity** — no user lookup or manager discovery by PIN.
- **Persistent throttling**: per-user escalating lockouts plus HMAC-derived IP buckets stored in the database; aggregate history survives successes.
- **Generic external failures**: authentication errors never disclose which check failed.
- **Manager consent is a capability grant, not an inline check.** SEC-02B issues an explicit, single-use, short-lived grant (`POST /api/auth/manager-approvals`) bound to one action, one order, and the requesting session/user. See `docs/security/manager-approval-grants.md`.
- **Opaque token, digest-only storage.** The raw approval token is returned exactly once at issuance; only its SHA-256 digest is stored. Discount and void consume the grant inside the same Prisma transaction as the order mutation.
- **Layered permission model for approvals.** Requester needs the base permission at level 1; the manager needs the mapped elevated permission (`Apply discounts` ≥ 4, `Void / cancel orders` ≥ 5).
- **Self-approval preserved; dual control deferred.** A qualified requester may approve via PIN+grant; approver ≠ requester is not yet required.
- **Trusted-terminal binding is optional and deferred.** Grants store the session terminal and enforce it when present, but a trustworthy end-to-end terminal identity does not yet exist.
- **Generic order update is not a command bus.** `PUT /api/orders/{id}` `updateMeta` accepts only `notes` and `customerId`; privileged actions use dedicated endpoints (`docs/security/order-generic-update-boundary.md`).
- **Audit metadata is untrusted.** Every audit write sanitizes `oldValues` /
  `newValues` through one central pure sanitizer before Prisma persistence
  (`docs/security/audit-redaction.md`).
- **No sanitizer bypass.** Callers cannot disable redaction or mark data
  pre-sanitized. Direct `auditLog.create` outside `lib/audit.ts` is forbidden.
- **Read-time defense in depth.** Audit report APIs re-sanitize stored JSON and
  project only safe user fields, protecting historical unsafe rows without
  rewriting the database.
- **Central audit event registry** (`docs/security/audit-integrity-policy.md`).
  Every approved action has one mode (`TRANSACTION_REQUIRED`, `BEST_EFFORT`, or
  `ACCESS_ACTIVITY`); unknown actions fail closed. Callers cannot choose or
  override mode or entity table.
- **Required audits share the mutation transaction.** `writeRequiredAudit`
  rejects the root Prisma client and throws on persistence failure so mutation
  and audit commit or roll back together.
- **Best-effort and access audits remain non-blocking** for approved low-risk
  and read/print paths; raw metadata is never logged on failure.
- **High-risk free-text reasons are summarized**, not stored verbatim, in audit
  metadata (`reasonProvided` / `reasonLength`); business records keep the text.
- **Shift close is transaction-required.** Canonical actions `SHIFT_CLOSE` and
  `CLOSE_SHIFT` mutate the shift and write the required audit in one Prisma
  interactive transaction with a conditional `endedAt: null` transition.
- **Checkout and partial payment require `Idempotency-Key` (P0-A).** Raw keys are
  never stored; only SHA-256 digests. Scope uniqueness uses a non-null
  `scopeHash`. Reservation, mutation, required audit, and completed replay
  snapshot share one Prisma transaction. Matching replay does not re-run
  business logic or emit another business audit. Authoritative terminal scope
  uses `session.authoritative.terminalId` or sentinel `t:none`. Seven-day
  replay window; physical cleanup deferred. See
  `docs/security/checkout-payment-idempotency.md`.
- **Order row is the different-key concurrency boundary for checkout and
  partial payment (P0-B).** Conditional `updateMany` on `Order.status` plus
  in-transaction payment-sum remaining checks. Losing different-key requests
  create no payment, stock effect, success audit, or completed idempotency
  record. See `docs/security/order-financial-concurrency.md`.

## Money

- Amounts are **BigInt paisa** (integer, 1 PKR = 100 paisa) in the database and string paisa in API responses (`lib/paisa-math.ts`, `lib/api/serialize.ts`).

## In-flight decisions (branch `fix/p0c1-refund-return-idempotency`, not merged)

These are implemented and verified on the P0-C1 branch (base `main` `e9507bb…`)
and become binding only once merged. See
`docs/security/refund-return-idempotency.md`.

- **Refund and return require `Idempotency-Key`** with operations `order.refund`
  and `order.return`.
- **`OrderItem.returnedQuantity` is the authoritative quantity CAS counter**;
  `sourceOrderItemId` is lineage only (`onDelete: SetNull`).
- **Legacy null-lineage merchandise return rows** are not backfilled; further
  merchandise returns on affected orders are blocked until controlled
  reconciliation.
- **Monetary remaining** for refund/return-with-refund uses in-transaction
  child Refund order aggregates. Void idempotency remains deferred (P0-C2).

Do not add speculative future decisions here; record a decision as binding on main only
after it is implemented and merged.
