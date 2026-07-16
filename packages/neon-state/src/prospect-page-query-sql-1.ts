export const PROSPECT_PAGE_QUERY_SQL_1 = String.raw`
    WITH visible AS MATERIALIZED (
      SELECT record
      FROM prospect_records
      WHERE ({{canViewAll}}::boolean OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text({{ownerTokensJson}}::jsonb) AS visible_token(value)
        WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
           OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
      ))
        AND (
          {{workspaceAll}}::boolean
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text({{workspaceSourcesJson}}::jsonb) item WHERE COALESCE(record->'lead'->>'source', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text({{workspaceLeadTypesJson}}::jsonb) item WHERE COALESCE(record->'lead'->>'leadType', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text({{workspaceTenderTypesJson}}::jsonb) item WHERE COALESCE(record->'lead'->'tender'->>'opportunityType', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text({{workspaceProspectStagesJson}}::jsonb) item WHERE COALESCE(record->'lead'->>'prospectStage', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text({{workspaceOpportunityStatusesJson}}::jsonb) item WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text({{workspaceServiceCategoriesJson}}::jsonb) item WHERE COALESCE(record->'lead'->>'serviceCategory', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text({{workspacePipelineStatusesJson}}::jsonb) item WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = item.value)
          OR ({{workspaceHasTender}}::boolean AND COALESCE(jsonb_typeof(record->'lead'->'tender') = 'object', false))
          OR ({{workspaceRequireKnownService}}::boolean AND COALESCE(record->'lead'->>'serviceCategory', '') <> 'unknown')
        )
    ),
`;
