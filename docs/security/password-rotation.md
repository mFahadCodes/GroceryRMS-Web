# Password rotation backend contract

New administrators created by secure bootstrap are marked `mustChangePassword = true` and must replace their initial password. Existing users migrate with the safe default `false`; SEC-01B does not introduce periodic expiration, password history, recovery tokens, or email reset.

`POST /api/auth/change-password` accepts only `currentPassword` and `newPassword`. It returns the standard success envelope with `passwordChanged: true` and `reauthenticationRequired: true`. Stable failures include `UNAUTHORIZED`, `CURRENT_PASSWORD_INVALID`, `PASSWORD_POLICY_VIOLATION`, `PASSWORD_REUSE_NOT_ALLOWED`, and `PASSWORD_CHANGE_FAILED`.

The current password must verify, the replacement must satisfy the shared policy in `lib/security/password-policy.ts`, and it must differ from the current password. Password hashing, rotation-state clearing, timestamping, authentication-version increment, revocation of all sessions, and a non-sensitive audit event commit in one database transaction. No replacement session is issued; the Auth.js cookie is cleared and the user must log in again.

The database-authoritative principal carries `mustChangePassword`. The central API guard denies ordinary protected operations with `PASSWORD_CHANGE_REQUIRED`. Only the password-change endpoint, logout, and Auth.js session retrieval needed to expose the boolean are available while rotation is pending. PIN validation, administration, orders, inventory, reports, settings, payments, and all other business APIs remain denied.

Future frontend work must:

1. Read `mustChangePassword` from the authenticated session.
2. Redirect to a password-change screen and prevent ordinary navigation.
3. Submit current and new passwords only to the backend endpoint.
4. Clear client state and return to login after success.
5. Never retain passwords in client storage.
