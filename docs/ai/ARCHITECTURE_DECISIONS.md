# Architecture Decisions

Decisions below are proven by current source, migrations, and tests on main
(`a6d7379…`). They are constraints, not suggestions.

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

Do not add speculative future decisions here; record a decision only after it is
implemented and merged.
