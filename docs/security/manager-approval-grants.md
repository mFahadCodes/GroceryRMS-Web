# Manager approval grants backend contract (SEC-02B)

SEC-02A verified a manager PIN inline for every privileged order action but never
issued a reusable authorization. SEC-02B replaces that with an explicit, single-use,
short-lived, action- and order-bound **manager approval grant** so that a manager's
consent is captured once, bound to a specific request, and consumed atomically inside
the sensitive operation's transaction.

Status: implemented and verified on branch `fix/sec-02b-manager-approval-grants`
(base `main` `0b45c3081a50d0904961e8d50dd6ad5697b466e1`). Not merged.

## Overview of the flow

1. A logged-in operator whose session is authoritative calls
   `POST /api/auth/manager-approvals` with the target manager's identity and PIN plus
   the exact action and order to authorize.
2. The service revalidates the requester's session, revalidates the manager, verifies
   the manager PIN, and — inside a single transaction — persists a grant row keyed by a
   SHA-256 digest of a freshly generated random token and writes an issuance audit
   entry.
3. The raw token is returned to the caller exactly once in the `201` response body.
4. The operator submits the raw token as `managerApprovalToken` to
   `PATCH /api/orders/{id}/discount` or `POST /api/orders/{id}/void`. The order service
   consumes the grant transactionally as part of the discount/void mutation.

## Token secrecy

The raw approval token is generated from 32 cryptographically random bytes encoded as
base64url (a 43-character `[A-Za-z0-9_-]` string). It is returned **exactly once**, in
the body of a successful `POST /api/auth/manager-approvals` response, and never
anywhere else. It is never persisted, never logged, never written to the audit trail,
never included in any error response, and never returned by any other endpoint.

Only the SHA-256 hex digest of the token is stored (`manager_approval_grants.token_hash`,
unique). Verification and consumption re-derive the digest from the presented token and
look up by digest; the server therefore never holds the raw token at rest and cannot
reproduce it. Losing the token means the grant can only expire or be cleaned up — it
cannot be recovered.

## Request contract

`POST /api/auth/manager-approvals` requires an authoritative session and a strict JSON
body (maximum 4 KiB; oversized or unparseable bodies are treated as invalid):

```json
{
  "managerUserId": 12,
  "managerPin": "0000",
  "action": "order.discount",
  "resourceType": "order",
  "resourceId": 3456
}
```

- `managerUserId` — positive integer; the explicit manager identity to verify. There is
  no PIN-to-identity discovery.
- `managerPin` — exactly four ASCII digits.
- `action` — one of the enumerated actions (`order.discount`, `order.void`).
- `resourceType` — literally `"order"`.
- `resourceId` — positive integer order id.

Unknown fields are rejected (`strict`). A malformed body returns `VALIDATION_ERROR`
(400). If the session is not authoritative the endpoint returns
`MANAGER_APPROVAL_UNAVAILABLE` (503) without attempting verification.

A successful response is `201` with `{ approvalToken, action, resourceType, resourceId,
expiresAt }`. `expiresAt` is ISO-8601.

## Permission model

Each action maps to a base requester permission and a higher manager permission
(`lib/security/manager-approval.ts`, `MANAGER_APPROVAL_ACTION_MAP`):

| Action           | Resource | Requester permission (level) | Manager permission (level) |
| ---------------- | -------- | ---------------------------- | -------------------------- |
| `order.discount` | order    | `Apply discounts` (1)        | `Apply discounts` (4)      |
| `order.void`     | order    | `Void / cancel orders` (1)   | `Void / cancel orders` (5) |

The requester must already hold the **base** permission at level 1 to request a grant;
the manager must hold the mapped permission at the elevated access level. Permissions
are matched case-insensitively by name against active role permissions, and the stored
access level must be **greater than or equal to** the required level.

## Issuance revalidation

Issuance performs defense-in-depth revalidation and only then verifies the PIN:

1. The action configuration must exist and its `resourceType` must match the request,
   and the requester must hold the base permission — otherwise a generic failure.
2. The requester's session is loaded and validated: the `sessionId`, `userId`,
   `terminalId`, and `authVersion` must match the caller; the session must be active,
   not logged out, and unexpired; the user and role must be active, the role must be
   the user's current role, the user must not require a password change, and the
   session's `authVersion` must equal the user's `authVersion`.
3. The target order must exist.
4. The manager PIN is verified with `verifyUserPin` for the explicit `managerUserId`,
   bound to the requester session's authoritative `terminalId` and acting user id.
   Throttling surfaces `MANAGER_APPROVAL_THROTTLED` (429, with `Retry-After`);
   unavailable PIN security surfaces `MANAGER_APPROVAL_UNAVAILABLE` (503). Any other
   non-verified outcome, an identity mismatch, a manager who must change their password,
   or a manager who lacks the mapped elevated permission all collapse to a generic
   failure.

The grant row and issuance audit entry are then written inside a single transaction
that **revalidates the requester session, the manager, and the order again** and
reconfirms the verified manager identity. If any transactional recheck fails the whole
issuance aborts. The persisted grant records the requester user/session/authVersion,
the approver user/authVersion, the action, resource type/id, the required
permission/level, the session's `terminalId`, and `expiresAt`.

## Lifetime, binding, and single use

- **TTL** — a grant expires 120 seconds (`MANAGER_APPROVAL_LIFETIME_MS`) after issuance.
- **Action/order binding** — a grant is valid only for the exact `action`,
  `resourceType`, and `resourceId` recorded at issuance; the consuming call passes the
  action implicitly (the discount route consumes `order.discount`, the void route
  consumes `order.void`) and the order id from the route, and both must match the grant.
- **Requester binding** — the consuming requester's `userId` and `authVersion` must
  match the grant, and the stored requester session must still be valid with an
  unchanged `authVersion`.
- **Terminal binding** — the grant stores the requester session's `terminalId`. On
  consumption the requester session's terminal must still equal the grant's terminal;
  when the grant's terminal is non-null the caller's current `terminalId` must equal it
  as well. Because a trustworthy terminal identity is not yet available end to end (see
  SEC-02A), grants are effectively session/requester bound and the optional stronger
  trusted-terminal binding is **deferred** rather than relied upon.
- **Single use** — consumption flips `consumedAt` via a conditional `updateMany`
  guarded by `consumedAt IS NULL`, `revokedAt IS NULL`, and `expiresAt > now`. Exactly
  one row must be affected; otherwise the operation fails. This makes consumption atomic
  and replay-safe even under concurrency.

## Consumption revalidation

`consumeManagerApprovalGrant` runs **inside the caller's discount/void transaction**
(`lib/services/order-service.ts`). It:

1. Validates the action configuration and token format, then looks up the grant by
   token digest.
2. Rejects a missing grant and a revoked grant as `MANAGER_APPROVAL_INVALID` (403),
   an already-consumed grant as `MANAGER_APPROVAL_ALREADY_USED` (409), and an expired
   grant as `MANAGER_APPROVAL_EXPIRED` (403).
3. Reconfirms the exact action/resource/order binding, the requester identity and
   `authVersion`, and the required permission/level recorded on the grant.
4. Reloads and revalidates the requester session and the approver, requiring the
   session's terminal and the approver's `authVersion` to still match the grant, and
   re-checks the terminal binding described above.
5. Atomically consumes the grant and writes a `MANAGER_APPROVAL_CONSUMED` audit entry
   (actor, approver id, action, resource type, status) with no token material.

The consumed grant yields the approver id, which the order service records as the
order's `approvedByUserId` and, for stock reversals during a void, as the
`StockMovement.userId`.

## Cascade deletion semantics

`ManagerApprovalGrant` relations use `onDelete: Cascade` to the requester user, the
requester session, the approver user, the resource order, and the (optional) terminal.
Deleting any of those parents removes the dependent grant rows automatically, so a grant
never outlives the session, order, user, or terminal it depends on. This is intentional
integrity hygiene: it prevents dangling grants and keeps a consumed/expired grant from
referencing a deleted principal. Independently, expired/consumed/revoked grants are
also removed by bounded opportunistic cleanup (below).

## Self-approval and dual control

The privileged action paths still permit a requester to also act as the approver when
the same user holds the elevated permission and supplies their PIN through the grant
flow — self-approval is **preserved** through the PIN-plus-grant mechanism. True **dual
control** (requiring the approver to be a distinct principal from the requester) is
**deferred**; SEC-02B does not enforce approver ≠ requester.

## Atomic discount/void consumption and audits

Grant consumption and the discount/void mutation share one Prisma transaction, so the
grant is consumed if and only if the order mutation commits. Each privileged path writes
its own domain audit entry (`APPLY_ORDER_DISCOUNT`, `VOID_ORDER`) in addition to the
`MANAGER_APPROVAL_CONSUMED` entry, all within the same transaction. There is no window
in which a grant is consumed without the corresponding order change, or an order change
occurs without consuming its grant.

## Cleanup

`cleanupManagerApprovalGrants` opportunistically deletes grants whose `expiresAt`,
`consumedAt`, or `revokedAt` fall before a 24-hour retention cutoff
(`MANAGER_APPROVAL_CLEANUP_RETENTION_MS`), in bounded batches
(`MANAGER_APPROVAL_CLEANUP_BATCH_SIZE` = 100). It is invoked after successful issuance
and swallows its own errors so cleanup never affects the issuance result. Cascade
deletion (above) handles parent-driven removal.

## Stable error contract

External responses use stable codes and never disclose which internal check failed:

- `VALIDATION_ERROR` (400) — malformed/oversized issuance body.
- `MANAGER_APPROVAL_UNAVAILABLE` (503) — non-authoritative session or unavailable PIN
  security / token generation.
- `MANAGER_APPROVAL_THROTTLED` (429, `Retry-After`) — PIN throttling during issuance.
- `MANAGER_APPROVAL_FAILED` (403) — generic issuance failure (permission, identity,
  session, order, or PIN check).
- `MANAGER_APPROVAL_INVALID` (403) — unknown/revoked/mismatched grant or bad token on
  consumption.
- `MANAGER_APPROVAL_EXPIRED` (403) — expired grant on consumption.
- `MANAGER_APPROVAL_ALREADY_USED` (409) — grant already consumed.

Consuming routes map these to operator-facing messages ("Manager approval invalid /
expired / already used") without leaking internals.

## Frontend requirements (outstanding)

The frontend does not yet exercise this contract and must be updated:

- Add an explicit manager selection plus PIN step-up dialog that calls
  `POST /api/auth/manager-approvals` for the exact action and order.
- Capture the one-time `approvalToken` in memory only, never persist or log it, and
  attach it as `managerApprovalToken` to the immediately following discount/void call.
- Handle the stable error codes above, including the 120-second expiry (re-request on
  `MANAGER_APPROVAL_EXPIRED`), single-use `MANAGER_APPROVAL_ALREADY_USED`, and
  `Retry-After` on throttling.
- Continue to send explicit `{ managerUserId, managerPin }`; anonymous manager-PIN
  payloads are not accepted.

## Related finding: SEC-04 `updateMeta` bypass (deferred)

While implementing SEC-02B, an authorization-bypassing path was confirmed in
`PUT /api/orders/{id}` (`updateMeta` action, `app/api/orders/[id]/route.ts`). That
handler still applies discounts and voids orders with `approvedByUserId:
auth.session.user.id` (self-approval by the acting cashier) and can also set
`discountAmount`/`adjustment` directly — entirely bypassing the manager approval grant
required by the dedicated discount/void routes. This is the SEC-04 concern and is
**deferred** to that task; SEC-02B intentionally does not modify this path.

## Test coverage

The branch adds 10 focused SEC-02B test files with 90 tests (42 files / 406 tests
total, zero skipped). Coverage verifies one-time issuance-only raw-token return,
digest-only storage, 120-second expiry, action/order/requester/session/terminal
binding, user/session/manager staleness, cascade deletion, exact-one consumption under
concurrency, complete transaction rollback at every failure stage, stable errors,
bounded cleanup, and source-level secret/direct-PIN regressions.
