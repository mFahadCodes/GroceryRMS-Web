# Purchase-order receive atomicity and concurrency

## Existing HTTP contract

The receive mutation is:

```text
POST /api/inventory/purchase-orders/{id}/receive
```

It requires `Manage inventory` at access level 1. The request body remains:

```json
{
  "items": [
    {
      "purchaseOrderItemId": 123,
      "receivedQty": "2.5"
    }
  ]
}
```

The response remains the standard success envelope containing the received
purchase order, its supplier, and its lines. BigInt values are serialized by the
shared API serializer.

No frontend module currently calls this route. This backend change adds no
request or response field and therefore requires no caller change. A future
caller must treat `PO_NOT_RECEIVABLE` and `PO_RECEIVE_CONFLICT` as conflicts and
must not assume that retrying a successful request is a replay.

## Current receiving behavior

Receiving is a one-shot completion operation, not a durable partial-receipt
workflow. The payload still selects the purchase-order lines and quantities to
apply. After those selected quantities are applied, the purchase order becomes
`Received`, even when the payload omits another line or supplies less than its
ordered quantity. This preserves the pre-INV-01 behavior.

`PurchaseOrderItem.quantityReceived` remains the authoritative persisted line
quantity. The mutation increments it by the submitted quantity; no costing,
valuation, or ordered-versus-received formula changed.

The exact eligible state is an active `Draft` purchase order. Newly created
purchase orders are `Draft`, and the current application has no route that
transitions a purchase order to `Ordered` or `PartialReceived`. `Ordered`,
`PartialReceived`, `Received`, and `Cancelled` are not receive-entry states for
this contract. There is no purchase-order cancellation or quantity-update route
with which receiving can race in the current application.

## Authoritative claim and transaction

One outer Prisma interactive transaction contains:

1. the authoritative purchase-order and line read;
2. active/`Draft` eligibility and payload membership validation;
3. the positive purchase-order CAS;
4. exact-prior line quantity CAS updates;
5. product stock increments;
6. stock-movement inserts;
7. the required `RECEIVE_PURCHASE_ORDER` audit;
8. the purchase-order/supplier/line read used for response serialization.

The claim is a conditional `updateMany`:

```text
id = requested purchase-order id
isActive = true
status IN [Draft]
```

It atomically changes the row to `Received` and sets `receivedAt`.
`updateMany.count` must equal one. A zero-row result is re-read and returned as
a safe not-found, not-receivable, or receive-conflict service error. The
in-transaction eligibility check and the CAS use the same exact allowlist.

Each selected line is updated with another conditional `updateMany` whose
predicate contains its purchase-order ID, item ID, and exact prior
`quantityReceived` value. Its count must also equal one. This prevents a stale
line snapshot from silently applying after another line mutation.

The PO transition is intentionally the first write. Although it changes the row
to its terminal state early in the callback, it is not committed early. Any
later failure rolls the transition back with every other receiving effect.
There are no nested transactions, root-Prisma writes in the protected path,
per-line transactions, or post-commit required effects.

## Inventory and movement semantics

Purchase-order lines reference `Product`, not `ProductVariant`. Receiving uses
Prisma's atomic `increment` operation on `Product.currentStock`. Existing
product variants are not mutated, and the schema has no variant stock quantity
for this operation to update.

Each selected line creates one `Purchase` stock movement with:

- the line product;
- the submitted quantity;
- the existing line `unitCost` as `costAmount`;
- reference `PO-{purchaseOrderId}`;
- notes `Purchase order receive`;
- the authenticated receiving user.

The mutation does not update product cost price, supplier balance, purchase
order total, or any supplier financial record.

## Concurrency outcomes

### Same purchase order

Two contenders may both initially read `Draft`, but only one can update the
current row from the exact eligible state. The winner continues in the
transaction. Once its transaction commits, the loser updates zero rows and
returns a safe 409 conflict. The loser writes no line quantity, stock,
movement, or audit effect.

Identical and different payloads have the same same-PO outcome: this phase
provides exclusion, not request replay. A sequential repeat after success is
also rejected because `Received` is not eligible.

### Different purchase orders sharing a product

Each purchase order has an independent CAS row, so both may commit. Product
stock changes use database atomic increments rather than an application
read-modify-write assignment. Consequently, increments from independent
purchase orders compose and neither overwrites the other's stock result. Each
receipt retains its own movements and required audit.

### PostgreSQL reasoning

The production database migration to PostgreSQL remains deferred; INV-01 does
not claim PostgreSQL execution testing.

The design is nevertheless provider-safe:

- `UPDATE ... WHERE status IN ('Draft')` evaluates eligibility against current
  row state when the write executes;
- after one transaction commits `Received`, a same-PO contender's positive CAS
  matches zero rows;
- atomic numeric increments are executed by the database and therefore compose
  for independent POs sharing a product;
- no stock value is read into application code and later assigned, so a stale
  stock snapshot cannot overwrite another increment;
- all dependent writes and the required audit share the transaction that owns
  the claim.

## Rollback behavior and audit

Failure of any line update, stock update, movement insert, required audit,
purchase-order transition, or response read aborts the outer transaction.
There is no partially committed claim, line, stock, movement, or audit.

`RECEIVE_PURCHASE_ORDER` remains a transaction-required audit event in the
existing central policy. The service writes exactly one audit for a committed
receipt and none for a losing or rolled-back attempt. No shared audit registry
change was required.

## Deferred durable request idempotency

INV-01 does not accept or persist `Idempotency-Key`. A client that loses the
response to a committed receive cannot replay a stored success response; a
retry encounters the terminal `Received` state and receives a conflict.
Durable request replay, key retention, cleanup, and client attempt recovery are
separate future work.
