# Application Shell and Operations Dashboard

## Scope

F1 establishes the authenticated, non-financial frontend foundation for
GroceryRMS-Web. It adds a responsive application shell, permission-aware
navigation, a consistent page-header and breadcrumb pattern, and a read-only
operations dashboard at the existing `/` route.

The work preserves the current Next.js App Router, Tailwind CSS v4 tokens,
Auth.js session model, TanStack Query setup, Lucide icon package, and existing
route names. No dependency, backend endpoint, database schema, business rule,
or financial workflow changes are included.

## Existing architecture

- `app/layout.tsx` provides the Auth.js and TanStack Query client providers.
- `app/(dashboard)/layout.tsx` wraps the existing authenticated product pages in
  `DashboardShell`.
- `app/page.tsx` uses the same `DashboardShell` for the existing root route.
- Client permissions are the existing session permission tokens and are checked
  with the shared `hasPermission` helper.
- API responses use the existing `{ success, data }` envelope through
  `apiFetch`.
- UI styling uses the existing semantic CSS variables and Tailwind utilities in
  `app/globals.css`.

## Components added

- `navigation.ts` owns the existing-route navigation metadata, permission
  requirements, visibility filtering, nested active-route matching, and route
  context.
- `SidebarNavigation` renders a presentational, labeled navigation landmark and
  applies `aria-current="page"` to the exact or nested active route.
- `DashboardShell` composes the responsive desktop/tablet sidebar, top bar,
  mobile drawer, skip link, and main-content landmark.
- `PageHeader` and `Breadcrumbs` provide a consistent heading hierarchy and
  optional route context.
- `DashboardMetricCard`, `DashboardSection`, and `StatusBadge` provide narrow
  presentational dashboard primitives.
- `LoadingSkeleton`, `EmptyState`, `InlineErrorState`, and `NoAccessState`
  provide reusable operational states.
- `DashboardView` coordinates permission-scoped read queries and presents each
  section independently.

## Navigation and permissions

Navigation contains only routes that existed before F1:

- `/` — Dashboard; available to every authenticated user.
- `/pos` and `/orders` — require `Create & process orders`.
- `/catalog` — requires `View catalog`.
- `/inventory` — requires `Manage inventory`.
- `/reports` — requires `View reports & analytics`.

Permission checks reuse the exact existing permission strings and access-level
tokens. A missing or level-zero permission hides the associated link. Root
matching is exact; other links remain active for their nested routes.

The top bar identifies the current application area. Individual pages retain
their primary `h1`; the shell context is deliberately not another heading.

## Responsive behavior

### Desktop

At extra-large widths, a persistent full-width sidebar shows icons and labels.
The top bar remains sticky, content is constrained by each page, and all shell
containers use `min-width: 0` to avoid page-level horizontal overflow.

### Tablet

From the medium breakpoint, the sidebar stays persistent in a compact
icon-first form. Link labels remain available to assistive technology and as
native title text, then become visible again at the extra-large breakpoint.

### Mobile

Below the medium breakpoint, a 44-pixel minimum touch target opens a modal
drawer. The drawer:

- has an accessible trigger, state, and controlled element relationship;
- closes on Escape, backdrop selection, close-button selection, or route
  selection;
- disables background document scrolling while open;
- restores focus to the menu trigger for explicit dismissal;
- focuses the close button on opening; and
- uses a separately labeled mobile navigation landmark.

No new animation library is used. Global reduced-motion styles minimize
animation and transition duration.

## Dashboard data sources

The dashboard calls only existing GET routes:

| Section | Endpoint | Existing permission | Value used |
| --- | --- | --- | --- |
| Current shift | `GET /api/shifts` | `Open / close shift` | Open state, start time, and included terminal |
| Today’s orders | `GET /api/orders?page=1&pageSize=5&scope=today` | `Create & process orders` | Backend pagination count and five recent order records |
| Low stock | `GET /api/inventory/low-stock` | `Manage inventory` | Returned low-stock product collection |

The order count is the endpoint’s pagination `meta.total`. Order totals displayed
in the recent list are formatted directly from each backend-provided
`grandTotal` string; they are never summed or recalculated.

The low-stock count is the size of the endpoint’s complete low-stock collection.
No stock threshold is recalculated by the dashboard.

## Unsupported or intentionally omitted metrics

The dashboard does not show revenue, sales totals, tax, discounts, payment
breakdowns, peak hour, or other financial aggregates. Although report GET routes
exist, the current daily-summary service may generate and persist a summary.
F1 excludes that path to keep dashboard access strictly read-only.

No terminal is inferred when an open shift has no terminal. No fallback financial
value, sample metric, fixture, random value, or production placeholder is used.

## Loading, empty, error, and no-access behavior

Each permitted query has an isolated loading state. Recent orders, current shift,
and stock attention each have a domain-specific empty state.

Errors use fixed safe messages and never render raw response bodies, details,
database messages, or stack traces. Safe GET failures offer a manual Retry
control; there is no polling and automatic retries are disabled for these
dashboard queries.

An HTTP 403 becomes a permission-specific no-access state without rendering
restricted content. Users with none of the three operational permissions receive
one generic no-access panel. Disallowed queries are not sent.

## Accessibility

- A keyboard-visible skip link targets the single shell `main` landmark.
- Desktop and mobile navigation landmarks have distinct accessible names.
- Active links use `aria-current="page"`.
- The mobile trigger exposes its name, expanded state, and controlled drawer.
- The mobile drawer is labeled as a modal dialog.
- Escape dismissal, initial drawer focus, focus restoration, and listener
  cleanup are implemented without an additional library.
- Primary pages use one `h1`; dashboard sections use `h2`.
- Breadcrumbs use a labeled navigation landmark and mark the final item current.
- Loading states use `role="status"` and `aria-busy`.
- Section errors use `role="alert"`.
- Decorative icons are hidden from assistive technology.
- Focus-visible rings and reduced-motion behavior use existing CSS primitives.

## Read-only guarantees and parallel boundaries

Dashboard code uses `useQuery` only. It contains no mutation hook, non-GET request
method, idempotency key, manager approval token, financial attempt state, retry
executor, or global fetch interceptor.

F1 does not modify checkout, partial payment, refund, return, void, financial
idempotency, manager-approval attempt handling, backend API routes, backend
services, Prisma files, packages, lockfiles, `docs/security/**`, or `docs/ai/**`.
Those areas remain owned by the parallel financial-integration branch.

The source-regression suite uses two fail-closed verification modes. In a normal
full-history repository, it confirms the approved baseline commit exists and
checks changed paths with a merge-base diff from that baseline to `HEAD`. In a
shallow CI checkout where that object is genuinely unavailable, it first proves
the repository is shallow and then inspects the complete expected F1 source set
for financial UI coupling, mutations, backend or Prisma imports, global request
interception, idempotency injection, fake metrics, random identifiers, and P0-D
internals. The structural fallback does not claim historical diff coverage.

## Deferred frontend areas

- Password-rotation and explicit PIN-user selection UI remain deferred.
- Manager-selection and manager-approval financial UX remain deferred.
- Financial mutation idempotency and recovery UX remain on the parallel branch.
- A truly read-only backend-provided sales-summary contract would be required
  before financial summary metrics can be added to this dashboard.
- Browser-level interaction tests can be added when a browser test runner is
  approved and already available; F1 adds no testing dependency.
