# Audit integrity policy (SEC-05B)

SEC-05B establishes one explicit, testable audit-integrity policy for
GroceryRMS-Web. Redaction (SEC-05A) and integrity (SEC-05B) are separate
concerns: the sanitizer prevents secret leakage; the policy registry decides
whether an audit is part of the integrity guarantee, when it must share a
transaction, and which metadata builders are allowed.

Status: merged on `main` (`a200cb69b2c3b8192ee6ffd714f11558c1449d93`).
Physical historical scrubbing, cryptographic signing, hash chains, WORM/SIEM,
and retention jobs remain deferred. Shift-close transaction atomicity is
SEC-05C (`docs/security/shift-close-audit-atomicity.md`).

## Why redaction is not enough

SEC-05A prevents many secret leaks, but sanitization alone does not guarantee:

- Critical mutations cannot commit without an audit record
- Success audits cannot survive a rolled-back mutation
- Callers cannot invent action strings or choose failure behavior
- Free-text fields do not store short credentials verbatim
- Broad objects such as `parsed.data` never enter security events

SEC-05B addresses those integrity gaps.

## Central event registry

Module: `lib/security/audit-policy.ts`

Every approved audit event is registered with:

- Stable action name (existing names preserved for report compatibility)
- Exactly one audit mode
- Entity table (callers cannot override)
- Actor and entity-id requirements
- Allowed result-state vocabulary

Unknown actions fail closed through `getAuditEventDefinition` /
`AuditPolicyError`. Production callers cannot invent arbitrary action strings.

## Audit modes

### TRANSACTION_REQUIRED

Use when the audit record is part of the security or financial integrity
guarantee. Requirements:

- Must be written with the protected mutation's Prisma transaction client
- Root Prisma client is rejected (`$connect` discriminator)
- Persistence failure throws and rolls the mutation back
- Success audits are written only after in-transaction validation/mutation
- Callers never select this mode; the registry does

Representative events: `PASSWORD_CHANGED`, `PIN_CHANGED`, `FORCE_LOGOUT`,
`CREATE_USER`, `UPDATE_USER`, `DELETE_USER`, `REPLACE_ROLE_PERMISSIONS`,
`MANAGER_APPROVAL_ISSUED`, `MANAGER_APPROVAL_CONSUMED`, `VOID_ORDER`,
`APPLY_ORDER_DISCOUNT`, `CHECKOUT`, `PARTIAL_PAYMENT`, `REFUND_ORDER`,
`RETURN`, `UPSERT_SETTING`, `RECEIVE_PURCHASE_ORDER`, `APPLY_STOCK_TAKE`,
`SHIFT_CLOSE`, `CLOSE_SHIFT`, and PIN verification lifecycle events.

### BEST_EFFORT

Use for low-risk operational metadata where audit failure must not block the
approved operation. Failures are swallowed without logging raw metadata.

Representative events: `UPDATE_ORDER_META`, catalog CRUD, customer CRUD,
`CREATE_ORDER`, item edits, `OPEN_SHIFT`, `CASH_DRAWER_ENTRY`, restore markers,
and similar descriptive operations.

### ACCESS_ACTIVITY

Use only for current read/export/print activity. Never mutates business state,
never receives a transaction client, and never changes response data when audit
storage is unavailable.

Events: `PRINT_RECEIPT`, `OPEN_DRAWER`, `DB_BACKUP`.

## Controlled wrappers

Module: `lib/audit.ts`

| Wrapper | Mode | Behavior |
| --- | --- | --- |
| `writeRequiredAudit` | TRANSACTION_REQUIRED | Requires transaction client; throws on failure |
| `writeBestEffortAudit` / `auditFromRequest` | BEST_EFFORT | Swallows storage failure; rejects wrong-mode actions |
| `writeAccessAudit` / `accessAuditFromRequest` | ACCESS_ACTIVITY | Non-mutating; swallows storage failure |

There is no caller-controlled `mode`, `bestEffort`, `ignoreAuditFailure`,
`skipAudit`, or `alreadySanitized` flag. The generic `writeAuditRecord` /
`auditLog` surface is no longer exported.

## Free-text reason policy

Short credentials typed into free-text fields cannot be detected reliably
without destroying legitimate numeric content. For high-risk events, builders
record only:

- `reasonProvided: boolean`
- `reasonLength: number` (bounded)

The underlying business record (order void reason, refund notes, item notes)
continues to store the free text where the domain model already does. Audit
metadata does not duplicate that free text for void, discount, refund, return,
or similar high-risk actions.

Categorical system reasons (for example PIN lifecycle codes such as
`administrator-changed` / `verified` / `throttled`) remain allowed because they
are not user free text.

## Actor, entity, and result conventions

- **Actor**: authenticated user ID, or `null` for genuine system operations
  (for example the `LastBackupAt` marker). Manager approver ID is metadata, not
  confused with the actor.
- **Entity**: registry-owned table name plus record id when required.
- **Result vocabulary**: `succeeded` | `failed` | `denied` | `revoked` |
  `expired`. Events encode result primarily through the registered action name
  and categorical metadata.

## Failure semantics

- Required audit failure → complete protected operation rolls back; no success
  audit remains.
- Mutation failure → no success audit.
- Authorization/validation failure before mutation → no success audit.
- Best-effort / access audit failure → underlying operation and response
  unchanged; no raw metadata emitted.

## Critical coverage and deferred gaps

Protected in SEC-05B (transaction-required, same-transaction audit):

- Password change, PIN change / lockout reset / verification lifecycle
- Force logout
- User create / update / delete
- Role permission replace
- Manager approval issue and consume
- Void, discount, checkout, partial payment, refund, return
- Setting upsert
- Purchase-order receive and stock-take apply

Deferred (documented, not silently claimed complete):

- Shift open remains best-effort (SEC-05C covers close only)
- Broad catalog/customer/expense/payroll best-effort callers still pass
  `parsed.data` in some routes; sanitizer remains defense in depth
- Physical historical scrubbing of pre-SEC-05A rows
- Cryptographic signing, hash chains, WORM, SIEM, retention jobs
- Audit encryption

## Historical data policy

SEC-05B does not rewrite historical audit rows. Read-time redaction from
SEC-05A continues to protect report responses. Physical scrubbing remains a
separately approved offline operation.
