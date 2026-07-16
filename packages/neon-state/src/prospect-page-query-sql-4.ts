export const PROSPECT_PAGE_QUERY_SQL_4 = String.raw`    owner_values AS (
      SELECT DISTINCT NULLIF(record->'lead'->>'owner', '') AS owner
      FROM visible
      WHERE NULLIF(record->'lead'->>'owner', '') IS NOT NULL
    ),
    owners AS (
      SELECT COALESCE(jsonb_agg(owner ORDER BY owner), '[]'::jsonb) AS owners
      FROM owner_values
    ),
    page_records AS (
      SELECT record, follow_sort, rank_sort, updated_sort
      FROM filtered
      ORDER BY
        CASE WHEN {{filterFollowUp}} IN ('due','overdue','today','next_7_days','scheduled') THEN follow_sort END ASC NULLS LAST,
        rank_sort ASC,
        updated_sort DESC
      LIMIT {{pageSize}}::int
      OFFSET (
        SELECT (page - 1) * {{pageSize}}::int
        FROM page_meta
      )
    )
    SELECT
      aggregate.total,
      aggregate.live,
      aggregate.contacted,
      aggregate.replied,
      aggregate.follow_ups_due,
      aggregate.unassigned,
      aggregate.won,
      aggregate.feedback_pending,
      filtered_count.filtered_total,
      page_meta.total_pages,
      page_meta.page,
      owners.owners,
      COALESCE((
        SELECT jsonb_agg(
          record
          ORDER BY
            CASE WHEN {{filterFollowUp}} IN ('due','overdue','today','next_7_days','scheduled') THEN follow_sort END ASC NULLS LAST,
            rank_sort ASC,
            updated_sort DESC
        )
        FROM page_records
      ), '[]'::jsonb) AS records
    FROM aggregate
    CROSS JOIN filtered_count
    CROSS JOIN page_meta
    CROSS JOIN owners
`;
