# Prospect query index audit — 2026-07-16

## Release scope

This audit accompanies #155 Phase 2B. It covers the registered Prospect Desk workspace list query introduced in Phase 2A and the fields that the production SQL currently filters or sorts on.

The release deliberately separates three decisions:

1. consolidate the existing summary, filtered-count, owner-list and page-record work into one SQL statement;
2. add only indexes that match predicates already executed by production list queries;
3. defer indexes for fields that are not yet queried in an index-compatible form.

## Aggregate consolidation

The workspace page loader now uses one statement with a materialized `visible` CTE and an index-eligible `filtered AS NOT MATERIALIZED` CTE. That statement returns:

- current-workspace summary metrics;
- the filtered row count;
- the owner option list;
- the clamped page number and total pages;
- the ordered page records.

Statement contract after this release:

- warm list request: **1 data statement**;
- warm request with `leadId`: **2 data statements**;
- cold list request: the existing five schema-assurance statements, one idempotent index-migration statement and one data statement.

The visible summary and owner list share one materialized scope scan. Filtered count and page records remain planner-inlineable so current field and ordering indexes can still be considered. The selected-lead statement remains separate because it is executed only when `leadId` is present.

## Index decisions

| Production predicate or sort | Decision | Index |
| --- | --- | --- |
| normalized owner equality and owner filter | add | `prospect_records_owner_lower_idx` |
| pipeline status equality | add | `prospect_records_pipeline_status_idx` |
| source workspace/equality | add | `prospect_records_source_idx` |
| service category workspace/filter | add | `prospect_records_service_category_idx` |
| lead type workspace | add | `prospect_records_lead_type_idx` |
| opportunity status workspace/filter/summary | add | `prospect_records_opportunity_status_idx` |
| partnership prospect stage | add | `prospect_records_prospect_stage_idx` |
| tender opportunity type | add | `prospect_records_tender_type_idx` |
| rank followed by updated/created time | add | `prospect_records_rank_updated_idx` |
| full-record substring search | defer | requires a separately evaluated trigram or search-vector design |
| follow-up timestamp | defer | `follow_up_at(record)` is currently `STABLE`, so an expression index would not be safe; normalize to a dedicated timestamp column before indexing |
| closeability band | defer | `/priorities` still builds queues from scoped records in memory; an unused JSON expression index would add write cost without serving a production query |

The owner index supports exact owner filters. The authorization predicate also preserves substring matching for historical owner labels; that branch may still require a sequential or bitmap plan until owner identity is normalized.

## Migration behavior

Migration version: `20260716_01`.

- one advisory transaction lock prevents concurrent cold instances from racing;
- `prospect_schema_migrations` records the applied version;
- index creation and `ANALYZE prospect_records` run once per database;
- each warm serverless instance caches successful migration assurance;
- a failed migration clears the in-memory readiness entry so a later request can retry;
- the migration does not change lead records, scoring, authorization or route behavior.

## Rollback SQL

First revert the application commit so a later cold page request cannot recreate the migration, then use this rollback only when an index causes a verified regression. The executable rollback is also stored at `packages/neon-state/migrations/20260716_01_prospect_query_indexes.rollback.sql`. Dropping these indexes does not remove or alter prospect data.

```sql
BEGIN;

DROP INDEX IF EXISTS prospect_records_rank_updated_idx;
DROP INDEX IF EXISTS prospect_records_tender_type_idx;
DROP INDEX IF EXISTS prospect_records_prospect_stage_idx;
DROP INDEX IF EXISTS prospect_records_opportunity_status_idx;
DROP INDEX IF EXISTS prospect_records_lead_type_idx;
DROP INDEX IF EXISTS prospect_records_service_category_idx;
DROP INDEX IF EXISTS prospect_records_source_idx;
DROP INDEX IF EXISTS prospect_records_pipeline_status_idx;
DROP INDEX IF EXISTS prospect_records_owner_lower_idx;

DELETE FROM prospect_schema_migrations
WHERE version = '20260716_01';

COMMIT;
```

## Evidence boundary

This release records query-shape evidence and installs query-aligned indexes, but it does not claim production latency or planner usage without authenticated database samples. Sanitized `EXPLAIN (FORMAT JSON)` evidence and warm/cold response samples remain required before #155 can close.
