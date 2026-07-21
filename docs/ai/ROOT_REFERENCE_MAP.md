# Root Reference Map

The workspace root (one level above this repository) contains reference material
that is **outside Git** and outside normal task scope.

## Paths (relative to this repository)

- `../reference/project/` — historical project documents:
  - `specifications/GroceryRMS-spec.md` — original product specification
  - `audits/` — Phase 1–3 audit reports and the backend/frontend gap report (historical; may be outdated)
  - `audits/legacy/GroceryRMS-WebStructure.md` — stale generated structure snapshot
  - `design/STITCH-FRONTEND-DESIGN-SPEC.md` — frontend design reference
  - `recovery-notes/RPOS-DesktopAPP-recovery.md` — recovery narrative
- `../reference/rpos/` — recovered RPOS desktop-application material:
  - `docs/` — RPOS architecture and domain documentation
  - `decompiled-source/` — ILSpy decompilation (reference only, not buildable)
  - `extracted-xaml/` — recovered XAML UI
  - `analysis/`, `tools/` — inventories and extraction tooling
  - `archive/` — original `RPOS.zip` and `compiled-original/` binaries (do not modify)
  - `private/` — machine-local configuration; never commit or copy

## Rules

- These paths are **not part of this Git repository** and must never be added to it.
- They are historical/behavioral reference only. Normal application tasks must not
  modify them; changes require explicit root-workspace authorization.
- When reference material conflicts with this repository, the repository wins:
  source, tests, Prisma migrations, Git history, and `docs/ai/` are authoritative.
