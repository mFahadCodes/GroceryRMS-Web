# Generic order update boundary (SEC-04A)

SEC-04A converts the generic order modification route into a narrow, explicit
metadata-edit operation so that a caller with only base order access cannot reach
privileged business actions through a low-level endpoint.

Status: implemented and verified on branch `fix/sec-04a-order-action-bypass`
(base `main` `4dd28a067b1937094878905e4832213077e86777`). Not merged. Broader
SEC-04 work remains open; this document covers only the generic-update bypass.

## Why the generic route cannot be a command bus

`PUT /api/orders/{id}` historically accepted an `updateMeta` action that:

- Interpreted magic note values (`hold`, `recall`, `void:…`) as privileged commands.
- Wrote `discountAmount` and `adjustment` directly into the order row.
- Self-approved percentage discounts and voids with the acting cashier's user id,
  bypassing the one-time manager approval grant required by the dedicated
  discount and void routes (SEC-02B).

A level-1 `Create & process orders` caller therefore reached hold/recall,
discount, void, tax recalculation, and financial field mutation without the
permissions, dedicated validators, or manager approval those actions require.
The generic route must never regain that authority.

## Route contract after SEC-04A

- Method: `PUT /api/orders/{id}` (retained for compatibility; the body is no
  longer a general resource replacement).
- Permission: `Create & process orders` at level 1 (unchanged).
- Request body size: capped at 16 KiB; oversized or unparseable bodies are
  treated as `VALIDATION_ERROR`.
- Allowed actions: `addItem`, `updateItem`, `removeItem`, `updateMeta`.
- Item actions remain because they have exact permission parity with the
  dedicated item routes (`POST /api/orders/{id}/items`,
  `PATCH|DELETE /api/orders/{id}/items/{itemId}`) and the existing POS checkout
  flow depends on `addItem` via this method. They are still strict schemas and
  do not accept financial or state fields.
- `updateMeta` is the only metadata action and is restricted to the allowlist
  below.

## Approved safe metadata allowlist

| Field        | Semantics                                                         |
| ------------ | ----------------------------------------------------------------- |
| `notes`      | Plain human-entered text, maximum 2000 characters, stored verbatim. |
| `customerId` | Optional positive integer customer id, or `null` to detach.       |

At least one of those fields must be present. Empty `updateMeta` bodies are
rejected. Note text is never trimmed, lowercased, parsed, or matched against
command strings. A note that looks like a former command is still only a note.

## Protected fields explicitly excluded

The following (and any other unknown key) are rejected by the strict
`updateOrderMetaSchema` and must not be accepted by any future widening of this
route without a separate approved security task:

- Financial / calculated: `discountPercent`, `discountAmount`, `discount`,
  `adjustment`, `taxPercent`, `tax`, `taxAmount`, `subTotal`, `subtotal`,
  `total`, `grandTotal`, `paidAmount`, `balance`, `serviceCharge`
- State / lifecycle: `status`, `paymentStatus`, `orderState`, `voided`,
  `cancelled`, `refunded`, `returned`, `checkout`, `hold`, `recall`,
  `dispatch`, `delivered`, `deliveredAt`, `voidReason`, `invoiceNumber`
- Ownership / binding: `userId`, `cashierId`, `shiftId`, `terminalId`,
  `driverId`, `authVersion`, `approvedByUserId`, `originalOrderId`,
  `taxRateId`, `orderNumber`, `orderType`, `isActive`, `isSynced`
- Nested writes: `items`, `payments`, `stock`
- Manager approval material: `managerPin`, `managerUserId`,
  `managerApprovalToken`
- Client-controlled timestamps: `createdAt`, `updatedAt`, `deliverySlot`

## Dedicated endpoints required for business actions

| Action                         | Dedicated route                                      | Base permission                         | Manager approval        |
| ------------------------------ | ---------------------------------------------------- | --------------------------------------- | ----------------------- |
| Discount                       | `PATCH /api/orders/{id}/discount`                    | `Apply discounts` (1)                   | One-time grant (level 4)|
| Void                           | `POST /api/orders/{id}/void`                         | `Void / cancel orders` (1)              | One-time grant (level 5)|
| Hold                           | `POST /api/orders/{id}/hold`                         | `Hold & recall orders` (1)              | None                    |
| Recall                         | `POST /api/orders/{id}/recall`                       | `Hold & recall orders` (1)              | None                    |
| Checkout                       | `POST /api/orders/{id}/checkout`                     | `Create & process orders` (1)           | None                    |
| Partial payment                | `POST /api/orders/{id}/partial-payment`              | (route-specific)                        | None                    |
| Refund                         | `POST /api/orders/{id}/refund`                       | `Issue refunds`                         | None                    |
| Return                         | `POST /api/orders/{id}/return`                       | (route-specific)                        | None                    |
| Tax                            | `PATCH /api/orders/{id}/tax`                         | `Manage tax & discounts` (1)            | None                    |
| Adjustment                     | `PATCH /api/orders/{id}/adjustment`                  | `Create & process orders` (1)           | None                    |
| Dispatch                       | `POST /api/orders/{id}/dispatch`                     | (route-specific)                        | None                    |
| Delivered                      | `POST /api/orders/{id}/delivered`                    | (route-specific)                        | None                    |
| Notes (dedicated)              | `PATCH /api/orders/{id}/notes`                       | `Create & process orders` (1)           | None                    |
| Items                          | `POST/PATCH/DELETE /api/orders/{id}/items…`          | `Create & process orders` (1)           | None                    |

The dedicated notes route remains the preferred notes path; the generic
`updateMeta` notes field is retained as the same level-1 metadata capability
already proven by that route and by checkout notes, without introducing a
second validator semantics for privileged behavior. Notes stay plain text on
both paths.

## Discount and void manager approval

Discount and void continue to require a one-time `managerApprovalToken` issued
by `POST /api/auth/manager-approvals` and consumed inside the dedicated
discount/void Prisma transaction (SEC-02B). The generic route:

- Does not accept `managerApprovalToken`, `managerPin`, or `managerUserId`.
- Does not call `consumeManagerApprovalGrant` or `applyOrderDiscount` /
  `voidOrder`.
- Cannot apply a discount or void an order even when a valid grant exists for
  the same order.
- Stores a note that happens to contain a token string as plain text only.

## Mass-assignment protection

- Request bodies are validated with strict Zod schemas; unknown keys fail.
- The route never spreads parsed input into Prisma.
- `updateOrderMetadata` accepts a closed typed input and builds the Prisma
  `data` object field-by-field.
- No dynamic key iteration, nested writes, ownership changes, or client-selected
  relation updates are permitted on this path.

## Authorization boundary

A level-1 caller may:

- Add, update, or remove open-order items through the existing item actions.
- Set or clear `notes` and `customerId` through `updateMeta`.

A level-1 caller may not, through this route:

- Reach level-4 discount or level-5 void behavior.
- Change calculated totals, tax, discount, adjustment, or payment state.
- Change protected order status or delivery state.
- Hold, recall, checkout, refund, return, dispatch, or mark delivered.
- Submit or consume manager approval material.

Rejected privileged payloads produce `VALIDATION_ERROR`, mutate nothing, and
create no success audit.

## Intentional breaking API changes

Clients that previously relied on `updateMeta` for any of the following must
move to the dedicated endpoints listed above:

- Magic note commands `hold`, `recall`, and `void:…`
- Direct `discountAmount`, `adjustment`, `discountPercent`, or `taxPercent`
  fields on the generic body

Plain `notes` and `customerId` updates continue to work. Item actions on the
same `PUT` method are unchanged.

## Future frontend adjustments

- Stop sending magic note commands or financial fields to
  `PUT /api/orders/{id}`.
- Prefer `PATCH /api/orders/{id}/notes` for note-only edits when the UI is
  updated.
- Prefer the dedicated hold/recall/discount/void/tax/adjustment routes for
  those actions.
- Continue using the dedicated manager approval grant flow for discount and
  void (SEC-02B frontend work remains outstanding).

## Deferred SEC-04 and P0 findings

Documented here for tracking; not in SEC-04A scope:

- Broader SEC-04 review of other order surfaces beyond the generic update path.
- Legacy `approvedByUserId` service overload on `applyOrderDiscount` /
  `voidOrder` (still gated by elevated permission checks; dedicated routes use
  grants only). Removing the overload is a follow-up once no callers remain.
- Refund / return / void / checkout idempotency redesign (P0).
- Parent-child order invariants and nested order-item ownership (P0).
- Payment, stock, tax, and shift reconciliation redesign (P0).
- Dedicated notes vs generic notes consolidation into a single public API
  (deferred; both remain level-1 plain-text writers today).
