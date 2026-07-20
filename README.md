# GroceryRMS

Grocery retail POS web app — rebuilt from the RestaurantPOS recovery package (`GroceryRMS-spec.md`).

## Stack

- Next.js 15 App Router + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Prisma ORM + SQLite (local dev)
- NextAuth.js v5
- Zustand · TanStack Query v5 · Zod · react-to-print

## Money

All amounts are stored as **BigInt paisa** (1 PKR = 100 paisa). Use `lib/currency.ts` helpers in UI.

## Setup

```bash
cp .env.example .env.local
# AUTH_SECRET is pre-filled in .env.example for local dev
npm install
npm run db:push    # create dev.db from schema
npm run db:seed    # roles, permissions, admin user, settings
npm run dev
```

Local database file: `dev.db` (SQLite, no Docker required).

## Default login (after `npm run db:seed`)

| Method | Credentials |
|--------|-------------|
| Password | Username: `admin` · Password: `Admin@123` |
| Quick PIN | PIN: `1234` |

## Troubleshooting login

If login shows "Invalid username or password" but credentials are correct, check the dev server terminal for a `better_sqlite3.node` / `NODE_MODULE_VERSION` error. That means the SQLite native module was built for a different Node.js version than the one running `npm run dev`.

**Fix:**

1. Stop the dev server (`Ctrl+C`).
2. Reinstall the native module using the same Node as your terminal:

```powershell
node -v   # should match the Node used for npm run dev (e.g. v24.x)
Remove-Item -Recurse -Force node_modules\better-sqlite3
npm install better-sqlite3
npm run verify:auth   # should print password OK / PIN OK
npm run dev
```

Verify with `npm run verify:auth` — it checks DB connectivity and seeded credentials.

## API routes (Step 5)

All endpoints require an authenticated session (cookie). Money fields in responses are **string paisa**.

| Method | Path | Permission |
|--------|------|------------|
| GET/POST | `/api/products` | View catalog / Manage products |
| GET/PUT | `/api/products/[id]` | View catalog / Manage products |
| GET/POST | `/api/categories` | View catalog / Manage products |
| GET/PUT | `/api/categories/[id]` | View catalog / Manage products |
| GET/POST | `/api/customers` | Manage customers |
| GET/PUT/DELETE | `/api/customers/[id]` | Manage customers (+ billing/loyalty history on GET) |
| GET/POST | `/api/orders` | Create & process orders |
| GET/PUT | `/api/orders/[id]` | Create & process orders |
| POST | `/api/orders/[id]/checkout` | Process payments + Create orders |
| GET/POST | `/api/shifts` | Open / close shift |
| GET | `/api/reports?type=daily\|salesByCategory\|peakHour` | View reports |

Checkout requires an **open shift** on the given `terminalId`. POST body uses string paisa for `tenderedAmount` and `openingBalance`.

## Build phases

| Step | Status |
|------|--------|
| 1. Project init | Done |
| 2. Prisma schema | Done |
| 3. Seed file | Done |
| 4. Auth | Done |
| 5. API routes | Done |
| 6. Frontend pages | Done |
