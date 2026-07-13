import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedStarterProspects } from '@sales-automation/fixtures';

interface VercelConfig {
  redirects?: Array<{ source: string; destination: string; permanent?: boolean }>;
  rewrites?: Array<{ source: string; destination: string }>;
}

async function main(): Promise<void> {
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vercel-smoke-password';
  process.env.TALHA_DASHBOARD_PASSWORD = process.env.TALHA_DASHBOARD_PASSWORD || 'talha-smoke-password';
  process.env.JAWAD_DASHBOARD_PASSWORD = process.env.JAWAD_DASHBOARD_PASSWORD || 'jawad-smoke-password';
  process.env.MOIZ_DASHBOARD_PASSWORD = process.env.MOIZ_DASHBOARD_PASSWORD || 'moiz-smoke-password';
  process.env.SUBAINA_DASHBOARD_PASSWORD = process.env.SUBAINA_DASHBOARD_PASSWORD || 'subaina-smoke-password';
  process.env.DANISH_DASHBOARD_PASSWORD = process.env.DANISH_DASHBOARD_PASSWORD || 'danish-smoke-password';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'vercel-smoke-session-secret-123456789';

  assert.equal(verifiedStarterProspects.length, 75);
  assert.equal(new Set(verifiedStarterProspects.map((lead) => lead.id)).size, 75);
  assert.deepEqual(verifiedStarterProspects.map((lead) => lead.rank), Array.from({ length: 75 }, (_value, index) => index + 1));
  assert.equal(verifiedStarterProspects.filter((lead) => lead.opportunityStatus === 'live_opportunity').length, 3);
  assert.ok(verifiedStarterProspects.every((lead) => Boolean(
    lead.companyName
    && lead.evidenceUrl
    && lead.contactRole
    && lead.serviceOffer
    && lead.materialsToShare
    && lead.reachMethod
    && lead.draftMessage
    && lead.recommendedNextAction
  )));

  const newBatch = verifiedStarterProspects.filter((lead) => (lead.rank ?? 0) >= 26);
  assert.equal(newBatch.length, 50);
  assert.equal(newBatch.filter((lead) => lead.confidence === 'high').length, 30);
  assert.equal(newBatch.filter((lead) => lead.opportunityStatus === 'recent_demand_signal').length, 12);
  assert.ok(newBatch.every((lead) => Boolean(lead.companyWebsite && lead.contactFormUrl)));
  assert.ok(newBatch.every((lead) => lead.discoverySource === 'Qualified prospect research — 2026-07-13'));
  assert.ok(newBatch.every((lead) => lead.feedback?.status === 'pending'));

  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  ) as VercelConfig;
  const rewriteSources = (config.rewrites ?? []).map((rewrite) => rewrite.source);
  const rootRedirect = (config.redirects ?? []).find((redirect) => redirect.source === '/');

  assert.equal(rootRedirect?.destination, '/prospects');
  assert.ok(rewriteSources.includes('/prospects'));
  assert.ok(rewriteSources.includes('/api/login'));
  assert.ok(rewriteSources.includes('/api/prospects/:path*'));
  assert.ok(!rewriteSources.includes('/:path*'), 'Vercel internal routes must not be captured by a global rewrite.');
  assert.ok(!rewriteSources.includes('/api/preview'), 'Vercel preview routes must remain owned by Vercel.');

  const module = await import('../api/index.ts');
  const handler = module.default as { fetch(request: Request): Promise<Response> };

  const health = await handler.fetch(new Request('https://example.test/api/index?__path=/health'));
  assert.equal(health.status, 200);
  const healthBody = await health.json() as Record<string, unknown>;
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.service, 'codistan-prospect-desk');
  assert.equal(healthBody.talhaAccountConfigured, true);
  assert.equal(healthBody.jawadAccountConfigured, true);
  assert.equal(healthBody.moizAccountConfigured, true);
  assert.equal(healthBody.subainaAccountConfigured, true);
  assert.equal(healthBody.danishAccountConfigured, true);
  assert.equal(healthBody.configuredTeamAccountCount, 5);

  const login = await handler.fetch(new Request('https://example.test/api/index?__path=/login'));
  assert.equal(login.status, 200);
  const loginHtml = await login.text();
  assert.match(loginHtml, /Codistan Prospect Desk/i);
  assert.match(loginHtml, /Email or admin username/i);
  assert.match(loginHtml, /All configured accounts currently have the same administrator access/i);

  await assertSuccessfulLogin(handler, 'admin', process.env.ADMIN_PASSWORD, 'Administrator');
  await assertSuccessfulLogin(handler, 'talha.bashir@codistan.org', process.env.TALHA_DASHBOARD_PASSWORD, 'Talha Bashir');
  await assertSuccessfulLogin(handler, 'jawad.jutt@codistan.org', process.env.JAWAD_DASHBOARD_PASSWORD, 'Jawad Jutt');
  await assertSuccessfulLogin(handler, 'moiz.khalid@codistan.org', process.env.MOIZ_DASHBOARD_PASSWORD, 'Moiz Khalid');
  await assertSuccessfulLogin(handler, 'subainaaamir@codistan.org', process.env.SUBAINA_DASHBOARD_PASSWORD, 'Subaina Aamir');
  await assertSuccessfulLogin(handler, 'danishkhalid@codistan.org', process.env.DANISH_DASHBOARD_PASSWORD, 'Danish Khalid');

  const invalidLogin = await handler.fetch(new Request('https://example.test/api/index?__path=/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'talha.bashir@codistan.org', password: 'wrong-password' }),
  }));
  assert.equal(invalidLogin.status, 401);
  assert.deepEqual(await invalidLogin.json(), { error: 'Incorrect email or password.' });

  console.log('Vercel runtime, routing, 75-prospect and five-team-admin smoke tests passed');
}

async function assertSuccessfulLogin(
  handler: { fetch(request: Request): Promise<Response> },
  identifier: string,
  password: string | undefined,
  displayName: string,
): Promise<void> {
  const response = await handler.fetch(new Request('https://example.test/api/index?__path=/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  }));
  assert.equal(response.status, 200);
  const cookies = response.headers.get('set-cookie') ?? '';
  assert.match(cookies, /codistan_admin_session=/);
  assert.match(cookies, /codistan_admin_actor=/);
  assert.deepEqual(await response.json(), {
    ok: true,
    identifier,
    displayName,
    access: 'admin',
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
