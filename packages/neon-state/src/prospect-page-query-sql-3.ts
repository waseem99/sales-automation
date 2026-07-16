export const PROSPECT_PAGE_QUERY_SQL_3 = String.raw`    aggregate AS (
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = 'live_opportunity')::int AS live,
        COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'pipelineStatus', '') IN ('sent_manually','replied','meeting_booked','proposal_sent','won','lost'))::int AS contacted,
        COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'pipelineStatus', '') IN ('replied','meeting_booked','proposal_sent','won','lost'))::int AS replied,
        COUNT(*) FILTER (WHERE follow_up_at(record) <= NOW() AND actionable_follow_up(record))::int AS follow_ups_due,
        COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'owner', '') = '')::int AS unassigned,
        COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = 'won')::int AS won,
        COUNT(*) FILTER (WHERE COALESCE(record->'lead'->'feedback'->>'status', 'pending') <> 'complete')::int AS feedback_pending
      FROM visible
    ),
    filtered_count AS (
      SELECT COUNT(*)::int AS filtered_total
      FROM filtered
    ),
    page_meta AS (
      SELECT
        GREATEST(1, CEIL(filtered_total::numeric / {{pageSize}}::int)::int) AS total_pages,
        LEAST(
          {{requestedPage}}::int,
          GREATEST(1, CEIL(filtered_total::numeric / {{pageSize}}::int)::int)
        )::int AS page
      FROM filtered_count
    ),
`;
