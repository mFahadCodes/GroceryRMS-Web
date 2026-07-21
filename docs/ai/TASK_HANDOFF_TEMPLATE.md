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

### Required commands

npm run db:generate && npm run lint && npm run typecheck && npm run test && npm run check && npm run build && git diff --check

### Stop conditions

- <Task-specific stops, plus the standard ones in AGENTS.md.>

### Commit plan

- <Expected logical commits with conventional subjects.>

### Final report fields

Branch, commits, files changed, schema/migration changes, API contract changes,
tests added, test totals, lint/typecheck/build results, CI result, database-safety
confirmation, secret-scan result, deferred work, main hash after merge.
```
