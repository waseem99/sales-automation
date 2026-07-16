import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { summarizeProspectPlan } from '../packages/neon-state/src/prospect-performance-evidence.ts';

const evidenceSource = readFileSync(new URL('../packages/neon-state/src/prospect-performance-evidence.ts', import.meta.url), 'utf8');
const planSource = readFileSync(new URL('../packages/neon-state/src/prospect-performance-plan.ts', import.meta.url), 'utf8');
const equivalenceSource = readFileSync(new URL('../packages/neon-state/src/prospect-performance-equivalence.ts', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/prospect-performance-evidence.ts', import.meta.url), 'utf8');
const neonPackage = JSON.parse(readFileSync(new URL('../packages/neon-state/package.json', import.meta.url), 'utf8')) as { exports?: Record<string, unknown> };
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as { functions?: Record<string, { maxDuration?: number }> };
const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts?: Record<string, string> };

assert.ok(neonPackage.exports?.['./prospect-performance-evidence']);
assert.equal(vercel.functions?.['api/prospect-performance-evidence.ts']?.maxDuration, 300);
assert.match(rootPackage.scripts?.['test:vercel-runtime'] ?? '', /prospect-performance-evidence-smoke\.ts/);
assert.match(evidenceSource, /PROSPECT_QUERY_INDEX_MIGRATION_VERSION/);
assert.match(evidenceSource, /PROSPECT_QUERY_INDEX_NAMES/);
assert.match(planSource, /EXPLAIN \(FORMAT JSON, ANALYZE FALSE/);
assert.doesNotMatch(planSource, /ANALYZE TRUE/);
assert.match(evidenceSource, /leadRowsReturned: false/);
assert.match(evidenceSource, /sensitiveDataIncluded: false/);
assert.match(evidenceSource, /compareDefaultProspectPage/);
assert.match(equivalenceSource, /firstPageOrderMatches/);
assert.match(evidenceSource, /comparisonRecordLimit: 10_000/);
assert.match(apiSource, /ALLOWED_ACTORS = new Set\(\['admin', 'waseem@codistan\.org'\]\)/);
assert.match(apiSource, /if \(!actor\) return json\(\{ error: 'Authentication required\.' \}, 401\)/);
assert.match(apiSource, /Authentication required/);
assert.match(apiSource, /performance evidence is restricted to Admin and Waseem/);
assert.doesNotMatch(apiSource, /contactEmail|companyName|sourceUrl|evidenceUrl/);

const summary = summarizeProspectPlan('owner', [{
  Plan: {
    'Node Type': 'Index Scan',
    'Index Name': 'prospect_records_owner_lower_idx',
    'Relation Name': 'prospect_records',
    'Plan Rows': 12,
    'Total Cost': 4.2,
    'Index Cond': "owner = 'private@example.com'",
  },
}], ['prospect_records_owner_lower_idx']);
assert.deepEqual(summary.indexNames, ['prospect_records_owner_lower_idx']);
assert.deepEqual(summary.nodeTypes, ['Index Scan']);
assert.equal(summary.usesExpectedIndex, true);
assert.equal(JSON.stringify(summary).includes('private@example.com'), false);

process.env.SESSION_SECRET = 'performance-evidence-smoke-secret-12345';
delete process.env.DATABASE_URL;
const api = (await import('../api/prospect-performance-evidence.ts')).default as { fetch(request: Request): Promise<Response> };
const unauthorized = await api.fetch(new Request('https://example.test/api/prospect-performance-evidence'));
assert.equal(unauthorized.status, 401);

const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
const sessionToken = `${expiresAt}.${createHmac('sha256', process.env.SESSION_SECRET).update(`admin:${expiresAt}`).digest('base64url')}`;
const actor = 'talha.bashir@codistan.org';
const actorEncoded = Buffer.from(actor, 'utf8').toString('base64url');
const actorToken = `${actorEncoded}.${createHmac('sha256', process.env.SESSION_SECRET).update(`actor:${actorEncoded}`).digest('base64url')}`;
const forbidden = await api.fetch(new Request('https://example.test/api/prospect-performance-evidence', {
  headers: { cookie: `codistan_admin_session=${sessionToken}; codistan_admin_actor=${actorToken}` },
}));
assert.equal(forbidden.status, 403);

console.log('Admin-only sanitized Prospect Desk performance evidence contract passed');
