# Discount idempotency and concurrency (P0-E)

P0-E adds durable same-key idempotency and different-key / cross-operation
concurrency protection for order discounts, while preserving the existing
manager-approval grant model and `calculatePaisaTotals` / product-cap formulas.

**Approved business-rule change (P0-E):** discounts are pre-payment only.
Only `Open` (unpaid) orders are discountable. Discount must be finalized
before any payment is accepted. `PartiallyPaid` and `Closed` orders cannot be
repriced through the discount endpoint. Fulfilment-stage and `Void` orders are
also ineligible. Sequential replacement (including zero reset) remains supported
**only while the order remains `Open`**. Refund and return remain the
post-payment reversal workflows — this change does not implement payment
reversal or refund behavior.

Status: implemented and verified on branch
`fix/p0e-discount-idempotency-concurrency` (base `main`
`83db9fd824c6e4ccf580a0b021b50774ea9af62e`). Not merged.

No PostgreSQL production locking verification is claimed.
No frontend discount UI was added; callers remain deferred.

## Threat model

Retries and concurrent requests can duplicate discount mutations, required
audits, and approval-grant consumption — or let discount race checkout, partial
payment, or void into contradictory totals / states.

## Protected endpoint

| Route | Method | Operation | Permission | Manager approval |
| --- | --- | --- | --- | --- |
| `/api/orders/[id]/discount` | PATCH | `order.discount` | `Apply discounts` ≥ 1 | Action `order.discount`, manager level 4 |

## Idempotency versus concurrency

| Concern | Mechanism |
| --- | --- |
| Same key retries | `IdempotencyRecord` + `executeFinancialIdempotent` |
| Different-key discount | Conditional Open + prior financial-state CAS |
| Cross-op races | Competing ops keep their own status/totals CAS; non-Open is not discountable |

## Request contract

Business body: `discountAmount` and/or `discountPercent` (one required), optional
`reason`.

Execution credential (original execution only): `managerApprovalToken`.

Header: required `Idempotency-Key`.

Business request hash includes `orderId`, `discountAmount`, `discountPercent`,
and `reason` only. `managerApprovalToken` is an execution credential and is
**never** hashed, stored in idempotency rows, audited verbatim, or returned.

## Replay before approval credential

Processing order:

1. Authenticate authoritative session and check base `Apply discounts` permission.
2. Validate `Idempotency-Key`.
3. Strictly validate the business payload used for hashing.
4. Resolve completed replay / mismatch / expiry / in-progress.
5. Matching completed replay returns stored success with
   `Idempotency-Replayed: true` and does **not** require, validate, or consume a
   manager token, and does not call `applyOrderDiscount`.
6. Payload mismatch or expired key returns the existing conflict without
   approval validation.
7. Original execution requires a valid unused `managerApprovalToken` and
   consumes the grant **after** the authoritative discount CAS succeeds inside
   the transaction.

There is no manager-PIN fallback on this route.

## Authoritative transaction

Reservation, Open-order read, prior financial-state capture, positive Open-only
discount CAS, grant consumption, existing total application, required
`APPLY_ORDER_DISCOUNT` audit, response snapshot, and idempotency completion
share one Prisma interactive transaction. The conditional mutation may run
before grant consumption because later failures roll the whole transaction back.

## Authoritative eligibility and CAS

Exact positive allowlist (single shared constant
`DISCOUNTABLE_ORDER_STATUSES`):

```ts
DISCOUNTABLE_ORDER_STATUSES = ["Open"]

updateMany({
  where: {
    id,
    status: { in: [...DISCOUNTABLE_ORDER_STATUSES] },
    discountAmount: prior.discountAmount,
    taxAmount: prior.taxAmount,
    grandTotal: prior.grandTotal,
  },
  data: {
    discountAmount: next.discountAmount,
    taxAmount: next.taxAmount,
    grandTotal: next.grandTotal,
  },
})
```

Requires `count === 1`. Zero rows → `409 ORDER_NOT_DISCOUNTABLE` (authoritative
status ineligible) or `409 ORDER_DISCOUNT_CONFLICT` (Open but prior financial
state changed). Losers create no mutation, success audit, completed idempotency
row, or consumed grant.

### Discountable

- `Open`

### Not discountable

- `PartiallyPaid`
- `Packed`
- `OutForDelivery`
- `Delivered`
- `Closed`
- `Void`

Do not reintroduce a broad negative predicate such as `status != Closed`.

## Sequential replacement

While the order remains `Open`, a later valid discount may replace an earlier
one after the client re-reads the latest financial state and starts a genuinely
new request (new key / payload) using that state. A zero discount may reset the
discount when the current validator permits it. Percentage/fixed calculations
and `calculatePaisaTotals` are unchanged.

Two different-key requests based on the **same** prior financial state: at most
one commits; the loser receives a safe conflict.

## Cross-operation behavior

- **Partial payment wins first:** order becomes `PartiallyPaid`; discount CAS
  against `Open` updates zero rows → `409`; discount grant remains unconsumed.
- **Discount wins first:** partial payment must operate on the newly discounted
  authoritative totals (existing P0-B remaining-balance protection).
- **Checkout wins first:** order becomes `Closed`; discount loses the same way.
- **Discount wins first:** checkout uses updated totals through existing P0-B
  protection, then may close.
- **Void wins first:** order becomes `Void`; discount loses.
- **Discount wins first:** order remains `Open` with updated totals; a later
  valid void may proceed under the existing Open-only void rule.
- **Refund / return:** require `Closed`; a Closed parent is never discountable;
  discount cannot alter `returnedQuantity` or `sourceOrderItemId`.

## Frontend

Frontend discount UI remains absent/deferred. Any future caller must send and
reuse `Idempotency-Key` correctly (see
`docs/security/frontend-financial-idempotency.md`). The P0-D frontend registry
still lists five operations; backend financial idempotency now includes six
(`order.discount` is server-owned).

## Explicit non-goals

- No schema / version column / migration
- No formula, rounding, tax, stock, payment, refund, or return rule changes
- No nested transactions or root Prisma writes on the protected path
- No automatic payment reversal

## Related docs

- `docs/security/manager-approval-grants.md`
- `docs/security/checkout-payment-idempotency.md`
- `docs/security/order-financial-concurrency.md`
- `docs/security/void-idempotency-concurrency.md`
- `docs/security/refund-return-idempotency.md`
- `docs/security/frontend-financial-idempotency.md`
