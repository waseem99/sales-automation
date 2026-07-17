import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Lead } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';
import {
  applyWorkspacePageChrome,
  buildWorkspacePage,
  resolveWorkspacePage,
  WORKSPACE_PAGES,
} from '../vercel/workspace-pages.js';
import { isWorkspaceDashboardPath } from '../vercel/workspace-dashboard-runtime.js';

const now = '2026-07-15T12:00:00.000Z';
const records: StoredLeadRecord[] = [
  record(lead('linkedin', 'linkedin', 'linkedin_warm_post', 'website_portal')),
  record(lead('upwork', 'upwork', 'upwork_job', 'fullstack_web_app')),
  record({ ...lead('rfq', 'public_procurement', 'public_opportunity', 'cybersecurity_compliance'), tender: tender('rfq') }),
  record({ ...lead('rfp', 'public_procurement', 'public_opportunity', 'enterprise_systems'), tender: tender('rfp') }),
  record({ ...lead('eoi', 'public_procurement', 'public_opportunity', 'ai_automation'), tender: tender('eoi') }),
  record({ ...lead('rfi', 'public_procurement', 'public_opportunity', 'rag_document_intelligence'), tender: tender('rfi') }),
  record(lead('ai', 'public_web', 'public_opportunity', 'voice_ai_agent')),
  record(lead('immersive', 'public_web', 'public_opportunity', 'ar_3d_unity_unreal')),
  record({ ...lead('research', 'public_web', 'public_opportunity', 'unknown'), pipelineStatus: 'needs_research' }),
];

assert.equal(new Set(WORKSPACE_PAGES.map((page) => page.route)).size, WORKSPACE_PAGES.length);
assert.equal(resolveWorkspacePage('/leads/linkedin')?.id, 'linkedin');
assert.equal(resolveWorkspacePage('/services/software/')?.id, 'software');
assert.equal(resolveWorkspacePage('/not-a-workspace'), undefined);
assert.equal(isWorkspaceDashboardPath('/leads/rfq'), true);
assert.equal(isWorkspaceDashboardPath('/services/cybersecurity/'), true);
assert.equal(isWorkspaceDashboardPath('/operations'), false);

const linkedin = buildWorkspacePage(records, { pageSize: 25 }, requiredPage('/leads/linkedin'), undefined, now);
assert.equal(linkedin.page.visibleTotal, 1);
assert.equal(linkedin.page.records[0]?.lead.id, 'linkedin');

const procurement = buildWorkspacePage(records, { pageSize: 25 }, requiredPage('/leads/tenders'), undefined, now);
assert.equal(procurement.page.visibleTotal, 4);
assert.equal(buildWorkspacePage(records, {}, requiredPage('/leads/rfq'), undefined, now).page.visibleTotal, 1);
assert.equal(buildWorkspacePage(records, {}, requiredPage('/leads/rfp'), undefined, now).page.visibleTotal, 1);
assert.equal(buildWorkspacePage(records, {}, requiredPage('/leads/eoi'), undefined, now).page.visibleTotal, 1);
assert.equal(buildWorkspacePage(records, {}, requiredPage('/leads/rfi'), undefined, now).page.visibleTotal, 1);

const ai = buildWorkspacePage(records, {}, requiredPage('/services/ai'), undefined, now);
assert.equal(ai.page.visibleTotal, 3);
assert.ok(ai.page.records.every((item) => ['ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'voice_ai_agent'].includes(item.lead.serviceCategory)));

const research = buildWorkspacePage(records, {}, requiredPage('/leads/research'), undefined, now);
assert.equal(research.page.visibleTotal, 1);
assert.equal(research.page.records[0]?.lead.pipelineStatus, 'needs_research');

const sampleHtml = `<!doctype html><html><head><title>Codistan Prospect Desk</title><style></style></head><body><div class="app-shell"><aside class="sidebar">old</aside><main class="main"><header class="topbar"><div><p class="eyebrow">Live internal BD workspace</p><h1>Prospect Discovery & Management</h1><p>Old description.</p></div><div class="top-actions"></div></header><form class="toolbar server-toolbar" action="/prospects"></form><div class="prospect-list"><div class="section-heading"><div><h2>Prospects</h2><p>Old list copy.</p></div></div><a href="/prospects?leadId=1">Lead</a><table><tbody><tr><td colspan="7" class="empty">No prospects.</td></tr></tbody></table></div><section class="lower-grid">old</section><section class="panel runs-panel">runs</section></main></div><script></script></body></html>`;
const transformed = applyWorkspacePageChrome(sampleHtml, requiredPage('/leads/rfq'), buildWorkspacePage(records, {}, requiredPage('/leads/rfq'), undefined, now).page.summary);
assert.match(transformed, /Request for Quotation Leads/);
assert.match(transformed, /class="nav-item active" href="\/prospects"/);
assert.match(transformed, /class="workspace-tab active" aria-current="page">Tenders<\/a>/);
assert.match(transformed, /href="\/leads\/rfq\?leadId=1"/);
assert.match(transformed, /action="\/leads\/rfq"/);
assert.doesNotMatch(transformed, /section class="lower-grid"/);
assert.match(transformed, /sidebar-toggle/);
assert.doesNotMatch(transformed, /LinkedIn warm leads<\/span>/);
assert.doesNotMatch(transformed, /RFQs<\/span>/);
assert.doesNotMatch(transformed, /AI and automation<\/span>/);

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites: Array<{ source: string; destination: string }>;
};
for (const page of WORKSPACE_PAGES) {
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === page.route
    && rewrite.destination.includes('/api/dashboard')
    && rewrite.destination.includes(`__path=${page.route}`)),
  `Missing dashboard rewrite for ${page.route}`);
}
const dashboardSource = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');
assert.match(dashboardSource, /workspace-dashboard-runtime\.js/);
assert.match(dashboardSource, /isWorkspaceDashboardPath\(pathname\)/);
assert.doesNotMatch(JSON.stringify(vercel), /api\/workspaces/);

console.log('Dedicated workspace routes, filters, compact sidebar tabs and existing-dashboard routing smoke tests passed');

function requiredPage(route: string) {
  const page = resolveWorkspacePage(route);
  assert.ok(page, `Missing workspace page ${route}`);
  return page;
}

function lead(
  id: string,
  source: Lead['source'],
  leadType: Lead['leadType'],
  serviceCategory: Lead['serviceCategory'],
): Lead {
  return {
    id,
    source,
    leadType,
    prospectStage: source === 'linkedin' || source === 'upwork' ? 'warm_lead' : 'unknown',
    title: `${id} opportunity`,
    description: `A verified ${id} opportunity requiring external delivery support.`,
    serviceCategory,
    opportunityStatus: 'live_opportunity',
    capturedAt: now,
    pipelineStatus: 'new',
    createdAt: now,
    updatedAt: now,
  };
}

function record(value: Lead): StoredLeadRecord {
  return { lead: value, notes: [], alertDedupeKeysSent: [], auditLog: [] };
}

function tender(opportunityType: NonNullable<Lead['tender']>['opportunityType']): NonNullable<Lead['tender']> {
  return {
    portal: 'Official procurement portal',
    sector: 'public',
    opportunityType,
    localPresenceRequired: 'unclear',
    consortiumAllowed: 'unclear',
    closeabilityScore: 75,
    recommendation: 'review_now',
    recommendationReason: 'Review formal requirements.',
    eligibilitySignals: [],
    riskFlags: [],
  };
}
