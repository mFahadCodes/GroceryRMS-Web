# Checkout and payment idempotency (P0-A)

P0-A adds a durable, transactionally enforced idempotency boundary for actual
checkout and partial-payment mutations. Full payment is created inside checkout;
there is no separate full-payment API route.

Status: implemented and verified on branch
`fix/p0a-checkout-payment-idempotency`; merged to `main` as
`11b1a918a32ca8a453bb2735c089c02faf316172`. Different-key order races are covered
by P0-B (see `docs/security/order-financial-concurrency.md`).

## Threat model

Without durable idempotency, retries from double-clicks, network timeouts, lost
responses, or concurrent clients can create duplicate payments, stock movements,
order transitions, drawer effects, and required audits.

## Protected endpoints

| Route | Method | Operation ID | Permission |
| --- | --- | --- | --- |
| `/api/orders/[id]/checkout` | POST | `order.checkout` | `PROCESS_PAYMENTS` **and** `CREATE_ORDERS` (≥1) |
| `/api/orders/[id]/partial-payment` | POST | `order.partial-payment` | `PROCESS_PAYMENTS` **or** `CREATE_ORDERS` (≥1) |

There is no separate `order.payment` operation: checkout creates `Paid` payment
rows atomically with order completion.

## `Idempotency-Key` contract

- Header name: `Idempotency-Key` (required; not optional).
- Exactly one value; commas / joined values rejected.
- Length 16–128 characters.
- Allowlist: `A–Z a–z 0–9 . _ : -` (no whitespace or control characters).
- No body or query fallback; the server never generates a key for the client.
- Recommended client values: UUIDv4/v7 or ≥128-bit opaque random strings.

Errors:

| Condition | HTTP | Code |
| --- | --- | --- |
| Missing key | 400 | `IDEMPOTENCY_KEY_MISSING` |
| Invalid key | 400 | `IDEMPOTENCY_KEY_INVALID` |
| Same scoped key, different payload | 409 | `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| Replay window expired | 409 | `IDEMPOTENCY_KEY_EXPIRED` |
| Concurrent in-progress reservation | 409 | `IDEMPOTENCY_IN_PROGRESS` |

Successful responses add `Idempotency-Replayed: false|true`. The raw key is never
echoed. Digests, scope hashes, and record IDs are never returned.

## Raw-key handling

The raw key is parsed and immediately hashed with SHA-256 (hex). Only the digest
is stored. Raw keys are never logged, audited, or returned.

## Scope binding

Versioned scope hash (`v1`) over length-prefixed fields:

- Actor user ID (authoritative session)
- Terminal scope: `t:{id}` from `session.authoritative.terminalId`, or sentinel
  `t:none` when no authoritative terminal exists
- Operation (`order.checkout` / `order.partial-payment`)
- Resource type (`orders`) and resource ID (route order id)
- Key digest

Request body `terminalId` may still drive business shift selection for checkout
(unchanged formulas) but **cannot** alter the idempotency scope. Callers cannot
choose the operation name.

## Request canonicalization

Request digests hash a versioned envelope of the strict validated DTO plus
operation/resource identity. Object keys are sorted recursively; array order is
preserved; `bigint` values are typed; absent fields differ from `null`, `0`, and
`false`. Headers, cookies, authorization, and server timestamps are excluded.

## Durable model

Prisma model `IdempotencyRecord` → table `idempotency_records`:

- Unique non-null `scope_hash` (SQLite-safe; no nullable unique terminal column)
- `key_digest`, `request_hash`, operation, resource, actor, `terminal_scope`
- State `IN_PROGRESS` | `COMPLETED`
- Successful `response_status` + bounded `response_body` (≤ 32 KiB UTF-8 JSON envelope)
- `completed_at`, `expires_at` (indexed)
- No foreign keys (deletion of users/orders/sessions/terminals is never blocked)

Migration: `20260724_000000_add_financial_idempotency_records`.

## Transaction boundary

`executeFinancialIdempotent`:

1. Hash key and request outside the financial transaction.
2. Replay immediately when a matching completed record is within the window.
3. Otherwise begin one Prisma interactive transaction.
4. Insert `IN_PROGRESS` (unique `scope_hash` is the race boundary).
5. Run the business mutation + required audit on the same transaction client.
6. Store the safe response snapshot and mark `COMPLETED` with expiry.
7. Commit once.

On unique conflict: load the existing record and replay or return a stable
conflict. The mutation is never re-executed after a unique conflict.

Failed or rolled-back attempts leave no completed row; the same key may retry.

## Replay and expiry

- Replay guarantee: **7 days** from successful completion
  (`IDEMPOTENCY_REPLAY_WINDOW_MS`).
- Matching replay returns the stored envelope without re-running business logic
  or emitting another business audit.
- After expiry: stable `409 IDEMPOTENCY_KEY_EXPIRED`; the operation is **not**
  executed again. The row remains collision-protecting until an approved cleanup
  job (deferred) removes it.
- Clients must use a fresh key for each new business operation.

## Concurrency

At most one concurrent mutation succeeds per scope. Matching losers receive a
replay (if completed) or `IDEMPOTENCY_IN_PROGRESS` (retry with the same key).
Mismatched concurrent payloads never mutate.

SQLite serializes writers; the unique scope hash remains the integrity guarantee
for **same-key** races.

**Different-key** races on the same order are handled by P0-B order financial
concurrency (`docs/security/order-financial-concurrency.md`): conditional order
status transitions and in-transaction remaining-balance checks. Idempotency
alone does not authorize duplicate checkout or overpayment.

## Audit integration

Original success: existing `CHECKOUT` / `PARTIAL_PAYMENT` required audits stay
inside the same transaction. Audit failure rolls back mutation and idempotency
row. Replay emits no second business audit. Idempotency digests never enter audit
metadata.

## Frontend requirements (deferred implementation)

- Generate a new idempotency key per distinct checkout/partial-payment attempt.
- Send it on every try/retry of that attempt.
- On `IDEMPOTENCY_IN_PROGRESS`, retry with the **same** key.
- On `IDEMPOTENCY_KEY_EXPIRED` / payload mismatch, inspect business state before
  starting a new operation with a new key.
- No frontend code is changed in this branch.

## Deferred

- Physical purge/cleanup of expired rows
- Discount idempotency
- General API idempotency middleware
- Redis / distributed locks
- Refund/return idempotency — **done in P0-C1**
  (`docs/security/refund-return-idempotency.md`)
- Void idempotency — **done in P0-C2**
  (`docs/security/void-idempotency-concurrency.md`)
- Stronger checkout row-locking for different-key concurrency — **done in P0-B**
  (`docs/security/order-financial-concurrency.md`)
