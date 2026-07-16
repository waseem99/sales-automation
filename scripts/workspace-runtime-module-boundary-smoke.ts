import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './workspace-runtime-module-boundary-legacy-smoke.ts';
import { PROSPECT_QUERY_INDEX_NAMES } from '../packages/neon-state/src/prospect-query-indexes.ts';

const facade = readFileSync(new URL('../packages/neon-state/src/prospect-query.ts', import.meta.url), 'utf8');
const pageQuery = readFileSync(new URL('../packages/neon-state/src/prospect-page-query.ts', import.meta.url), 'utf8');
const pageSql = [1, 2, 3, 4].map((part) => readFileSync(new URL(`../packages/neon-state/src/prospect-page-query-sql-${part}.ts`, import.meta.url), 'utf8')).join('');
const indexes = readFileSync(new URL('../packages/neon-state/src/prospect-query-indexes.ts', import.meta.url), 'utf8');
const audit = readFileSync(new URL('../docs/prospect-query-index-audit.md', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../packages/neon-state/migrations/20260716_01_prospect_query_indexes.rollback.sql', import.meta.url), 'utf8');

assert.match(facade, /from '\.\/prospect-query-legacy\.js'/);
assert.match(facade, /from '\.\/prospect-page-query\.js'/);
assert.match(pageQuery, /ensureProspectQueryIndexesWithMetrics/);
assert.match(pageQuery, /sql\.query\(boundQuery\.text, boundQuery\.params\)/);
assert.match(pageSql, /WITH visible AS MATERIALIZED/);
assert.match(pageSql, /filtered AS NOT MATERIALIZED/);
assert.match(pageSql, /jsonb_agg\(owner ORDER BY owner\)/);
assert.match(pageSql, /jsonb_agg\([\s\S]*record[\s\S]*ORDER BY/);
assert.match(pageSql, /\{\{pageSize\}\}::int/);
assert.match(pageSql, /\{\{requestedPage\}\}::int/);
assert.equal(pageQuery.includes('sql.transaction(['), false);
assert.match(pageQuery, /queryCount: schemaQueryCount \+ 1/);
assert.match(pageQuery, /dataQueryCount: 1/);
assert.match(indexes, /PROSPECT_QUERY_INDEX_MIGRATION_VERSION = '20260716_01'/);
assert.match(indexes, /pg_advisory_xact_lock/);
assert.match(indexes, /prospect_schema_migrations/);
assert.match(indexes, /ANALYZE prospect_records/);
assert.equal(PROSPECT_QUERY_INDEX_NAMES.length, 9);
assert.equal(new Set(PROSPECT_QUERY_INDEX_NAMES).size, PROSPECT_QUERY_INDEX_NAMES.length);
for (const indexName of PROSPECT_QUERY_INDEX_NAMES) {
  assert.match(indexes, new RegExp(`CREATE INDEX IF NOT EXISTS ${indexName}`));
  assert.match(rollback, new RegExp(`DROP INDEX IF EXISTS ${indexName}`));
}
assert.match(audit, /warm list request: \*\*1 data statement\*\*/);
assert.match(audit, /warm request with `leadId`: \*\*2 data statements\*\*/);
assert.match(audit, /follow-up timestamp \| defer/);
assert.match(audit, /closeability band \| defer/);
assert.match(audit, /does not claim production latency or planner usage/);

console.log('Prospect aggregate consolidation and reversible query-index migration contract passed');
