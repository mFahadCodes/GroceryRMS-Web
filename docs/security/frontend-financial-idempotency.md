# Frontend financial idempotency (P0-D)

P0-D adds browser-side attempt lifecycle support for the five backend financial
operations protected by durable `Idempotency-Key` handling (P0-A / P0-B / P0-C1 /
P0-C2).

Status: implemented on branch `feat/p0d-frontend-financial-idempotency`.

## Scope

| Area | Status |
| --- | --- |
| Shared attempt infrastructure | Implemented |
| Cryptographic key generation | Implemented |
| Typed registry for all five operations | Implemented |
| Deterministic business fingerprints | Implemented |
| Versioned `sessionStorage` attempt records | Implemented |
| Controlled financial request executor | Implemented |
| Checkout UI integration | Implemented |
| Checkout page-refresh recovery | Implemented |
| Partial-payment / refund / return / void UI | **Deferred** |
| Manager-approval UI | **Deferred** |
| Offline queue | **Not in scope** |
| Cross-tab coordination | **Not in scope** |

Checkout (`components/pos/CheckoutDialog.tsx`) is the only integrated frontend
financial caller in this phase. Shared contracts and executor support exist for
`order.partial-payment`, `order.refund`, `order.return`, and `order.void`, but no
placeholder React screens were added for those workflows.

## Key generation

`createFinancialIdempotencyKey()`:

- Prefers `crypto.randomUUID()`
- Falls back to `crypto.getRandomValues()` with ≥16 bytes (≥128 bits)
- Emits backend-safe characters (`A–Z a–z 0–9 . _ : -`, length 16–128)
- Fails closed when Web Crypto random APIs are unavailable
- Never uses insecure PRNGs, timestamps-only values, or embedded order/payment identity
- Minted once per genuinely new attempt — never on render or inside a retry loop

## Operation registry

Allowed operations only:

- `order.checkout`
- `order.partial-payment`
- `order.refund`
- `order.return`
- `order.void`

Each operation has a typed business DTO builder and request-body serializer.
Execution credentials (void `managerApprovalToken`) are supplied separately and
are never fingerprinted or stored.

## Fingerprints

Client fingerprints are SHA-256 digests over a versioned envelope of
mutation-relevant business fields (canonicalized with sorted object keys and
bigint tags). Excluded from fingerprints:

- `managerApprovalToken` / PIN / manager identity
- Idempotency key
- Authorization, cookies, sessions
- Client user/terminal identity beyond business DTO fields required by the route
- Timestamps and UI-only fields

Void fingerprints include `reason` and `reverseStock` only.

## Attempt storage

Versioned `sessionStorage` records (`groceryrms.financial-attempt.v1`) store only:

- version
- operation
- resource / order id
- raw idempotency key (required for same-key retry)
- business fingerprint
- created / last-attempt timestamps
- pending or uncertain state
- bounded retry count

They do **not** store full request bodies, payment details, refund/return
payloads, customer data, response bodies, manager credentials, auth/session
material, headers, or error stacks.

Maximum retention is seven days. Malformed, expired, unknown-operation, or
wrong-resource records are rejected and removed safely. SSR / missing
`sessionStorage` is a no-op read/write.

## Executor and lifecycle

`executeFinancialAttempt`:

- Accepts only registered financial operations
- Injects `Idempotency-Key` only on that protected request (no global interceptor)
- Keeps credentials separate from business payload
- Reuses the same key for same-fingerprint retries
- Deduplicates simultaneous submissions with a synchronous in-flight lock
- Preserves existing `apiFetch` authentication and error conventions
- Never logs or renders the raw key

Uncertainty (network failure, abort, timeout, unknown 5xx, `IDEMPOTENCY_IN_PROGRESS`)
preserves the attempt for same-key retry. Successful completion clears storage.
Payload mismatch / key expiry retain the attempt and require explicit
reconciliation — they never mint a replacement key. Other business `409`
responses clear the attempt and require refreshing authoritative order state
before a new attempt.

Changed payloads cannot reuse a retained uncertain key; operators must abandon
or reconcile first.

## Checkout integration

- One key per new checkout attempt after the order id exists
- Double-click / duplicate keyboard submit share one in-flight request
- Submit controls are disabled/busy while in flight (`aria-busy`)
- Page refresh restores retained pending/uncertain state and does **not**
  auto-submit
- Explicit retry, order-status refresh, or abandonment is required before a new
  key / new sale
- Existing totals, receipt printing, navigation, and styling remain unchanged

## Deferred UI

Do not invent frontend screens for partial payment, refund, return, void, or
manager approval until those product surfaces exist. Future integrations should
reuse `lib/financial-idempotency/*` without widening key generation or storage
contents.
