# Architecture Decisions

Decisions below are proven by current source, migrations, and tests on main
(`0b45c30…`). They are constraints, not suggestions. Decisions still on an unmerged
branch are collected under "In-flight decisions" and are not yet binding on main.

## Repository and process

- **Only GroceryRMS-Web is version-controlled.** Workspace reference material lives outside Git (see `ROOT_REFERENCE_MAP.md`).
- **Backend-first implementation.** Frontend integration is a later phase requiring explicit approval.
- **Reviewed Prisma migrations only.** Migration history starts at `20260720_000000_baseline`; no production `prisma db push` (`docs/database/migration-baseline.md`).
- **Disposable SQLite test databases** under `.tmp/`, created explicitly for clean CI. `dev.db` is never touched by automation.
- **No automatic frontend changes** when backend contracts move; contract changes are documented instead.

## Security architecture

- **Database-authoritative sessions** (`lib/security/authoritative-session.ts`): JWT alone never authorizes; every protected request validates current DB state and fails closed.
- **`authVersion` invalidation**: credential, role, permission, and account-state changes increment `authVersion` and revoke sessions in the same transaction.
- **Secure environment bootstrap** (`prisma/seed/bootstrap-admin.ts`): no seeded credentials; runs only when no admin exists.
- **Mandatory password rotation** for bootstrapped admins; central API guard denies ordinary operations while pending.
- **Versioned peppered PIN hashing** (`pin-v2$`, bcrypt over a domain-separated HMAC bound to the user ID, deployment-only `PIN_PEPPER`).
- **Explicit-user PIN verification**: `{ userId, pin }` required. **No global PIN identity** — no user lookup or manager discovery by PIN.
- **Persistent throttling**: per-user escalating lockouts plus HMAC-derived IP buckets stored in the database; aggregate history survives successes.
- **Generic external failures**: authentication errors never disclose which check failed.

## Money

- Amounts are **BigInt paisa** (integer, 1 PKR = 100 paisa) in the database and string paisa in API responses (`lib/paisa-math.ts`, `lib/api/serialize.ts`).

## In-flight decisions (branch `fix/sec-02b-manager-approval-grants`, not merged)

These are implemented and verified on the SEC-02B branch (base `main` `0b45c30…`) and
become binding only once merged. See `docs/security/manager-approval-grants.md`.

- **Manager consent is a capability grant, not an inline check.** SEC-02B replaces
  SEC-02A's inline manager-PIN check with an explicit, single-use, short-lived grant
  (`POST /api/auth/manager-approvals`) that is bound to one action, one order, and the
  requesting session/user.
- **Opaque token, digest-only storage.** The raw approval token (32 random bytes,
  base64url) is returned exactly once at issuance and never persisted, logged, audited,
  errored, or returned elsewhere. Only its SHA-256 digest is stored
  (`manager_approval_grants.token_hash`, unique); the server cannot reproduce the token.
- **120-second TTL** (`MANAGER_APPROVAL_LIFETIME_MS`).
- **Layered permission model.** Requester needs the base permission at level 1; the
  manager needs the mapped elevated permission (`Apply discounts` ≥ 4 for discount,
  `Void / cancel orders` ≥ 5 for void), matched case-insensitively against active role
  permissions.
- **Double revalidation and transactional issuance.** Requester session and manager are
  revalidated before PIN verification and again inside the issuance transaction; the
  grant row and issuance audit are written atomically.
- **Atomic, replay-safe consumption.** Grants are consumed inside the discount/void
  transaction via a guarded conditional update (`consumedAt IS NULL`, not revoked,
  unexpired) that must affect exactly one row, with full re-binding checks on
  action/order/requester/authVersion/terminal. Consumption and the order mutation
  commit together.
- **Cascade deletion by design.** Grant rows cascade-delete with their requester user,
  requester session, approver user, resource order, and terminal, so a grant never
  outlives its dependencies; expired/consumed/revoked grants are also cleaned up on a
  24-hour retention window in bounded batches.
- **Trusted-terminal binding is optional and deferred.** Grants store the session
  terminal and enforce it when present, but a trustworthy end-to-end terminal identity
  does not yet exist, so grants are effectively session/requester bound.
- **Self-approval preserved; dual control deferred.** A qualified requester may approve
  via PIN+grant; SEC-02B does not require the approver to differ from the requester.
- **Stable, non-disclosing error contract.** External codes
  (`MANAGER_APPROVAL_FAILED/INVALID/EXPIRED/ALREADY_USED/THROTTLED/UNAVAILABLE`,
  `VALIDATION_ERROR`) never reveal which internal check failed.
- **Known SEC-04 bypass, deferred.** `PUT /api/orders/{id}` `updateMeta` still
  self-approves discounts/voids and writes discount/adjustment directly, bypassing the
  grant; this is left for SEC-04.

Do not add speculative future decisions here; record a decision as binding on main only
after it is implemented and merged.
