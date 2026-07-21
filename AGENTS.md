# AGENTS.md — Universal AI-Agent Contract for GroceryRMS-Web

This file is the primary contract for **any** AI agent working in this repository.
Detailed, tool-specific rules live in `.cursor/rules/`; maintained project state lives
in `docs/ai/`. This file summarizes the non-negotiables and does not duplicate them.

## Product and phase

- GroceryRMS-Web is a grocery retail POS web application (Next.js App Router,
  TypeScript, Prisma, SQLite in development) with a production, business-grade goal.
- The project is in a **backend-first** phase. The frontend is intentionally
  incomplete; frontend changes require explicit human approval
  (see `.cursor/rules/60-frontend-boundary.mdc`).

## Repository boundary

- This directory is the **only Git repository** in the workspace. Never run Git
  commands outside it, never initialize Git elsewhere, and never add root-workspace
  reference material (`../reference/**`) to this repository
  (see `docs/ai/ROOT_REFERENCE_MAP.md`).

## Git workflow

- Verify the exact approved `main` hash before starting a task; work on a dedicated
  branch; make logical commits; push the branch.
- **Never**: commit to `main` directly, create PRs automatically, merge automatically,
  force push, rebase/rewrite history, or amend pushed commits.
  Details: `.cursor/rules/20-git-workflow.mdc`.

## Database safety

- Never read, modify, migrate, or seed `dev.db`. Tests use disposable SQLite databases
  under `.tmp/` only. Schema changes require reviewed Prisma migrations; no production
  `db push`. Details: `.cursor/rules/40-prisma-database.mdc`.

## Secrets

- Never print, store, or commit passwords, PINs, `PIN_PEPPER`, `AUTH_SECRET`, tokens,
  or credential-bearing connection strings — in code, tests, docs, logs, or reports.
- Security invariants (bootstrap, sessions, rotation, PIN hardening) are recorded in
  `.cursor/rules/30-backend-security.mdc` and `docs/security/`; do not weaken them.

## Quality gates

Every task must pass, with zero skipped tests and no `.only`:

```bash
npm run db:generate
npm run lint
npm run typecheck
npm run test
npm run check
npm run build
git diff --check
```

CI is the GitHub Actions **Quality Gates** workflow. Details:
`.cursor/rules/50-testing-quality.mdc`.

## Stop conditions

Stop and ask a human when a task would require: frontend changes, Prisma schema or
migration changes outside the approved scope, weakening a security invariant or test,
touching `dev.db`, history rewriting, or anything whose purpose is unclear.

## Where to look

- Current verified state (hash, counts, phases): `docs/ai/CURRENT_STATE.md`
- Roadmap: `docs/ai/SECURITY_ROADMAP.md`
- Workflow: `docs/ai/DEVELOPMENT_WORKFLOW.md`
- Architecture decisions: `docs/ai/ARCHITECTURE_DECISIONS.md`
- Cursor rules: `.cursor/rules/`

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
