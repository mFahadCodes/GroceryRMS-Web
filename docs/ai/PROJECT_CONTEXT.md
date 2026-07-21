# Project Context

## Purpose

GroceryRMS-Web is a grocery retail point-of-sale (POS) and retail-management web
application. The objective is a production, business-grade system: correct money
handling, auditable operations, and hardened authentication suitable for real store
deployments.

## Domain

Grocery retail: product catalog with variants and barcodes, inventory (stock
movements, purchase orders, stock takes), orders (checkout, refunds, returns, voids,
partial payments, delivery), customers and loyalty, shifts and cash drawer,
employees/payroll/expenses/suppliers, reports, and store settings (users, roles,
permissions, terminals, printers, tax rates, payment methods).

## Technology stack

- **Next.js App Router** (Next 15) with **TypeScript**
- **Prisma ORM** with **SQLite** for local development and disposable test databases;
  PostgreSQL production migration is deferred
- **Auth.js (NextAuth v5)** cookies backed by database-authoritative sessions
- Vitest for tests; Tailwind CSS v4, Zustand, TanStack Query on the frontend
- Money is stored as **BigInt paisa** (1 PKR = 100 paisa) and serialized as string paisa in API responses

## Architectural boundaries

- `app/api/**` — HTTP route handlers (validation, RBAC, response envelopes)
- `lib/services/**` — business logic and transactions
- `lib/security/**` — authentication, sessions, password policy/rotation, PIN hashing and throttling
- `lib/validators/**` — Zod schemas
- `prisma/**` — schema, reviewed migrations, and environment-driven seed/bootstrap
- `tests/**` — unit and security tests using disposable `.tmp/` SQLite databases

## Frontend state

Frontend pages exist (login, POS, catalog, inventory, orders, reports) but are
intentionally incomplete and behind the backend contracts. The current phase is
backend-first; frontend integration is deferred and requires explicit approval.

## Relationship to recovered RPOS

The original product is a compiled .NET WPF desktop application ("RestaurantPOS"),
recovered by decompilation into reference material stored **outside this repository**
(see `ROOT_REFERENCE_MAP.md`). RPOS is a behavioral reference only: preserve valid
business behavior; do not replicate legacy defects, legacy seeded credentials, or
legacy security practices.
