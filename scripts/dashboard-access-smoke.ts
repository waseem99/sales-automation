import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProspectPageQuery } from '@sales-automation/neon-state';
import { resolveDashboardAccess } from '@sales-automation/web/prospect-handler';

process.env.ADMIN_PASSWORD = 'dashboard-smoke-admin-password';
process.env.WASEEM_DASHBOARD_PASSWORD = 'dashboard-smoke-waseem-password';
process.env.TALHA_DASHBOARD_PASSWORD = 'dashboard-smoke-talha-password';
process.env.JAWAD_DASHBOARD_PASSWORD = 'dashboard-smoke-jawad-password';
process.env.MOIZ_DASHBOARD_PASSWORD = 'dashboard-smoke-moiz-password';
process.env.SUBAINA_DASHBOARD_PASSWORD = 'dashboard-smoke-subaina-password';
process.env.DANISH_DASHBOARD_PASSWORD = 'dashboard-smoke-danish-password';
process.env.SESSION_SECRET = 'dashboard-smoke-session-secret-123456789';

const module = await import('../api/dashboard.ts');
const handler = module.default as { fetch(request: Request): Promise<Response> };

const health = await handler.fetch(new Request('https://example.test/api/dashboard?__path=/health'));
assert.equal(health.status, 200);
const healthBody = await health.json() as Record<string, unknown>;
assert.equal(healthBody.ok, true);
assert.equal(healthBody.waseemAccountConfigured, true);
assert.equal(healthBody.configuredTeamAccountCount, 6);

const waseemLogin = await handler.fetch(new Request('https://example.test/api/dashboard?__path=/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'waseem@codistan.org', password: process.env.WASEEM_DASHBOARD_PASSWORD }),
}));
assert.equal(waseemLogin.status, 200);
assert.match(waseemLogin.headers.get('set-cookie') ?? '', /codistan_admin_session=/);
assert.deepEqual(await waseemLogin.json(), {
  ok: true,
  identifier: 'waseem@codistan.org',
  displayName: 'Waseem Khan',
  access: { role: 'admin', scope: 'all', scopeLabel: 'All company leads' },
});

const talhaAccess = resolveDashboardAccess('talha.bashir@codistan.org');
assert.equal(talhaAccess.scopeKind, 'team');
assert.ok(talhaAccess.visibleOwnerTokens.includes('danish'));
assert.ok(talhaAccess.visibleOwnerTokens.includes('hiba'));
assert.equal(talhaAccess.canRunGlobalOperations, false);

const ownAccess = resolveDashboardAccess('jawad.jutt@codistan.org');
assert.equal(ownAccess.scopeKind, 'own');
assert.equal(ownAccess.canAssignOwners, false);

assert.deepEqual(normalizeProspectPageQuery({ page: 3, pageSize: 50 }).pageSize, 50);
assert.deepEqual(normalizeProspectPageQuery({ page: 2, pageSize: 77 }).pageSize, 25);

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions?: Record<string, { maxDuration?: number }>;
  rewrites?: Array<{ source: string; destination: string }>;
};
assert.equal(config.functions?.['api/dashboard.ts']?.maxDuration, 300);
for (const source of ['/login', '/prospects', '/api/login', '/api/prospects', '/api/opportunities/:path*']) {
  const rewrite = config.rewrites?.find((item) => item.source === source);
  assert.ok(rewrite?.destination.startsWith('/api/dashboard?__path='), `${source} must use the scoped dashboard runtime.`);
}

console.log('Scoped dashboard access, pagination and Vercel routing smoke tests passed');
