# Order financial concurrency (P0-B)

P0-B makes the **order row** the authoritative concurrency boundary for
checkout and partial-payment mutations when requests use **different**
idempotency keys.

Status: implemented and verified on branch
`fix/p0b-order-financial-concurrency` (base `main`
`11b1a918a32ca8a453bb2735c089c02faf316172`). Not merged.

## Threat model

Idempotency (P0-A) prevents duplicate execution of the **same scoped key**.
It does not stop two independently keyed requests from racing on one order.

Without order-level concurrency control, different keys can:

- Complete checkout twice
- Finalize via checkout and partial payment together
- Collectively overpay with concurrent partials
- Duplicate stock decrement, drawer effects, and required success audits
- Leave a completed idempotency row for a losing mutation

## Idempotency versus concurrency

| Concern | Owner |
| --- | --- |
| Same key, retries / double-submit | `IdempotencyRecord` + `executeFinancialIdempotent` (P0-A) |
| Different keys, same order | Conditional `Order` transitions + in-transaction revalidation (P0-B) |

Same-key replay behavior is unchanged. Different keys compete through order
financial state; a losing transaction rolls back its idempotency reservation.

## Protected operations

| Route | Service | Permission (unchanged) |
| --- | --- | --- |
| `POST /api/orders/[id]/checkout` | `checkoutFast` | `PROCESS_PAYMENTS` **and** `CREATE_ORDERS` |
| `POST /api/orders/[id]/partial-payment` | `applyPartialPayment` | `PROCESS_PAYMENTS` **or** `CREATE_ORDERS` |

There is still no separate full-payment route. Helpers live in
`lib/security/order-financial-concurrency.ts`.

## Order as the concurrency boundary

Existing schema fields only (no migration):

- Checkout claim: `updateMany` where `status = Open` → `Closed` (with totals)
- Payable claim: early `updateMany` on `Open|PartiallyPaid` (touches `updatedAt`)
- Finalizing partial: `updateMany` where `Open|PartiallyPaid` → `Closed`
- Non-final partial: `updateMany` where `Open|PartiallyPaid` → `PartiallyPaid`
- Remaining balance: authoritative `SUM(payments)` re-read after the payable claim;
  `amount > remaining` → `409 PAYMENT_EXCEEDS_REMAINING`

Zero-row CAS → stable business conflict (`409`); no payment, stock, success audit,
or completed idempotency row is retained.

## In-transaction flow

Inside the existing `executeFinancialIdempotent` transaction:

1. Idempotency reservation
2. Authoritative order re-read / payable write claim
3. Remaining-balance validation (partial)
4. Conditional financial-state transition
5. Payment create (only after eligibility)
6. Stock / drawer effects when completing
7. Required audit
8. Response snapshot + idempotency completion
9. Single commit

No nested `$transaction`. No post-commit required audit or idempotency completion.

## Race outcomes

- **Checkout vs checkout:** exactly one completion, payment, stock set, CHECKOUT audit,
  and completed idempotency row.
- **Checkout vs non-final partial:** if partial commits first, order is
  `PartiallyPaid`; checkout still requires `Open` and conflicts (existing rule).
- **Checkout vs finalizing partial:** at most one finalizer and one stock Sale.
- **Partial vs partial:** concurrent amounts that fit may both commit; amounts that
  would overpay allow only a safe subset; at most one finalizer when the balance
  is exhausted.

## Conflict contract

| Condition | HTTP | Code |
| --- | --- | --- |
| Order not open for checkout | 409 | `ORDER_NOT_OPEN` |
| Order not payable for partial | 409 | `ORDER_NOT_PAYABLE` |
| Zero-row payable CAS | 409 | `ORDER_FINANCIAL_CONFLICT` |
| Payment exceeds remaining | 409 | `PAYMENT_EXCEEDS_REMAINING` |

Conflicts do not reveal competing keys, actors, hashes, or lock internals.
Validation remains `400`; authorization unchanged.

## SQLite behavior

Writers serialize on the SQLite database file. Deferred transactions can still
soft-read the same pre-write state; CAS + post-claim payment re-reads prevent
stale commits. Bounded retries are not used for unknown lock errors.

## Future PostgreSQL

Prefer the same compare-and-set predicates. Consider `SERIALIZABLE` or row-level
locking for stronger guarantees; do not assume SQLite write serialization alone.
PostgreSQL locking is **not** production-tested here.

## Preserved behavior

Financial formulas, rounding, paisa units, payment-status names, permissions,
session architecture, and P0-A same-key replay / payload mismatch / expiry are
unchanged. No frontend changes. No schema or dependency changes.

## Frontend implications (deferred)

- On `409` financial conflicts, re-read order state before retrying with a **new**
  idempotency key.
- Do not treat a conflict response as a stored replay result.
- Continue sending `Idempotency-Key` as required by P0-A.

## Deferred

- Void / discount concurrency and idempotency
- Physical historical return-lineage reconciliation tooling
- General order locking beyond protected checkout/payment/refund/return paths
- Redis / queues / distributed locks
- PostgreSQL production locking verification

Refund/return different-key concurrency and idempotency are covered by P0-C1
(`docs/security/refund-return-idempotency.md`).
- General order versioning or distributed locks
- Redis / queues
- Broader optimistic locking across the application
- Schema `paidAmount` / `version` columns (not required for this phase)
