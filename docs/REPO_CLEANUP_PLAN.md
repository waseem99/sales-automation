# Repository Cleanup Plan

## Applied in this branch

- Keep one production entry point in `apps/web`.
- Reuse the existing evaluator, routing, portfolio matching, drafting, storage, audit, and pipeline packages.
- Add public-source acquisition in one isolated package: `packages/prospect-discovery`.
- Make the prospect-focused dashboard the default route.
- Keep the previous Lead Desk at `/lead-desk` for existing Upwork/LinkedIn/manual workflows.
- Stop automatic demo seeding unless `SEED_SAMPLE_DATA=true`.
- Replace the development header token as the normal access path with a password-protected signed session cookie.
- Keep lead records and discovery-run history in separate persistent files.
- Keep all outbound communication human-approved.

## After production validation

1. Remove obsolete preview-only branches and documentation.
2. Consolidate duplicate lead-store environment variable names.
3. Replace sample portfolio fixtures with the approved production portfolio source.
4. Move JSON persistence to PostgreSQL without changing repository contracts.
5. Move the in-process 24-hour scheduler to a dedicated worker when volume requires it.
6. Archive stale demo fixtures after real data is available.
7. Split the current server-rendered UI into reusable view components only when maintenance cost justifies it.

The cleanup sequence intentionally protects the primary goal: finding new prospects. Structural refactoring should not delay source discovery, contact extraction, deduplication, daily scheduling, or evidence delivery.
