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
  portfolioLibrary: { environmentVariable: string };
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
  process.env.ADMIN_PASSWORD ||= 'vercel-smoke-password';
  process.env.WASEEM_DASHBOARD_PASSWORD ||= 'waseem-smoke-password';
  process.env.TALHA_DASHBOARD_PASSWORD ||= 'talha-smoke-password';
  process.env.JAWAD_DASHBOARD_PASSWORD ||= 'jawad-smoke-password';
  process.env.MOIZ_DASHBOARD_PASSWORD ||= 'moiz-smoke-password';
  process.env.SUBAINA_DASHBOARD_PASSWORD ||= 'subaina-smoke-password';
  process.env.DANISH_DASHBOARD_PASSWORD ||= 'danish-smoke-password';
  process.env.HIBA_DASHBOARD_PASSWORD ||= 'hiba-smoke-password';
  process.env.BILAL_DASHBOARD_PASSWORD ||= 'bilal-smoke-password';
  process.env.SESSION_SECRET ||= 'vercel-smoke-session-secret-123456789';
  process.env.PORTFOLIO_LIBRARY_URL ||= 'https://drive.google.com/drive/folders/smoke-test';
  process.env.OUTREACH_ALERT_EMAILS ||= 'waseem@codistan.org,sales@codistan.org';

  assert.equal(verifiedStarterProspects.length, 75);
  assert.equal(new Set(verifiedStarterProspects.map((lead) => lead.id)).size, 75);
  assert.deepEqual(
    verifiedStarterProspects.map((lead) => lead.rank),
    Array.from({ length: 75 }, (_value, index) => index + 1),
  );
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

  const outreachPolicy = JSON.parse(
    readFileSync(new URL('../config/outreach-policy.json', import.meta.url), 'utf8'),
  ) as OutreachPolicy;
  assert.equal(outreachPolicy.version, 3);
  assert.equal(outreachPolicy.businessAddress, 'Codistan Ventures Building, Plot No. 15, I-11/3, Islamabad 44000, Pakistan');
  assert.deepEqual(outreachPolicy.senderStrategy.primarySenders, ['sales@codistan.org']);
  assert.equal(outreachPolicy.senderStrategy.secondarySendersAfterWarmup.length, 0);
  assert.equal(outreachPolicy.teamMembers.length, 7);
  assert.ok(outreachPolicy.teamMembers.includes('hibasohail@codistan.org'));
  assert.ok(outreachPolicy.teamMembers.includes('bilalahmed@codistan.org'));
  assert.equal(outreachPolicy.portfolioLibrary.environmentVariable, 'PORTFOLIO_LIBRARY_URL');
  assert.deepEqual(outreachPolicy.replyRouting.fixedAlertEmails, ['waseem@codistan.org', 'sales@codistan.org']);
  assert.equal(outreachPolicy.replyRouting.activeSenderEnvironmentVariable, 'SALES_MAILBOX_PASSWORD');
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
  const moizRouting = routingModule.resolveLeadRouting({ id: 'qualified-26', owner: 'moiz.khalid@codistan.org' });
  assert.equal(moizRouting.sendFrom, 'sales@codistan.org');
  assert.equal(moizRouting.replyTo, 'moiz.khalid@codistan.org');
  assert.deepEqual(moizRouting.ccEmails.sort(), ['moiz.khalid@codistan.org', 'waseem@codistan.org'].sort());

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
  assert.equal(outreachModule.isLiveSendingAllowed(safeOutreachConfig), false);

  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  ) as VercelConfig;
  const rewriteSources = (config.rewrites ?? []).map((rewrite) => rewrite.source);
  const rootRedirect = (config.redirects ?? []).find((redirect) => redirect.source === '/');
  const outreachCron = (config.crons ?? []).find((cron) => cron.path === '/api/cron/outreach');

  assert.equal(rootRedirect?.destination, '/prospects');
  for (const source of ['/prospects', '/tenders', '/api/login', '/api/prospects/:path*']) {
    assert.ok(rewriteSources.includes(source), `${source} must remain routed.`);
  }
  for (const retired of ['/lead-desk', '/api/opportunities', '/api/opportunities/:path*', '/api/ingest/:path*', '/api/dev/:path*']) {
    assert.ok(!rewriteSources.includes(retired), `${retired} must remain retired.`);
  }
  assert.ok(!rewriteSources.includes('/:path*'));
  assert.ok(!rewriteSources.includes('/api/preview'));
  assert.ok(!config.functions?.['api/index.ts'], 'The duplicate api/index.ts runtime must stay removed.');
  assert.equal(config.functions?.['api/dashboard.ts']?.maxDuration, 300);
  assert.equal(outreachCron?.schedule, '0 * * * *');

  const dashboardModule = await import('../api/dashboard.ts');
  const handler = dashboardModule.default as { fetch(request: Request): Promise<Response> };
  const health = await handler.fetch(new Request('https://example.test/api/dashboard?__path=/health'));
  assert.equal(health.status, 200);
  const healthBody = await health.json() as Record<string, unknown>;
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.configuredTeamAccountCount, 8);

  console.log('Single-runtime Vercel architecture, routing policy and safety smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
