# Neon Prospect Query Indexes

This release adds a deliberately limited expression-index catalog for immutable JSON paths used by the Prospect Desk list, workspace, filter, ordering and priority contracts.

## Added indexes

```sql
CREATE INDEX IF NOT EXISTS prospect_records_owner_lower_idx
  ON prospect_records ((LOWER(COALESCE(record->'lead'->>'owner', ''))));

CREATE INDEX IF NOT EXISTS prospect_records_pipeline_status_idx
  ON prospect_records ((COALESCE(record->'lead'->>'pipelineStatus', '')));

CREATE INDEX IF NOT EXISTS prospect_records_opportunity_status_idx
  ON prospect_records ((COALESCE(record->'lead'->>'opportunityStatus', '')));

CREATE INDEX IF NOT EXISTS prospect_records_source_idx
  ON prospect_records ((COALESCE(record->'lead'->>'source', '')));

CREATE INDEX IF NOT EXISTS prospect_records_lead_type_idx
  ON prospect_records ((COALESCE(record->'lead'->>'leadType', '')));

CREATE INDEX IF NOT EXISTS prospect_records_service_category_idx
  ON prospect_records ((COALESCE(record->'lead'->>'serviceCategory', '')));

CREATE INDEX IF NOT EXISTS prospect_records_prospect_stage_idx
  ON prospect_records ((COALESCE(record->'lead'->>'prospectStage', '')));

CREATE INDEX IF NOT EXISTS prospect_records_feedback_status_idx
  ON prospect_records ((COALESCE(record->'lead'->'feedback'->>'status', 'pending')));

CREATE INDEX IF NOT EXISTS prospect_records_tender_type_idx
  ON prospect_records ((COALESCE(record->'lead'->'tender'->>'opportunityType', '')));

CREATE INDEX IF NOT EXISTS prospect_records_updated_order_idx
  ON prospect_records ((COALESCE(record->'lead'->>'updatedAt', record->'lead'->>'createdAt', '')) DESC);

CREATE INDEX IF NOT EXISTS prospect_records_rank_updated_order_idx
  ON prospect_records (
    (CASE
      WHEN COALESCE(record->'lead'->>'rank', '') ~ '^[0-9]+$'
        THEN (record->'lead'->>'rank')::int
      ELSE 999999
    END),
    (COALESCE(record->'lead'->>'updatedAt', record->'lead'->>'createdAt', '')) DESC
  );

CREATE INDEX IF NOT EXISTS prospect_records_closeability_band_idx
  ON prospect_records ((COALESCE(record->'latestEvaluation'->'closeability'->>'band', '')));
```

The runtime executes the catalog through one advisory-lock-protected `DO` statement. `CREATE INDEX IF NOT EXISTS` keeps repeat execution safe, while the advisory transaction lock prevents two cold serverless instances from racing the same catalog.

## Deliberately deferred indexes

### Follow-up timestamp index deferred

Current follow-up filtering uses `follow_up_at(record)`, which returns `TIMESTAMPTZ` through a `STABLE` SQL function. PostgreSQL expression indexes require immutable expressions. Marking the function immutable or replacing timestamp semantics with lexical text comparison would be an unsafe behavior change. A future migration should add a typed `next_follow_up_at` column maintained during writes, backfill it, compare query plans, and only then move filters to that column.

### Free-text search index deferred

Current search uses `LOWER(record::text) LIKE '%term%'`. A useful index would require `pg_trgm` plus a GIN expression index. That extension and its write/storage cost should be introduced only after measured production search volume and query-plan evidence justify it.

### Owner substring visibility

The owner expression index supports exact owner filtering. Existing authorization also permits substring token matching for backward compatibility; a leading-wildcard predicate cannot use the btree expression index. Authorization semantics were intentionally preserved.

## Rollback

Run the following statements if the catalog must be removed. Dropping these indexes does not change data or application semantics; queries revert to planner-selected scans.

```sql
DROP INDEX IF EXISTS prospect_records_closeability_band_idx;
DROP INDEX IF EXISTS prospect_records_rank_updated_order_idx;
DROP INDEX IF EXISTS prospect_records_updated_order_idx;
DROP INDEX IF EXISTS prospect_records_tender_type_idx;
DROP INDEX IF EXISTS prospect_records_feedback_status_idx;
DROP INDEX IF EXISTS prospect_records_prospect_stage_idx;
DROP INDEX IF EXISTS prospect_records_service_category_idx;
DROP INDEX IF EXISTS prospect_records_lead_type_idx;
DROP INDEX IF EXISTS prospect_records_source_idx;
DROP INDEX IF EXISTS prospect_records_opportunity_status_idx;
DROP INDEX IF EXISTS prospect_records_pipeline_status_idx;
DROP INDEX IF EXISTS prospect_records_owner_lower_idx;
```

After rollback, remove the index-assurance call from the consolidated page loader in the same application release so cold instances do not recreate the catalog.

## Production verification

The production build validates the index names, creation statements, rollback statements, aggregate CTE contract and two-data-statement warm page contract. Authenticated `EXPLAIN (ANALYZE, BUFFERS)` evidence remains a separate secure operational check because production database credentials and representative owner-scoped parameters are not exposed to CI.
