# Authoritative sessions and authentication versions

SEC-03A keeps Auth.js encrypted JWT cookies for compatibility, but JWT signature validation is no longer sufficient authorization. A correctly signed token can be stale after an account, credential, role, permission, or server-side session change. Every protected request therefore validates current database state before it is accepted.

## Token and database binding

Each successful credential login creates one `UserSession` row. Prisma generates an unpredictable CUID `sessionId`; the server never accepts that identifier from login input. The row stores its user, expiry, and the user's current `authVersion`. The encrypted JWT carries the user ID, opaque session ID, and authentication version. Raw JWTs, cookies, authorization headers, passwords, and PINs are never stored in the database.

The authoritative validator rejects authentication unless all of the following remain true:

- The required JWT claims are present and well-formed.
- The user exists and is active.
- The role relationship exists and the role is active.
- The database session exists, belongs to the user, is active, is not logged out, and has not expired.
- The JWT, session, and user authentication versions match.

Database errors fail closed. External responses remain generic and do not disclose which validation check failed. Role and permission tokens are rebuilt from the current role relationship after successful validation.

## Revocation and invalidation

Normal logout revokes only the current database session and then clears the Auth.js cookie. Other concurrent sessions remain valid.

Password changes, PIN changes, user deactivation/reactivation, user role changes, logout-all operations, and soft deletion increment the user's `authVersion` and revoke active sessions in the same transaction as the mutation. Reactivation cannot restore an old token.

Changing a role's permission assignments increments `authVersion` and revokes active sessions for every user assigned to that role in the same transaction. Users assigned to other roles are unaffected. Administrator revocation of one session changes only the selected session and is idempotent.

## Deployment effect

Sessions and JWTs created before SEC-03A do not have the required opaque session ID, expiry, and authentication version binding. They are rejected and are never silently upgraded. Deployment therefore causes a one-time logout of previously authenticated users; this is intentional.

See [the migration baseline guide](../database/migration-baseline.md) before adopting migrations for an existing database. Test migration and authentication changes against a database copy before production deployment.
