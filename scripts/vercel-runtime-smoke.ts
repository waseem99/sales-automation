import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedStarterProspects } from '@sales-automation/fixtures';

interface VercelConfig {
  redirects?: Array<{ source: string; destination: string; permanent?: boolean }>;
  rewrites?: Array<{ source: string; destination: string }>;
  crons?: Array<{ path: string; schedule: string }>;
  functions?: Record<string, { maxDuration?: number }>;
}

interface OutreachPolicy {
  version: number;
  businessAddress: string;
  teamMembers: string[];
  senderStrategy: {
    primarySenders: string[];
    secondarySendersAfterWarmup: string[];
  };
  portfolioLibrary: {
    environmentVariable: string;
  };
  replyRouting: {
    fixedAlertEmails: string[];
    fixedAlertEnvironmentVariable: string;
    additionalOwnerEnvironmentVariable: string;
    activeSenderEnvironmentVariable: string;
  };
  targeting: {
    preferredCountries: string[];
    excludedCompanyHeadquartersOrPrimaryOperations: string[];
    excludedIndustries: string[];
  };
  companyQualification: {
    doNotRejectOnHeadcountAlone: boolean;
    standardAutomaticQualification: { minimumEmployees: number };
    microCompanyQualification: { minimumStrongCommercialSignals: number };
  };
  sending: {
    steadyStateDailyNewMessagesAcrossDomain: { minimum: number; maximum: number };
  };
  followUpSequence: Array<{ day: number; purpose: string }>;
}

async function main(): Promise<void> {
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vercel-smoke-password';
  process.env.TALHA_DASHBOARD_PASSWORD = process.env.TALHA_DASHBOARD_PASSWORD || 'talha-smoke-password';
  process.env.JAWAD_DASHBOARD_PASSWORD = process.env.JAWAD_DASHBOARD_PASSWORD || 'jawad-smoke-password';
  process.env.MOIZ_DASHBOARD_PASSWORD = process.env.MOIZ_DASHBOARD_PASSWORD || 'moiz-smoke-password';
  process.env.SUBAINA_DASHBOARD_PASSWORD = process.env.SUBAINA_DASHBOARD_PASSWORD || 'subaina-smoke-password';
  process.env.DANISH_DASHBOARD_PASSWORD = process.env.DANISH_DASHBOARD_PASSWORD || 'danish-smoke-password';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'vercel-smoke-session-secret-123456789';
  process.env.PORTFOLIO_LIBRARY_URL = process.env.PORTFOLIO_LIBRARY_URL || 'https://drive.google.com/drive/folders/smoke-test';
  process.env.OUTREACH_ALERT_EMAILS = process.env.OUTREACH_ALERT_EMAILS || 'waseem@codistan.org,sales@codistan.org';

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

  const outreachPolicy = JSON.parse(
    readFileSync(new URL('../config/outreach-policy.json', import.meta.url), 'utf8'),
  ) as OutreachPolicy;
  assert.equal(outreachPolicy.version, 2);
  assert.equal(outreachPolicy.businessAddress, 'Codistan Ventures Building, Plot No. 15, I-11/3, Islamabad 44000, Pakistan');
  assert.deepEqual(outreachPolicy.senderStrategy.primarySenders, [
    'talha.bashir@codistan.org',
    'jawad.jutt@codistan.org',
  ]);
  assert.equal(outreachPolicy.senderStrategy.secondarySendersAfterWarmup.length, 3);
  assert.equal(outreachPolicy.teamMembers.length, 5);
  assert.equal(outreachPolicy.portfolioLibrary.environmentVariable, 'PORTFOLIO_LIBRARY_URL');
  assert.deepEqual(outreachPolicy.replyRouting.fixedAlertEmails, ['waseem@codistan.org', 'sales@codistan.org']);
  assert.equal(outreachPolicy.replyRouting.fixedAlertEnvironmentVariable, 'OUTREACH_ALERT_EMAILS');
  assert.equal(outreachPolicy.replyRouting.additionalOwnerEnvironmentVariable, 'ADDITIONAL_LEAD_OWNERS');
  assert.equal(outreachPolicy.replyRouting.activeSenderEnvironmentVariable, 'OUTREACH_SENDER_EMAILS');
  assert.ok(outreachPolicy.targeting.preferredCountries.includes('United States'));
  assert.ok(outreachPolicy.targeting.preferredCountries.includes('Pakistan'));
  assert.ok(outreachPolicy.targeting.excludedCompanyHeadquartersOrPrimaryOperations.includes('Israel'));
  assert.ok(outreachPolicy.targeting.excludedCompanyHeadquartersOrPrimaryOperations.includes('India'));
  assert.deepEqual(outreachPolicy.targeting.excludedIndustries, ['gambling', 'adult', 'cryptocurrency']);
  assert.equal(outreachPolicy.companyQualification.doNotRejectOnHeadcountAlone, true);
  assert.equal(outreachPolicy.companyQualification.standardAutomaticQualification.minimumEmployees, 10);
  assert.equal(outreachPolicy.companyQualification.microCompanyQualification.minimumStrongCommercialSignals, 2);
  assert.deepEqual(outreachPolicy.sending.steadyStateDailyNewMessagesAcrossDomain, { minimum: 50, maximum: 100 });
  assert.deepEqual(outreachPolicy.followUpSequence.map((step) => step.day), [0, 3, 7, 14]);

  const routingModule = await import('../apps/web/src/outreach-routing.ts');
  const teamMembers = routingModule.getTeamMembers();
  assert.equal(teamMembers.length, 7);
  assert.deepEqual(teamMembers.filter((member) => member.canSendAtLaunch).map((member) => member.email), [
    'talha.bashir@codistan.org',
    'jawad.jutt@codistan.org',
  ]);
  assert.deepEqual(teamMembers.filter((member) => member.canLogin === false).map((member) => member.email), ['hiba', 'bilal']);
  assert.equal(routingModule.getPortfolioLibraryUrl(), process.env.PORTFOLIO_LIBRARY_URL);
  const moizRouting = routingModule.resolveLeadRouting({ id: 'qualified-26', owner: 'moiz.khalid@codistan.org' });
  assert.equal(moizRouting.replyTo, 'moiz.khalid@codistan.org');
  assert.ok(['talha.bashir@codistan.org', 'jawad.jutt@codistan.org'].includes(moizRouting.sendFrom));
  assert.deepEqual(moizRouting.alertEmails.sort(), [
    'moiz.khalid@codistan.org',
    'sales@codistan.org',
    'waseem@codistan.org',
  ].sort());
  const talhaRouting = routingModule.resolveLeadRouting({ id: 'qualified-27', owner: 'talha.bashir@codistan.org' });
  assert.equal(talhaRouting.sendFrom, 'talha.bashir@codistan.org');
  assert.equal(talhaRouting.replyTo, 'talha.bashir@codistan.org');

  const outreachModule = await import('@sales-automation/outreach-email');
  const safeOutreachConfig = outreachModule.loadOutreachEmailConfig({
    OUTREACH_SMTP_HOST: 'sgp200.greengeeks.net',
    OUTREACH_SMTP_PORT: '465',
    OUTREACH_IMAP_HOST: 'sgp200.greengeeks.net',
    OUTREACH_IMAP_PORT: '993',
    OUTREACH_SENDING_ENABLED: 'false',
    OUTREACH_DNS_READY: 'false',
    OUTREACH_DRY_RUN: 'true',
  });
  assert.equal(safeOutreachConfig.smtpHost, 'sgp200.greengeeks.net');
  assert.equal(safeOutreachConfig.smtpPort, 465);
  assert.equal(safeOutreachConfig.imapPort, 993);
  assert.equal(outreachModule.isLiveSendingAllowed(safeOutreachConfig), false);

  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  ) as VercelConfig;
  const rewriteSources = (config.rewrites ?? []).map((rewrite) => rewrite.source);
  const rootRedirect = (config.redirects ?? []).find((redirect) => redirect.source === '/');
  const outreachCron = (config.crons ?? []).find((cron) => cron.path === '/api/cron/outreach');

  assert.equal(rootRedirect?.destination, '/prospects');
  assert.ok(rewriteSources.includes('/prospects'));
  assert.ok(rewriteSources.includes('/api/login'));
  assert.ok(rewriteSources.includes('/api/prospects/:path*'));
  assert.ok(!rewriteSources.includes('/:path*'), 'Vercel internal routes must not be captured by a global rewrite.');
  assert.ok(!rewriteSources.includes('/api/preview'), 'Vercel preview routes must remain owned by Vercel.');
  assert.equal(outreachCron?.schedule, '0 * * * *');
  assert.equal(config.functions?.['api/cron/outreach.ts']?.maxDuration, 300);

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

  console.log('Vercel runtime, guarded outreach cron, owner routing, policy and 75-prospect smoke tests passed');
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
