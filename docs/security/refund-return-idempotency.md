# Refund and return idempotency (P0-C1)

P0-C1 adds durable same-key idempotency and different-key monetary/quantity
concurrency protection for merchandise refunds and returns.

Status: implemented and verified on branch
`fix/p0c1-refund-return-idempotency` (base `main`
`e9507bb38a6ace597900793a83537eb0f19162df`). Not merged.

## Threat model

Retries and concurrent different-key requests can duplicate refund money,
over-return sold units, restore stock twice, duplicate drawer effects, and
duplicate required audits.

## Protected endpoints

| Route | Method | Operation | Permission |
| --- | --- | --- | --- |
| `/api/orders/[id]/refund` | POST | `order.refund` | `ISSUE_REFUNDS` ≥ 1 |
| `/api/orders/[id]/return` | POST | `order.return` | `ISSUE_REFUNDS` ≥ 1 |

Manager approval is **not** required for these routes (unchanged).

Return does not call the refund route. It creates its own child `OrderType.Refund`
order, negative payment, stock restoration, and `RETURN` audit in one outer
`executeFinancialIdempotent` transaction.

## Idempotency versus concurrency

| Concern | Mechanism |
| --- | --- |
| Same key retries | Existing `IdempotencyRecord` + `executeFinancialIdempotent` |
| Different-key money | In-transaction `SUM` of child Refund `grandTotal` absolutes |
| Different-key quantity | Authoritative `OrderItem.returnedQuantity` CAS |

## Schema (approved additive migration)

Migration: `20260725_000000_add_order_item_return_quantity`

- `OrderItem.returnedQuantity` (`returned_quantity`, default `0`) — **authoritative**
  concurrency counter for sold-line units reversed.
- `OrderItem.sourceOrderItemId` (`source_order_item_id`, nullable) — **lineage only**
  on child refund/return lines; `onDelete: SetNull`; indexed.
- Do not use product/variant aggregation as authority.
- Do not use `sourceOrderItemId` aggregation as the concurrency authority when
  the source counter is available.

## Quantity CAS

For each source line, inside the outer transaction:

1. Read the item (must belong to the route order).
2. `proposed = returnedQuantity + claimQty`.
3. Require `proposed <= quantity`.
4. `updateMany` with predicates on id, orderId, exact prior `returnedQuantity`,
   and `quantity >= proposed`.
5. Zero rows → `409 REFUND_RETURN_CONFLICT` (or quantity-exceeded codes).

Multi-item returns sort claims by `orderItemId` and claim all-or-nothing.

Refund paths that restore merchandise claim full sold `quantity` per line
(matching existing full-line stock restore) and write negative child items with
`sourceOrderItemId` set.

## Legacy null-lineage guard

Pre-migration child merchandise lines have `quantity < 0` and
`sourceOrderItemId IS NULL` under a Refund child of the source order.

Those records are **not** backfilled. Further merchandise refund/return that
would restore stock is blocked with:

`409 RETURN_HISTORY_RECONCILIATION_REQUIRED`

No mutation, stock, audit, or completed idempotency row is retained.
Controlled historical reconciliation tooling is deferred.

## Monetary boundary

`alreadyRefunded = SUM(abs(child.grandTotal))` for active Refund children.
`remaining = grandTotal - alreadyRefunded`.
Amounts above remaining → `409 REFUND_EXCEEDS_REFUNDABLE_AMOUNT`.

Formulas for tax, tender, rounding, and status names are unchanged.

## Request canonicalization

- Refund DTO: reason, amount, paymentMethodId, terminalId, referenceNo.
- Return DTO: items sorted by `orderItemId` (order not business-meaningful),
  refundAmount. Duplicate lines are not silently combined.
- Authorization credentials and `Idempotency-Key` are excluded from the digest.

## Replay

Matching replay returns the stored success envelope, sets
`Idempotency-Replayed: true`, and performs no refund/return/stock/audit work.
No manager approval applies on these routes.

## Frontend (deferred)

- Send `Idempotency-Key` on refund and return.
- On financial/quantity `409`, re-read order state; use a **new** key for a new attempt.
- On `RETURN_HISTORY_RECONCILIATION_REQUIRED`, stop and escalate for ops reconciliation.

## Deferred

- Void idempotency — **done in P0-C2**
  (`docs/security/void-idempotency-concurrency.md`). Closed parents are not
  voidable; use refund/return. Losing void cannot overwrite P0-C1
  `returnedQuantity` / `sourceOrderItemId`.
- Physical historical return-lineage reconciliation tooling
- Idempotency row cleanup
- PostgreSQL production locking verification
- Discount idempotency
- Physical historical reconciliation tooling
- Idempotency row cleanup
- PostgreSQL production locking verification
