import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../packages/neon-state/src/index.ts', import.meta.url), 'utf8');
const legacyQuerySource = readFileSync(new URL('../packages/neon-state/src/prospect-query.ts', import.meta.url), 'utf8');
const pageQuerySource = readFileSync(new URL('../packages/neon-state/src/prospect-page-query.ts', import.meta.url), 'utf8');
const pageModelSource = readFileSync(new URL('../packages/neon-state/src/prospect-page-query-model.ts', import.meta.url), 'utf8');
const pageSql = [1, 2, 3, 4]
  .map((part) => readFileSync(new URL(`../packages/neon-state/src/prospect-page-query-sql-${part}.ts`, import.meta.url), 'utf8'))
  .join('');
const indexesSource = readFileSync(new URL('../packages/neon-state/src/prospect-query-indexes.ts', import.meta.url), 'utf8');
const audit = readFileSync(new URL('../docs/prospect-query-index-audit.md', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../packages/neon-state/migrations/20260716_01_prospect_query_indexes.rollback.sql', import.meta.url), 'utf8');

assert.match(indexSource, /export \* from '\.\/prospect-query\.js';/);
assert.match(indexSource, /export \{\s*loadNeonProspectPage,\s*loadNeonProspectPageWithMetrics,\s*\} from '\.\/prospect-page-query\.js';/s);
assert.doesNotMatch(indexSource, /prospect-query-legacy/);
assert.match(legacyQuerySource, /loadNeonProspectPageWithMetrics/);
assert.match(legacyQuerySource, /queryCount: schema\.queryCount \+ 4/);
assert.match(pageQuerySource, /from '\.\/prospect-query\.js'/);
assert.doesNotMatch(pageQuerySource, /prospect-query-legacy/);
assert.match(pageModelSource, /from '\.\/prospect-query\.js'/);
assert.match(pageQuerySource, /ensureProspectQueryIndexesWithMetrics/);
assert.match(pageQuerySource, /sql\.query\(boundQuery\.text, boundQuery\.params\)/);
assert.match(pageQuerySource, /queryCount: schemaQueryCount \+ 1/);
assert.match(pageQuerySource, /dataQueryCount: 1/);
assert.doesNotMatch(pageQuerySource, /sql\.transaction\(/);

assert.match(pageSql, /WITH visible AS MATERIALIZED/);
assert.match(pageSql, /filtered AS NOT MATERIALIZED/);
assert.match(pageSql, /jsonb_agg\(owner ORDER BY owner\)/);
assert.match(pageSql, /jsonb_agg\([\s\S]*record[\s\S]*ORDER BY/);
assert.match(pageSql, /\{\{pageSize\}\}::int/);
assert.match(pageSql, /\{\{requestedPage\}\}::int/);

const indexNames = [...indexesSource.matchAll(/CREATE INDEX IF NOT EXISTS ([a-z0-9_]+)/g)].map((match) => match[1]);
assert.equal(indexNames.length, 9);
assert.equal(new Set(indexNames).size, indexNames.length);
assert.match(indexesSource, /PROSPECT_QUERY_INDEX_MIGRATION_VERSION = '20260716_01'/);
assert.match(indexesSource, /pg_advisory_xact_lock/);
assert.match(indexesSource, /prospect_schema_migrations/);
assert.match(indexesSource, /ANALYZE prospect_records/);
for (const indexName of indexNames) {
  assert.match(rollback, new RegExp(`DROP INDEX IF EXISTS ${indexName}`));
}

assert.match(audit, /warm list request: \*\*1 data statement\*\*/);
assert.match(audit, /warm request with `leadId`: \*\*2 data statements\*\*/);
assert.match(audit, /follow-up timestamp \| defer/);
assert.match(audit, /closeability band \| defer/);
assert.match(audit, /does not claim production latency or planner usage/);

console.log('Prospect aggregate consolidation, explicit export override and reversible query-index migration contract passed');
