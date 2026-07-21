# Architecture Decisions

Decisions below are proven by current source, migrations, and tests on main
(`4dd28a0…`). They are constraints, not suggestions. Decisions still on an unmerged
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

## Money

- Amounts are **BigInt paisa** (integer, 1 PKR = 100 paisa) in the database and string paisa in API responses (`lib/paisa-math.ts`, `lib/api/serialize.ts`).

## In-flight decisions (branch `fix/sec-04a-order-action-bypass`, not merged)

These are implemented and verified on the SEC-04A branch (base `main` `4dd28a0…`) and
become binding only once merged. See `docs/security/order-generic-update-boundary.md`.

- **Generic order update is not a command bus.** `PUT /api/orders/{id}` may perform
  level-1 item edits and a strict metadata allowlist only. It must never interpret
  note text, metadata fields, or action flags as privileged business commands.
- **Strict metadata allowlist.** `updateMeta` accepts only `notes` (verbatim plain
  text, max 2000 chars) and `customerId`. Unknown and protected fields are rejected.
- **Dedicated endpoints own privileged actions.** Discount, void, hold, recall,
  checkout, tax, adjustment, payment, refund, return, dispatch, and delivered each
  keep their own route, permission check, and (where applicable) manager approval
  grant requirement.
- **No mass assignment.** Request bodies are never spread into Prisma; the metadata
  service builds update data field-by-field from a closed typed input.
- **Breaking compatibility for unsafe clients.** Former magic note commands and
  financial `updateMeta` fields stop working; clients must migrate to dedicated
  routes. Plain notes and customer assignment remain.

Do not add speculative future decisions here; record a decision as binding on main only
after it is implemented and merged.
