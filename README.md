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
# Replace environment placeholders with secure local values.
npm install
npm run db:push    # create dev.db from schema
npm run db:seed    # roles, permissions, first-admin bootstrap, settings
npm run dev
```

Local database file: `dev.db` (SQLite, no Docker required).

## Secure administrator bootstrap

Administrator bootstrap is environment-driven and runs only when the database has no user assigned to the authoritative `admin` role.

1. Create a local `.env.local` file or configure deployment secrets for the intended environment.
2. Set `BOOTSTRAP_ADMIN_USERNAME`.
3. Set `BOOTSTRAP_ADMIN_PASSWORD` to a strong password or passphrase of at least 15 characters and no more than 72 UTF-8 bytes.
4. Optionally set `BOOTSTRAP_ADMIN_PIN` to a non-repeated, non-sequential 4-digit PIN. No PIN is generated when this value is omitted.
5. Run the approved seed command only against the intended database.
6. Confirm that the seed reports that the administrator was created.
7. Remove the bootstrap variables from the runtime environment after successful creation.
8. Never commit real bootstrap values to source control, examples, fixtures, tests, logs, or CI.
9. Re-running the seed preserves every existing administrator account and its username, password hash, PIN hash, role assignment, identity, and active state.
10. If the requested username already belongs to a non-administrator, bootstrap fails instead of promoting or overwriting that account.

When an administrator already exists, bootstrap variables are ignored and are not required. Mandatory first-login password rotation is deferred to a later backend security phase.

The smoke and credential-verification scripts require explicit `SMOKE_ADMIN_USERNAME` and `SMOKE_ADMIN_PASSWORD` environment values. `SMOKE_ADMIN_PIN` is optional for `npm run verify:auth`. These scripts do not fall back to bootstrap values or tracked credentials.

## Troubleshooting login

If login shows "Invalid username or password" but credentials are correct, check the dev server terminal for a `better_sqlite3.node` / `NODE_MODULE_VERSION` error. That means the SQLite native module was built for a different Node.js version than the one running `npm run dev`.

**Fix:**

1. Stop the dev server (`Ctrl+C`).
2. Reinstall the native module using the same Node as your terminal:

```powershell
node -v   # should match the Node used for npm run dev (e.g. v24.x)
Remove-Item -Recurse -Force node_modules\better-sqlite3
npm install better-sqlite3
$env:SMOKE_ADMIN_USERNAME="<set-securely>"
$env:SMOKE_ADMIN_PASSWORD="<set-securely>"
npm run verify:auth
npm run dev
```

The placeholders above are documentation markers, not usable credentials. Supply real verification values only through the local process environment.

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
