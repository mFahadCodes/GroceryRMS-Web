# Audit metadata redaction (SEC-05A)

SEC-05A establishes one enforced audit-safety boundary for GroceryRMS-Web so
that passwords, PINs, tokens, session identifiers, secrets, credentials,
cookies, authorization headers, and arbitrary request bodies cannot be stored
in new audit records or returned through audit report APIs.

Status: implemented and verified on branch `fix/sec-05a-audit-redaction`
(base `main` `bdd731f129fbd412a77ca83eeee37d0d2fab64b0`). Not merged. Broader
SEC-05 work (transaction-policy standardization and historical physical
scrubbing) remains open as SEC-05B.

## Audit metadata is untrusted input

Every `oldValues` / `newValues` payload is treated as untrusted, including:

- Explicit builder output
- Parsed request fields from ordinary routes
- Nested objects and arrays
- Historical rows written before SEC-05A
- Manual or migration-time inserts

Callers cannot mark metadata as pre-sanitized and cannot disable sanitization.

## Central write-time sanitizer

Module: `lib/security/audit-sanitizer.ts` (pure; no Prisma).

Entry points:

- `sanitizeAuditMetadata` — recursive structural sanitization
- `sanitizeAuditValue` — alias for the same behavior
- `sanitizeAuditError` — safe Error reduction
- `serializeSafeAuditMetadata` — JSON string for persistence
- `sanitizeStoredAuditJson` — defense-in-depth for stored JSON strings

Write boundary: `lib/audit.ts`

- `writeAuditRecord(store, input)` — transactional and shared writes
- `auditLog` / `auditFromRequest` — best-effort route writers wrapping the same
  sanitizer
- All direct `prisma.auditLog.create` / `tx.auditLog.create` calls outside
  `lib/audit.ts` are removed

## Read/export defense in depth

`getAuditLogReport` (`lib/services/report-service.ts`):

- Selects only safe user fields (`id`, `username`, `fullName`)
- Maps every row through `mapAuditLogForResponse`, which re-sanitizes
  `oldValues` / `newValues` without mutating the database row

There is no dedicated audit export route. Maintenance and order export paths do
not include audit logs. Any future export must call the same sanitizers.

## Sensitive key categories

Keys are matched after normalization (case-insensitive; spaces, hyphens,
underscores, dots, and brackets removed). Families include:

- Passwords and credentials
- PINs, PIN hashes, and peppers
- Tokens, JWTs, approval tokens/digests, bearer/authorization
- Cookies and session identifiers
- Secrets, API keys, private/signing/encryption keys
- Credential-bearing connection strings / database URLs
- Arbitrary request bodies and headers

Safe near-matches remain visible, including `passwordChangedAt`,
`passwordChanged`, `reauthenticationRequired`, `authVersionChanged`,
`cookieEnabled`, `tokenCount`, `pinCodeRequired`, `sessionCount`, and
`mustChangePassword`.

## Sensitive value pattern handling

Under generic keys, obvious secret-shaped strings are redacted:

- `Bearer …`
- JWT-like three-part tokens
- Basic authentication
- PEM private-key headers
- Cookie-header style strings (non-URL)
- `password=` / `token=` assignment formats (non-URL)
- Credential-bearing URLs (username/password and sensitive query params removed;
  useful host/path preserved where possible)

Broad entropy guessing is intentionally avoided.

## Error-object behavior

Persisted error metadata includes only:

- `name`
- Primitive `code` when present
- Sanitized bounded `message`
- Shallow safe `cause` summary

Stacks, request/config/response objects, headers, and bodies are not persisted.

## Size and depth limits

| Limit | Value |
| ----- | ----- |
| Max recursion depth | 6 |
| Max object properties | 50 |
| Max array entries | 50 |
| Max string length (chars) | 2,048 |
| Max error message length | 1,024 |
| Max serialized metadata (UTF-8 bytes) | 16 KiB |

Stable markers: `[REDACTED]`, `[TRUNCATED]`, `[MAX_DEPTH]`, `[CIRCULAR]`,
`[UNSUPPORTED]`, `[SANITIZER_FAILURE]`. Markers never include removed content.

## Cycle and unsupported objects

Circular references become `[CIRCULAR]`. Functions, symbols, buffers, streams,
Request/Response/Headers, Maps/Sets, and Prisma clients become
`[UNSUPPORTED]`. Input is never mutated. Sanitization is idempotent.

## Security-event metadata allowlists

Module: `lib/security/audit-metadata.ts`

Builders for high-risk events:

- `buildPasswordChangedAuditMetadata`
- `buildPinChangedAuditMetadata`
- `buildManagerApprovalAuditMetadata`
- `buildSessionForceLogoutAuditMetadata`
- `buildOrderVoidAuditMetadata`
- `buildOrderDiscountAuditMetadata`

Builders accept only safe identifiers/statuses. The central sanitizer still
runs on every write.

## Historical-data protection

- New writes are sanitized before storage.
- Old rows are sanitized on read/report.
- Physical historical scrubbing of the database is deferred to a separately
  approved maintenance phase (SEC-05B planning).
- This branch never modifies `dev.db` and never rewrites production audit rows.

## Audit failure-policy categories

### Transactionally required

These mutations already require audit success inside the same Prisma
transaction (failure aborts the business change):

- Password change (`PASSWORD_CHANGED`)
- Manager approval issuance/consumption
- PIN change audits written inside user/PIN transactions
- Discount / void order audits written inside grant-consuming transactions

SEC-05A preserves that transactional behavior.

### Best-effort

`auditLog` / `auditFromRequest` used by ordinary route handlers still swallow
insert failures so low-risk business operations are not blocked.

### Sanitizer failure

Unexpected sanitizer exceptions fall back to a minimal
`{ _audit: "[SANITIZER_FAILURE]" }` payload. Raw input is never persisted or
logged.

## Limitations and deferred SEC-05B work

- Ordinary routes may still pass broad `parsed.data` objects; the sanitizer
  redacts sensitive keys/values, but narrowing every caller to explicit
  allowlists is deferred.
- Setting upserts use an explicit builder that records key/dataType/presence
  only — never the raw setting value.
- Free-text void/discount reasons remain free-text; recognizable secret shapes
  (Bearer/JWT/opaque 40+ tokens/bcrypt) are redacted, but short opaque PINs
  typed into reasons may still require operational discipline.
- Inconsistent high-risk “best-effort vs transactional” audit policy across
  modules should be standardized as SEC-05B.
- Physical scrubbing of pre-SEC-05A audit rows is deferred.
- Audit-log encryption, signing, WORM storage, retention jobs, and SIEM
  integration are out of scope.
