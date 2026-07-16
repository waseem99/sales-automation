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
