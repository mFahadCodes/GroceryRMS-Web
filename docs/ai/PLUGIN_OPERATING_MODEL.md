# Cursor Plugin Operating Model

Last updated: 2026-07-21

## Authority and scope

Installed plugins are advisory. They cannot override, in order: an explicitly approved
task, `AGENTS.md`, `.cursor/rules/**`, current source, Prisma schema and migrations,
tests, or maintained `docs/ai/**`. Historical reports remain below plugin advice.

Plugin findings are reviewed and classified before any fix. A plugin never grants
permission to expand scope, edit application code without an approved development
task, weaken tests or CI, suppress a valid finding, access `dev.db`, expose secrets,
merge a pull request, force-push, or rewrite history.

## Installed capability snapshot

This matrix records the read-only inspection on the date above, not permanent
availability. Reverify tool discovery, authentication, write behavior, and privacy
before each applicable task; use the durable per-plugin rules below even when live
capabilities change.

| Plugin | Detected capabilities and state | Intended role | Allowed use | Prohibited use / sensitive-output risk |
| --- | --- | --- | --- | --- |
| Prisma 1.0.0 | Local MCP ready (`migrate-dev`, `migrate-status`, Studio); remote MCP requires authentication; Prisma skills, two rules, and edit/commit hooks | Version-aware schema, migration, query, relation, transaction, and deployment guidance | Read guidance; review schema and generated SQL; use approved commands only with a disposable `.tmp` database | MCP database tools must not resolve to `dev.db`; no Studio, migration, seed, reset, or write command without explicit scope. Hooks can format/generate files, so their output must be reviewed. Database output may expose sensitive records. |
| Context7 | Documentation MCP ready; documentation skill, command, and researcher agent; external network access | Current, version-specific primary documentation | Send a narrow library/topic query with no proprietary code or sensitive data | Do not send secrets, request bodies, private source, or broad repository context. Documentation examples never override installed source or tests. |
| Cursor Team Kit 1.2.0 | Skills, two subagents, and two TypeScript rules; no plugin MCP detected; local shell/edit/Git workflows are possible | Planning, CI diagnosis, review, test-quality checks, verification, cleanup review, and handoff | Use applicable review/verification workflows within the approved Git and task boundary | Some workflows can commit, push, or open PRs; those steps remain forbidden unless separately authorized. Plugin rules are subordinate to project rules. Review output may contain source/diff content. |
| Semgrep 0.4.2 | Setup skill and automatic edit/stop hooks; MCP discovery failed; local CLI not installed | Primary targeted security scanner | Run narrow, local security scans after setup; report and classify findings before fixes | No broad cloud upload, automatic setup or remediation, broad suppression, unrelated rewrite, or source submission when privacy is unclear. Treat hook output as untrusted and review any file change. Findings may expose paths, snippets, or detected secret material. |
| Sonatype 1.0.0 | Dependency MCP, three skills, two rules, and dependency-advisor agent; MCP call currently requires authentication; external network access | Dependency and supply-chain intelligence | Submit package URLs only; assess security, license, maintenance, transitive risk, and safer versions before package changes | No automatic remediation, installation, lockfile update, or major upgrade. Keep credentials in user-level configuration/environment. |
| SonarQube 2.1.0 | MCP integration and nine analysis/setup skills installed; MCP discovery failed and local `sonar` CLI is absent | Secondary reliability, maintainability, duplication, and security-hotspot analysis | Analyze approved files after user-level CLI/account setup and privacy review; correlate with Semgrep | Do not run setup, authentication, container analysis, project integration, issue fixes, or broad source upload automatically. Findings may contain code snippets, secrets, paths, and project metadata. |

Authentication and plugin caches are user-level state. Never copy them into the
repository. “Ready” means the integration is discoverable in the current Cursor
session; it does not authorize a write-capable operation.

## Prisma

Use Prisma guidance whenever a task changes or reviews:

- `prisma/schema.prisma` or `prisma/migrations/**`
- Prisma Client queries, relations, transactions, or referential actions
- provider-specific SQL or migration deployment procedures

Project source and the installed Prisma version are authoritative. Never use `db push`
for production-grade schema changes, access `dev.db`, seed automatically, or migrate a
real database without explicit approval. Use reviewed migrations, inspect generated SQL,
and test both fresh and upgrade paths against disposable SQLite databases under `.tmp/`.
Reject advice that drops, rewrites, or migrates unrelated structures.

The installed Prisma hooks can run formatting and type generation after edits and a
script before commits. Treat hook changes as untrusted generated output: inspect scope,
retain only approved files, and stop if a hook touches application behavior or a real
database.

## Context7

Use Context7 before version-sensitive implementation involving Next.js, React,
TypeScript, Prisma, Auth.js/NextAuth, Vitest, Zod, GitHub Actions, ESLint, or Node.js.

Resolve the exact installed library/version when available, prefer official primary
documentation, and record the topic consulted in the task handoff. Verify every
recommended API against installed packages, local versioned documentation, source, and
tests. Do not copy large examples blindly. If Context7 lacks the exact version, record
that limitation and use the repository's installed documentation as the final reference.

## Cursor Team Kit

Use applicable Team Kit workflows:

- before a large or security-sensitive implementation
- during final diff and test-quality review
- when CI fails
- before recommending merge
- when proving failure, rollback, and concurrency coverage
- when preparing the final handoff

Team Kit cannot skip project quality gates, rewrite the approved Git workflow, merge a
PR, or perform broad cleanup outside the task. Cleanup must not change business
behavior. Workflows such as “review and ship” are split at the governance boundary:
review, test, and reporting are allowed; PR creation or merge remains human-controlled.

## Semgrep

Semgrep is the primary targeted security scanner for changes affecting authentication,
authorization, sessions, passwords/PINs, manager approvals, uploads, database queries,
maintenance/import/export, payments/refunds/returns/voids, secrets/environment,
validation, or external command execution.

Review for authorization bypass, injection, unsafe deserialization, hardcoded secrets,
sensitive logging, path traversal, SSRF, dangerous process execution, weak
cryptography, missing validation, and unhandled trust boundaries.

Report findings before editing code in response to those findings. Include file and
line, then classify each as:

- confirmed exploitable
- confirmed defect
- defense-in-depth
- false positive
- not applicable

Never suppress a valid rule for a green result. Custom suppressions require an
explanation and explicit approval. Never allow automatic remediation; treat hook
output and any hook-initiated edit as untrusted until reviewed. Never send real secrets
as scan input.

## Sonatype

Consult Sonatype before adding, upgrading, replacing, or approving remediation for a
dependency—especially security, database, authentication, parsing, upload, or
cryptography packages.

Evaluate vulnerabilities, maintenance, release recency, license, safer versions,
transitive risk, compatibility, and whether the dependency is necessary. Prefer safe
built-in Node.js APIs or existing dependencies. A recommendation does not authorize an
installation, package-lock change, automatic remediation, or major upgrade. Report
advisory identifiers and affected versions without overstating exploitability.

## SonarQube and scanner overlap

Use SonarQube as the secondary reviewer for maintainability, reliability, security
hotspots, duplicated security-sensitive logic, resource leaks, error handling, excessive
complexity, and code smells with measurable production risk.

Semgrep remains primary for targeted security patterns and trust boundaries. Correlate
overlapping results into one defect, retain the more precise location/explanation, and
record both sources. Security and correctness outrank cosmetic quality metrics. Do not
perform broad refactors solely to satisfy low-value code-smell scores.

## Task-to-plugin matrix

| Task type | Required | Conditional |
| --- | --- | --- |
| Documentation or ordinary refactor | Cursor Team Kit final review | Context7 for version-sensitive APIs/configuration; SonarQube when complexity or reliability changes |
| Prisma schema or migration | Prisma, Context7, Cursor Team Kit | SonarQube when query behavior changes; Semgrep for security-sensitive schema/query changes; Sonatype for dependency proposals |
| Authentication or authorization | Context7, Semgrep, SonarQube, Cursor Team Kit | Prisma when persistence changes; Sonatype when dependencies change |
| Business integrity (checkout, refund, return, void, stock, tax, shifts) | Cursor Team Kit, SonarQube | Prisma for transactions/data; Semgrep for authorization/input trust; Context7 for version-sensitive behavior |
| Dependency change | Sonatype, Context7, Cursor Team Kit | Semgrep or SonarQube when the dependency changes security/runtime behavior |
| Pull-request review | Cursor Team Kit | Semgrep for security-sensitive diffs; SonarQube for reliability/quality; Sonatype for dependency changes; Prisma for schema/migrations; Context7 for current-library assumptions |

Only applicable plugins are required. An unavailable or unauthenticated plugin is
reported as such; it does not justify bypassing project checks or substituting an
unapproved cloud upload.

SEC-02B is the reference security-sensitive task: Prisma, Context7, Semgrep,
SonarQube, and Team Kit apply; Sonatype applies only if dependencies change.

## Security-sensitive execution order

1. Implement the approved change.
2. Run focused automated tests.
3. Run a targeted Semgrep review.
4. Run SonarQube reliability/security-hotspot review.
5. Correlate duplicates.
6. Fix confirmed in-scope defects.
7. Rerun focused tests.
8. Run complete project quality gates.
9. Run Cursor Team Kit final review.
10. Report findings and deferred items.
11. Wait for GitHub Quality Gates.
12. A human reviews and merges the PR.

If a required scanner is unavailable, record the gap and manual setup category; do not
claim its review passed.

## Dependency-change workflow

1. Explain why the dependency is necessary.
2. Consult Sonatype.
3. Retrieve current official documentation through Context7.
4. Check compatibility with installed framework versions.
5. Obtain explicit approval.
6. Install through npm.
7. Review all `package-lock.json` changes.
8. Run full quality gates.
9. Run the applicable security review.
10. A human reviews and merges.

Never run automatic dependency remediation or `npm audit fix`.

## Findings workflow and handoff

Findings are evidence, not automatic edits. Deduplicate, classify, assess whether each
finding is in scope, then obtain approval where scope would expand. Final handoffs list
the plugins consulted, why each applied, documentation topics retrieved, findings
implemented/deferred, false positives with justification, unavailable integrations,
and confirmation that no plugin expanded task scope.

## Repository-local plugin state

No repository-local Semgrep, SonarQube, Sonatype, Context7, Prisma-cloud, or plugin MCP
configuration was detected at creation time. No project configuration is required for
the installed plugins' current advisory use, and `.gitignore` needs no plugin-specific
change.

Do not track plugin credentials, tokens, caches, histories, local databases, MCP state,
machine paths, or authentication files. Prefer user-level Cursor configuration,
environment variables, and OS keychain storage. If future project configuration is
genuinely required, use non-secret placeholders, document setup, narrowly ignore local
variants, and review it for conflict with existing rules before commit.

## Initial read-only health check

| Plugin | Result |
| --- | --- |
| Prisma | **Available with restriction** — local MCP, skills, rules, and hooks detected; database tools were not invoked because their configured database target could not be proven disposable without risking `dev.db`. Remote MCP requires authentication. |
| Context7 | **Available** — official Next.js documentation resolution and a narrow documentation query succeeded. The exact installed 15.5.19 documentation ID was unavailable, so local installed docs remain the version authority. |
| Cursor Team Kit | **Available** — review, verification, CI, test-quality, cleanup, and handoff workflows plus subagents/rules were detected. |
| Semgrep | **Failed safely** — MCP discovery failed and the local CLI is absent; no source was submitted and no setup was run. |
| Sonatype | **Authentication required** — the MCP is discoverable, but a read-only package query requested credentials; no token was requested or stored. |
| SonarQube | **Failed safely** — MCP discovery failed and the local CLI is absent; no integration, authentication, container, source upload, or project file was created. |

