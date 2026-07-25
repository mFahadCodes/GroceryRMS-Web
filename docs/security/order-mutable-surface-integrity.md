# Order Mutable-Surface Integrity

**Wave:** P0-F  
**Approved baseline:** `794e7d7616e46d55dc331716fcae32640bc474cb`

## Business rule

Items, tax, and manual order adjustments may change **only while the order is `Open`**.

This matches the Open-only contracts for void and discount. PartiallyPaid, fulfilment-stage, Closed, and Void orders must reject these mutations with `ORDER_NOT_MUTABLE` (409).

## CAS helpers

`lib/security/order-mutable-concurrency.ts` owns:

- `MUTABLE_ORDER_STATUSES = ["Open"]` — positive allowlist; do not broaden
- `assertOrderMutable(status)`
- `acquireOpenOrderWrite(tx, orderId)` — early Open claim via `updateMany` touching `updatedAt`; requires `count === 1`
- `claimOrderTotalsUpdate(tx, orderId, prior, next)` — Open + prior `subTotal` / `taxAmount` / `grandTotal` CAS; requires `count === 1`; on miss re-reads and maps to `ORDER_NOT_MUTABLE` or `ORDER_MUTABLE_CONFLICT`

## Transaction boundary

Each protected operation runs in one outer `prisma.$transaction` (or a passed `txClient`):

1. `acquireOpenOrderWrite`
2. Read order / items on `tx`
3. `assertOrderMutable`
4. Mutate items or compute new tax/adjustment totals
5. `claimOrderTotalsUpdate` (via `claimRecalculatedOpenOrderTotals`)
6. `writeRequiredAudit` inside the same transaction
7. Return the updated order from `tx`

Losing paths leave no mutation, no audit, and no totals change. Audit insert failure rolls the whole transaction back.

## Routes

Dedicated tax / items / adjustment routes are thin permission + validation wrappers. They do **not** call `auditFromRequest` and do **not** add durable `Idempotency-Key` in this phase.

## Out of scope for P0-F

- Durable idempotency for tax / item / adjustment retries (P1+)
- Schema or paisa formula changes
- Manager approval for these mutations
- Inventory / PO / frontend changes
