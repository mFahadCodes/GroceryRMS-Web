# PIN security backend contract (SEC-02A)

Four-digit POS PINs have only 10,000 possible values, so they are convenience credentials rather than passwords and require slow hashing plus persistent abuse controls.

## Deployment and storage

`PIN_PEPPER` is required for every PIN creation and verification operation. Supply a randomly generated deployment secret with at least 32 bytes of entropy. It has no fallback, must not reuse `AUTH_SECRET`, and must never be stored in the database or source control.

New PINs are stored as `pin-v2$<bcrypt-hash>`. The bcrypt input is a domain-separated HMAC-SHA-256 value bound to the authoritative numeric user ID. bcrypt cost 12 is retained. The HMAC result and pepper are never stored. Existing strict SHA-256 legacy hashes are verified only for lazy migration; a successful verification replaces the legacy hash and resets user failure state in the same transaction. Malformed v2 hashes are never downgraded to legacy handling.

## Explicit identity and API errors

PIN verification never discovers identity from a PIN. `/api/auth/login` PIN mode and `/api/auth/validate-pin` now require `{ "userId": number, "pin": "four ASCII digits" }`. Unknown, inactive, deleted, unconfigured, malformed-hash, and incorrect-PIN cases return `PIN_VERIFICATION_FAILED`. Throttling returns HTTP 429 with a conservative `Retry-After`; unavailable security configuration returns `PIN_SECURITY_UNAVAILABLE`. Responses do not expose counters, lock source, hashes, or account state.

Unknown, inactive, and unusable-hash paths perform a fixed dummy bcrypt comparison. This reduces—but cannot eliminate—timing differences around database and network operations.

## Persistent throttling

User failures decay after 30 minutes without another failure. Failures 1–4 do not lock; failure 5 locks for 60 seconds, failure 7 for five minutes, failure 9 for fifteen minutes, and failures 11+ for thirty minutes. Success clears only that user's failure state.

IP buckets allow 24 failures in a ten-minute window; failure 25 locks the HMAC-derived bucket for fifteen minutes. Raw IP addresses are not stored in the throttle table. Terminal buckets use a threshold of 15 only when a terminal identity is available through an authoritative server-side relationship. Current login and approval sessions do not carry such a trustworthy binding, so terminal throttling is deliberately skipped and IP throttling remains mandatory. Request-body terminal IDs are rejected.

Expired bucket cleanup is opportunistic and bounded. A successful PIN does not clear aggregate attack history.

## Manager verification and PIN administration

Manager approval issuance requires `managerUserId` together with `managerPin` at `POST /api/auth/manager-approvals`. Only that explicit user is verified through this SEC-02A service; password-rotation-required users cannot approve. SEC-02B then issues a short-lived, one-time, session/action/order-bound grant whose raw token is returned once to the requester. Discount and void routes accept only that grant token and never receive a manager PIN. See [`manager-approval-grants.md`](manager-approval-grants.md).

Administrative PIN assignment and changes use v2 hashing, increment `authVersion`, and revoke active sessions transactionally. The permission-protected `POST /api/settings/users/{id}/pin-lockout/reset` endpoint clears only user-specific PIN failure fields. It does not change the PIN, reactivate the user, reset authentication version, or clear aggregate buckets.

Security audit events contain only actor/target identifiers and safe reason codes. PINs, hashes, HMAC values, peppers, throttle keys, JWTs, session identifiers, authorization headers, and request bodies are excluded.

## Deferred frontend work

The existing frontend still submits anonymous quick-login and manager-PIN payloads and must be updated later to select an explicit user/manager, request an SEC-02B grant, hold its raw token in memory only, and submit it once to the exact sensitive operation. Trustworthy terminal enrollment/binding remains deferred; request-body terminal IDs are never authoritative. SEC-02A does not implement PIN recovery, history, uniqueness, expiry, or employee-switching UX.
