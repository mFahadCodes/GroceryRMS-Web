# Void idempotency and concurrency (P0-C2)

P0-C2 adds durable same-key idempotency and different-key / cross-operation
concurrency protection for order voids, while preserving the existing
manager-approval grant model.

Status: implemented and verified on branch
`fix/p0c2-void-idempotency-concurrency` (base `main`
`a03ae0c9a813f75b4ca42fe6dd82bc8f4862e141`). Not merged.

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
| Different-key void | Conditional `Order.status` CAS (`status ≠ Void` → `Void`) |
| Cross-op races | Competing ops keep their own status CAS (Open/payable/Closed) |

## Request contract

Body (unchanged): `reason`, `managerApprovalToken`, optional `reverseStock`.

Header: required `Idempotency-Key`.

Business request hash includes `orderId`, `reason`, and `reverseStock` only.
`managerApprovalToken` is an execution credential and is **never** hashed,
stored in idempotency rows, audited, or returned.

## Replay before approval consumption

Matching completed replay returns the stored success envelope with
`Idempotency-Replayed: true` and does **not**:

- call `voidOrder`;
- consume a manager approval grant;
- write another `VOID_ORDER` or `MANAGER_APPROVAL_CONSUMED` audit.

Original execution still requires a valid unused grant inside the outer
transaction.

## Authoritative transaction

Reservation, order re-read, grant consumption, `claimVoidTransition`, item
voiding, optional stock reverse, required `VOID_ORDER` audit, response
snapshot, and idempotency completion share one Prisma interactive transaction.

## Conditional void claim

```ts
updateMany({
  where: { id, status: { not: "Void" } },
  data: { status: "Void", voidReason, approvedByUserId },
})
```

Zero rows → `409 ORDER_NOT_VOIDABLE` (already void) or `409 ORDER_VOID_CONFLICT`.
Losers create no mutation, stock effect, success audit, completed idempotency
row, or consumed grant.

## Cross-operation behavior

- **Void vs void:** exactly one transition and one consumed grant set.
- **Void vs checkout / partial payment:** at most one incompatible terminal
  outcome; losers roll back idempotency and do not leave success audits.
- **Void vs refund / return:** Closed-order voidability is unchanged; when void
  wins, refund/return CAS on Closed fails. P0-C1 `returnedQuantity` /
  `sourceOrderItemId` are not used as void authority.

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
- Keep issuing and attaching `managerApprovalToken` for original execution only.

## Deferred

- Discount idempotency
- Physical idempotency cleanup
- Broader order-state locking
- Dual-control manager policy
- PostgreSQL production locking verification
