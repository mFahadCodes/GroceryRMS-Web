# Shift-close audit atomicity (SEC-05C)

SEC-05C makes shift closing and its required audit one atomic financial
operation. Shift close was intentionally left best-effort/post-commit in
SEC-05B; this branch closes that gap without changing reconciliation formulas.

Status: implemented and verified on branch
`fix/sec-05c-shift-close-audit-atomicity` (base `main`
`a200cb69b2c3b8192ee6ffd714f11558c1449d93`). Not merged.

## Why shift closing is financially sensitive

Closing a shift persists counted cash, expected cash, and discrepancy. Those
values are used for till reconciliation and operational accountability. A
close that commits without an audit record — or an audit that claims success
after a rolled-back close — breaks financial integrity.

## Permission and routes

| Route | Method | Permission | Canonical audit action |
| --- | --- | --- | --- |
| `/api/shifts` (`action: "close"`) | POST | `Open / close shift` (level 1) | `CLOSE_SHIFT` |
| `/api/shifts/[id]/close` | POST | `Open / close shift` (level 1) | `SHIFT_CLOSE` |

Both routes require an authoritative session through `requirePermission`.
Request contracts are unchanged (`closingBalance`, optional `notes`).

Ownership: the close service requires `shift.userId === authenticated user`.

## Authoritative transaction boundary

`closeShift` in `lib/services/shift-service.ts`:

1. Starts one Prisma interactive transaction.
2. Re-reads the shift and drawer logs inside the transaction.
3. Validates ownership, open state (`endedAt` null), and no active/unpaid orders.
4. Calculates expected balance and discrepancy with the existing formula.
5. Conditionally updates only where `id`, `userId`, and `endedAt: null` match.
6. Requires `updateMany.count === 1`.
7. Writes `writeRequiredAudit` with the same transaction client.
8. Commits once and returns the closed shift.

Routes do not write a separate audit. There is no post-commit close audit and
no best-effort fallback.

## Conditional close transition

Concurrency uses compare-and-set style `updateMany`:

```text
WHERE id = :shiftId AND userId = :userId AND endedAt IS NULL
```

At most one concurrent close succeeds. The loser receives
`Shift is already closed` and writes no success audit. Closing totals from the
loser never overwrite the winner.

SQLite serializes writers; the conditional predicate remains the integrity
guarantee under concurrent clients and in disposable test databases.

## Required audit behavior

- Events: `CLOSE_SHIFT` and `SHIFT_CLOSE` are `TRANSACTION_REQUIRED`.
- Actor and shift entity ID are required.
- Metadata builder: `buildShiftCloseAuditMetadata`
  - `closingBalance`, `expectedBalance`, `discrepancy` (string paisa)
  - `terminalId`
  - `reasonProvided` / `reasonLength` for notes (never raw free text)
- Root Prisma client is rejected by `writeRequiredAudit`.

## Failure and retry semantics

| Failure | Result |
| --- | --- |
| Required audit persistence fails | Entire close rolls back; shift stays open; no success audit |
| Mutation / validation / ownership / already-closed fails | No success audit |
| Active unpaid orders | Close rejected; no audit |
| Retry after successful close | Rejected as already closed; totals and `endedAt` unchanged; no second audit |

## Financial calculations preserved

Exact existing formula (exported as `calculateShiftCloseTotals` for tests):

```text
cashSales   = sum(Sale logs with description starting "[CASH]")
payIns      = sum(PayIn)
payOuts     = sum(PayOut)
cashRefunds = sum(Refund logs with description starting "[CASH]")
expectedBalance = openingBalance + cashSales + payIns - payOuts - cashRefunds
discrepancy     = closingBalance - expectedBalance
```

Rounding, bigint paisa math, cash vs non-cash drawer filters, and active-order
status filters are unchanged. Close does not rewrite orders, payments, refunds,
stock, taxes, sessions, or other shifts. Drawer logs are read only.

## Related deferred work

- Shift opening remains best-effort.
- Cash-count UX / till hardware / new discrepancy policy — out of scope.
- General idempotency tokens — not introduced.
- Audit signing, hash chains, WORM/SIEM — deferred.
- Physical historical scrubbing — deferred.
