import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProspectPageQuery } from '@sales-automation/neon-state';
import { assignUnassignedProspects } from '@sales-automation/prospect-discovery';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { resolveDashboardAccess } from '@sales-automation/web/prospect-handler';

async function main(): Promise<void> {
  process.env.ADMIN_PASSWORD = 'dashboard-smoke-admin-password';
  process.env.WASEEM_DASHBOARD_PASSWORD = 'dashboard-smoke-waseem-password';
  process.env.TALHA_DASHBOARD_PASSWORD = 'dashboard-smoke-talha-password';
  process.env.JAWAD_DASHBOARD_PASSWORD = 'dashboard-smoke-jawad-password';
  process.env.MOIZ_DASHBOARD_PASSWORD = 'dashboard-smoke-moiz-password';
  process.env.SUBAINA_DASHBOARD_PASSWORD = 'dashboard-smoke-subaina-password';
  process.env.DANISH_DASHBOARD_PASSWORD = 'dashboard-smoke-danish-password';
  process.env.HIBA_DASHBOARD_PASSWORD = 'dashboard-smoke-hiba-password';
  process.env.BILAL_DASHBOARD_PASSWORD = 'dashboard-smoke-bilal-password';
  process.env.SESSION_SECRET = 'dashboard-smoke-session-secret-123456789';

  const module = await import('../api/dashboard.ts');
  const handler = module.default as { fetch(request: Request): Promise<Response> };

  const health = await handler.fetch(new Request('https://example.test/api/dashboard?__path=/health'));
  assert.equal(health.status, 200);
  const healthBody = await health.json() as Record<string, unknown>;
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.waseemAccountConfigured, true);
  assert.equal(healthBody.hibaAccountConfigured, true);
  assert.equal(healthBody.bilalAccountConfigured, true);
  assert.equal(healthBody.configuredTeamAccountCount, 8);

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

  assert.equal(normalizeProspectPageQuery({ page: 3, pageSize: 50 }).pageSize, 50);
  assert.equal(normalizeProspectPageQuery({ page: 2, pageSize: 77 }).pageSize, 25);

  const repository = new InMemoryLeadRepository([
    storedLead(buildLead('rfp-lead', 'public_procurement', 'public_opportunity', 'Government RFP for software delivery')),
    storedLead(buildLead('partner-lead', 'public_directory', 'partner_prospect', 'Agency seeks an implementation partner')),
  ]);
  const assignment = assignUnassignedProspects(repository, '2026-07-14T12:00:00.000Z', 'smoke-test');
  assert.equal(assignment.assigned, 2);
  assert.equal(repository.getLead('rfp-lead')?.lead.owner, 'jawad.jutt@codistan.org');
  assert.equal(repository.getLead('partner-lead')?.lead.owner, 'moiz.khalid@codistan.org');
  assert.ok(repository.listLeads().every((record) => Boolean(record.lead.recommendedNextAction)));

  const runtimeSource = readFileSync(new URL('../api/dashboard-runtime.ts', import.meta.url), 'utf8');
  const pageSource = readFileSync(new URL('../apps/web/src/paginated-prospects-page.ts', import.meta.url), 'utf8');
  assert.match(runtimeSource, /\/api\/prospects\/auto-assign/);
  assert.match(pageSource, /id="assign-owners"/);
  assert.match(pageSource, /id="refresh-recent"/);

  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    functions?: Record<string, { maxDuration?: number }>;
    rewrites?: Array<{ source: string; destination: string }>;
  };
  assert.equal(config.functions?.['api/dashboard.ts']?.maxDuration, 300);
  for (const source of ['/login', '/prospects', '/api/login', '/api/prospects', '/api/opportunities/:path*']) {
    const rewrite = config.rewrites?.find((item) => item.source === source);
    assert.ok(rewrite?.destination.startsWith('/api/dashboard?__path='), `${source} must use the scoped dashboard runtime.`);
  }

  console.log('Scoped dashboard access, assignment backfill, pagination and Vercel routing smoke tests passed');
}

function buildLead(id: string, source: Lead['source'], leadType: Lead['leadType'], title: string): Lead {
  return {
    id,
    source,
    sourceUrl: `https://example.com/${id}`,
    leadType,
    prospectStage: leadType === 'partner_prospect' ? 'partner_prospect' : 'warm_lead',
    title,
    description: title,
    companyName: `Example ${id}`,
    companyWebsite: `https://example.com/${id}`,
    contactFormUrl: `https://example.com/${id}/contact`,
    serviceCategory: 'fullstack_web_app',
    opportunityStatus: leadType === 'partner_prospect' ? 'partnership_target' : 'live_opportunity',
    discoverySource: 'Smoke test',
    evidenceUrl: `https://example.com/${id}`,
    evidenceSummary: title,
    discoveredAt: '2026-07-14T10:00:00.000Z',
    capturedAt: '2026-07-14T10:00:00.000Z',
    feedback: { status: 'pending' },
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
  };
}

function storedLead(lead: Lead) {
  return { lead, notes: [], alertDedupeKeysSent: [], auditLog: [] };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
