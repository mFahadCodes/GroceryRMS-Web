# Task Handoff Template

Copy this template for every new task brief.

```markdown
## Task: <short name>

- **Approved main hash (full):** <40-char SHA — verify with `git rev-parse HEAD`>
- **Branch:** <e.g. fix/sec-02b-approval-grants>

### Goal

<One paragraph: the outcome, not the implementation.>

### Scope

- <Exactly what may change (files, modules, endpoints).>

### Out of scope

- <Explicitly excluded work, e.g. frontend, schema changes, refactors.>

### Security / business invariants

- <Invariants from .cursor/rules/30-backend-security.mdc and ARCHITECTURE_DECISIONS.md that this task must not weaken.>

### Files to inspect first

- <Source, tests, docs relevant to the task.>

### Migration requirements

- <"None" or the exact reviewed migration expected.>

### Tests

- <New/updated tests required, including concurrency coverage where transactional.>

### Plugin usage

Apply only the plugins required or made conditional by
`docs/ai/PLUGIN_OPERATING_MODEL.md`.

- **Plugins consulted:** <plugin names, or "none applicable">
- **Reason for each:** <task-specific purpose>
- **Context7 documentation:** <library/version/topic retrieved, or "not applicable">
- **Prisma guidance:** <schema/migration/query topic, or "not applicable">
- **Semgrep findings:** <classified findings, unavailable, or "not applicable">
- **SonarQube findings:** <hotspots/quality findings, unavailable, or "not applicable">
- **Sonatype findings:** <dependency analysis, authentication required, or "not applicable">
- **Cursor Team Kit review:** <workflow and result>
- **Findings implemented:** <items>
- **Findings deferred:** <items and reason>
- **False positives:** <items and justification>
- **Scope confirmation:** <confirm no plugin expanded the approved task>

### Required commands

npm run db:generate && npm run lint && npm run typecheck && npm run test && npm run check && npm run build && git diff --check

### Stop conditions

- <Task-specific stops, plus the standard ones in AGENTS.md.>

### Commit plan

- <Expected logical commits with conventional subjects.>

### Final report fields

Branch, commits, files changed, schema/migration changes, API contract changes,
tests added, test totals, lint/typecheck/build results, CI result, database-safety
confirmation, secret-scan result, plugin usage/findings, deferred work, main hash
after merge.
```
