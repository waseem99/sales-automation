import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROSPECT_QUERY_INDEX_NAMES } from './prospect-query-indexes.ts';

const pageSource = readFileSync(new URL('./prospect-page-v2.ts', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('./prospect-query-indexes.ts', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../../docs/neon-prospect-query-indexes.md', import.meta.url), 'utf8');

assert.equal(new Set(PROSPECT_QUERY_INDEX_NAMES).size, PROSPECT_QUERY_INDEX_NAMES.length);
assert.equal(PROSPECT_QUERY_INDEX_NAMES.length, 12);
assert.match(pageSource, /WITH visible AS MATERIALIZED/);
assert.match(pageSource, /filtered AS MATERIALIZED/);
assert.match(pageSource, /JSONB_AGG\(owner ORDER BY owner\)/);
assert.match(pageSource, /filtered_total/);
assert.match(pageSource, /dataQueryCount: 2/);
assert.match(pageSource, /queryCount: schema\.queryCount \+ indexes\.queryCount \+ 2/);
assert.match(pageSource, /ensureProspectQueryIndexesWithMetrics/);
assert.match(pageSource, /follow_up_at\(record\)/);
assert.match(pageSource, /actionable_follow_up\(record\)/);
assert.match(pageSource, /LOWER\(record::text\)/);
assert.match(indexSource, /pg_advisory_xact_lock/);
assert.match(indexSource, /CREATE INDEX IF NOT EXISTS prospect_records_owner_lower_idx/);
assert.match(indexSource, /CREATE INDEX IF NOT EXISTS prospect_records_rank_updated_order_idx/);
assert.match(indexSource, /CREATE INDEX IF NOT EXISTS prospect_records_closeability_band_idx/);
assert.doesNotMatch(indexSource, /follow_up_at\(record\).*INDEX/i);
assert.doesNotMatch(indexSource, /record::text.*INDEX/i);
for (const name of PROSPECT_QUERY_INDEX_NAMES) {
  assert.match(indexSource, new RegExp(`CREATE INDEX IF NOT EXISTS ${name}`));
  assert.match(rollback, new RegExp(`DROP INDEX IF EXISTS ${name}`));
}
assert.match(rollback, /Follow-up timestamp index deferred/);
assert.match(rollback, /Free-text search index deferred/);
assert.match(rollback, /Rollback/);

console.log('Consolidated prospect aggregates, two-statement warm page contract and reversible index catalog passed');
