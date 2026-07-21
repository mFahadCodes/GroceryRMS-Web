# Development Workflow

Every task follows this sequence:

1. **Synchronize main**: `git fetch origin --prune`, `git switch main`, `git pull --ff-only origin main`.
2. **Verify the exact approved hash**: `git rev-parse HEAD` must equal the full commit hash approved for the task. Stop on mismatch.
3. **Run baseline checks** before changing anything: `npm ci` (when dependencies changed), `npm run db:generate`, `npm run check`.
4. **Create a dedicated branch** (`fix/…`, `feat/…`, `test/…`, `chore/…`). Never work on `main`.
5. **Inspect before editing**: read the relevant source, tests, migrations, and `docs/ai/` state.
6. **Implement the smallest approved scope.** Stop when unapproved frontend, schema, security, or business changes become necessary.
7. **Add tests** covering the change, including concurrency tests for transactional state.
8. **Run all checks**:

   ```bash
   npm run db:generate
   npm run lint
   npm run typecheck
   npm run test
   npm run check
   npm run build
   git diff --check
   ```

9. **Commit logically** with conventional messages.
10. **Push the branch** (`git push -u origin <branch>`). Never push `main`; never force push.
11. **Wait for CI** ("Quality Gates") to pass on the branch.
12. **A human creates and merges the PR.** Never create or merge a PR automatically.
13. **Synchronize main** again after the merge.
14. **Update `docs/ai/CURRENT_STATE.md`** (and roadmap/decisions when relevant) so the maintained documentation matches reality.
