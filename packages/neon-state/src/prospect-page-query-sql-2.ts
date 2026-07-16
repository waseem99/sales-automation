export const PROSPECT_PAGE_QUERY_SQL_2 = String.raw`    filtered AS NOT MATERIALIZED (
      SELECT
        record,
        follow_up_at(record) AS follow_sort,
        CASE
          WHEN COALESCE(record->'lead'->>'rank', '') ~ '^[0-9]+$'
            THEN (record->'lead'->>'rank')::int
          ELSE 999999
        END AS rank_sort,
        COALESCE(record->'lead'->>'updatedAt', record->'lead'->>'createdAt', '') AS updated_sort
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
        AND ({{filterSearch}} = '' OR LOWER(record::text) LIKE '%' || LOWER({{filterSearch}}) || '%')
        AND ({{filterStatus}} = '' OR COALESCE(record->'lead'->>'pipelineStatus', '') = {{filterStatus}})
        AND ({{filterSignal}} = '' OR COALESCE(record->'lead'->>'opportunityStatus', '') = {{filterSignal}})
        AND ({{filterService}} = '' OR COALESCE(record->'lead'->>'serviceCategory', '') = {{filterService}})
        AND ({{filterOwner}} = '' OR ({{filterOwner}} = 'unassigned' AND COALESCE(record->'lead'->>'owner', '') = '') OR LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER({{filterOwner}}))
        AND ({{filterFeedback}} = '' OR COALESCE(record->'lead'->'feedback'->>'status', 'pending') = {{filterFeedback}})
        AND (
          {{filterFollowUp}} = ''
          OR ({{filterFollowUp}} = 'due' AND follow_up_at(record) <= NOW() AND actionable_follow_up(record))
          OR ({{filterFollowUp}} = 'overdue' AND follow_up_at(record) < DATE_TRUNC('day', NOW()) AND actionable_follow_up(record))
          OR ({{filterFollowUp}} = 'today' AND follow_up_at(record) >= DATE_TRUNC('day', NOW()) AND follow_up_at(record) < DATE_TRUNC('day', NOW()) + INTERVAL '1 day' AND actionable_follow_up(record))
          OR ({{filterFollowUp}} = 'next_7_days' AND follow_up_at(record) > NOW() AND follow_up_at(record) <= NOW() + INTERVAL '7 days' AND actionable_follow_up(record))
          OR ({{filterFollowUp}} = 'scheduled' AND follow_up_at(record) IS NOT NULL AND actionable_follow_up(record))
          OR ({{filterFollowUp}} = 'not_scheduled' AND follow_up_at(record) IS NULL AND actionable_follow_up(record))
        )
    ),
`;
