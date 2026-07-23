# Void idempotency and concurrency (P0-C2)

P0-C2 adds durable same-key idempotency and different-key / cross-operation
concurrency protection for order voids, while preserving the existing
manager-approval grant model.

**Approved business-rule change (P0-C2):** void is a pre-finalization cancellation.
Only `Open` and `PartiallyPaid` orders are voidable. `Closed` orders use refund/return.
`Packed`, `OutForDelivery`, and `Delivered` are not voidable through this endpoint.

Status: implemented and verified on branch
`fix/p0c2-void-idempotency-concurrency` (base `main`
`a03ae0c9a813f75b4ca42fe6dd82bc8f4862e141`). Not merged.

No PostgreSQL production locking verification is claimed.

## Threat model

Retries and concurrent requests can duplicate void transitions, stock
reversals, required audits, and approval-grant consumption — or let void race
checkout, partial payment, refund, or return into contradictory states.

## Protected endpoint

| Route | Method | Operation | Permission | Manager approval |
| --- | --- | --- | --- | --- |
| `/api/orders/[id]/void` | POST | `order.void` | `Void / cancel orders` ≥ 1 | Action `order.void`, manager level 5 |

## Idempotency versus concurrency

| Concern | Mechanism |
| --- | --- |
| Same key retries | `IdempotencyRecord` + `executeFinancialIdempotent` |
| Different-key void | Conditional `Order.status` CAS (`Open\|PartiallyPaid` → `Void`) |
| Cross-op races | Competing ops keep their own status CAS; Closed/fulfilment are not voidable |

## Request contract

Business body: `reason`, optional `reverseStock`.

Execution credential (original execution only): `managerApprovalToken`.

Header: required `Idempotency-Key`.

Business request hash includes `orderId`, `reason`, and `reverseStock` only.
`managerApprovalToken` is an execution credential and is **never** hashed,
stored in idempotency rows, audited, or returned.

## Replay before approval credential

Processing order:

1. Authenticate authoritative session and check base void permission.
2. Validate `Idempotency-Key`.
3. Strictly validate the business payload used for hashing.
4. Resolve completed replay / mismatch / expiry.
5. Matching completed replay returns stored success with
   `Idempotency-Replayed: true` and does **not** require, validate, or consume a
   manager token, and does not call `voidOrder`.
6. Payload mismatch or expired key returns the existing conflict without
   approval validation.
7. Original execution requires a valid unused `managerApprovalToken` and
   consumes the grant inside the authoritative transaction.

There is no manager-PIN fallback.

## Authoritative transaction

Reservation, order re-read, grant consumption, `claimVoidTransition`, item
voiding, optional stock reverse, required `VOID_ORDER` audit, response
snapshot, and idempotency completion share one Prisma interactive transaction.

## Conditional void claim

Exact positive allowlist (shared by validation and CAS):

```ts
updateMany({
  where: {
    id,
    status: { in: ["Open", "PartiallyPaid"] },
  },
  data: { status: "Void", voidReason, approvedByUserId },
})
```

Requires `count === 1`. Zero rows → `409 ORDER_NOT_VOIDABLE` (authoritative
state ineligible) or `409 ORDER_VOID_CONFLICT` (eligible state changed
concurrently). Losers create no mutation, stock effect, success audit,
completed idempotency row, or consumed grant.

### Voidable

- `Open`
- `PartiallyPaid`

### Not voidable

- `Packed`
- `OutForDelivery`
- `Delivered`
- `Closed`
- `Void`

## Cross-operation behavior

- **Checkout / final partial payment wins:** order becomes `Closed`; void CAS
  updates zero rows → `409`; void grant remains unconsumed; no void audit,
  effect, or completed void idempotency row.
- **Refund / return wins:** parent remains `Closed`; void loses the same way;
  P0-C1 `returnedQuantity` / `sourceOrderItemId` are not overwritten.
- **Void wins:** checkout/final-payment CAS fails against `Void`; refund/return
  reject the non-`Closed` parent under existing rules.
- **Non-final partial then void:** permitted sequential behavior. Void operates
  on the latest committed payment state inside its transaction and performs
  **existing** void reversal behavior only (no payment/cash/shift reversal;
  optional stock reverse unchanged). No new formulas.

## Preserved business rules

- No payment, cash-drawer, or shift reversal on void (unchanged).
- Optional `reverseStock` still writes `Return` stock movements.
- Already-void line items are skipped for stock reverse.
- Formulas, status names, approval action/threshold, and grant hashing unchanged.
- **No Prisma schema or migration** for P0-C2.

## Frontend (deferred)

- Send `Idempotency-Key` on void.
- On `409` financial/void conflicts, re-read order state; use a **new** key for a
  new attempt.
- Attach `managerApprovalToken` for **original** execution only; matching replay
  does not need another credential.

## Deferred

- Discount idempotency
- Physical idempotency cleanup
- Broader order-state locking
- Dual-control manager policy
- PostgreSQL production locking verification
