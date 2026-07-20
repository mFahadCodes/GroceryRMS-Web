# Prisma migration baseline

GroceryRMS-Web originally used `prisma db push` without a committed migration history. The `20260720_000000_baseline` migration captures the exact merged-main schema before authoritative sessions were introduced. It contains schema creation only and does not seed data or credentials.

## Fresh databases

Run `prisma migrate deploy` through the approved deployment process. Prisma applies the baseline first and then each later migration in order. Do not use `prisma db push` in production.

## Adopting the baseline for an existing database

1. Back up the database and retain a verified restore point.
2. Test the entire procedure on a database copy.
3. Verify that the existing schema matches `20260720_000000_baseline` exactly.
4. Mark only the baseline as already applied with `prisma migrate resolve --applied 20260720_000000_baseline`.
5. Run `prisma migrate deploy` to execute later migrations.
6. Never mark an SEC-03A migration as applied unless its SQL has actually executed successfully.

Do not run migration adoption commands against `dev.db` as part of development or verification. A schema mismatch must be investigated instead of bypassed with `migrate resolve`.
