import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { StoredLeadRecord } from '@sales-automation/storage';
import {
  enhanceProspectPartialNavigation,
  extractProspectPartialContent,
} from '../vercel/prospect-partial-navigation.ts';
import { enhanceProspectWorkflowUi } from '../vercel/prospect-workflow-ui.ts';

const repositoryRoot = resolve(process.cwd());

function readRepositoryFile(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  assertInsideRepository(absolutePath);
  const source = readFileSync(absolutePath, 'utf8');
  const pointer = source.trim();

  // Git symlinks are checked out as one-line pointer files on Windows when
  // symbolic-link creation is unavailable. Resolve only a safe, local source
  // pointer and otherwise return the original file content unchanged.
  if (/^[^\r\n]+\.(?:[cm]?[jt]sx?)$/.test(pointer)) {
    const targetPath = resolve(dirname(absolutePath), pointer);
    assertInsideRepository(targetPath);
    return readFileSync(targetPath, 'utf8');
  }

  return source;
}

function assertInsideRepository(path: string): void {
  const pathFromRoot = relative(repositoryRoot, path);
  assert.equal(
    pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !resolve(pathFromRoot).startsWith(sep)),
    true,
    `repository source path must stay inside the checkout: ${path}`,
  );
}

function main(): void {
  const script = readRepositoryFile('public/assets/prospect-partial-navigation.v2.js');
  const styles = readRepositoryFile('public/assets/prospect-partial-navigation.v2.css');
  const workflowScript = readRepositoryFile('public/assets/prospect-workflow.v1.js');
  const workflowStyles = readRepositoryFile('public/assets/prospect-workflow.v1.css');
  assert.doesNotThrow(() => new Function(script), 'partial navigation browser asset must parse');
  assert.doesNotThrow(() => new Function(workflowScript), 'prospect workflow browser asset must parse');
  assert.match(script, /x-prospect-partial/);
  assert.match(script, /pushState/);
  assert.match(script, /replaceState/);
  assert.match(script, /popstate/);
  assert.match(script, /prospect-drawer-close/);
  assert.match(script, /drawerEntry/);
  assert.match(script, /AbortController/);
  assert.match(script, /Retry/);
  assert.match(script, /isRegisteredWorkspaceAnchor/);
  assert.match(script, /pathname\.startsWith\('\/leads\/'\)/);
  assert.match(script, /pathname\.startsWith\('\/services\/'\)/);
  assert.match(script, /workspaceUrl/);
  assert.match(script, /syncWorkspaceChrome/);
  assert.match(script, /prospectDocumentTitle/);
  assert.match(script, /x-prospect-server-ms/);
  assert.match(script, /prospect:partial-performance/);
  assert.match(script, /__prospectPerformance/);
  assert.match(script, /sessionStorage/);
  assert.match(script, /FILTER_BUDGET_MS = 500/);
  assert.match(script, /DRAWER_BUDGET_MS = 400/);
  assert.match(script, /focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /closeMobileSidebar/);
  assert.doesNotMatch(script, /targetUrl\.search/);
  assert.match(styles, /partial-loading/);
  assert.match(styles, /partial-workspace-loading/);
  assert.match(styles, /prospect-skeleton/);
  assert.match(styles, /width:\s*44px/);
  assert.match(styles, /@media \(max-width: 800px\)/);
  assert.match(styles, /prefers-reduced-motion/);

  assert.match(workflowScript, /prospect-workflow-density-v1/);
  assert.match(workflowScript, /prospect-workflow-last-visit-v1/);
  assert.match(workflowScript, /data-workflow-sort/);
  assert.match(workflowScript, /prospect:partial-performance/);
  assert.match(workflowScript, /pagehide/);
  assert.match(workflowStyles, /decision-workspace/);
  assert.match(workflowStyles, /workflow-saved-views/);
  assert.match(workflowStyles, /workflow-density-compact/);
  assert.match(workflowStyles, /width:\s*44px/);
  assert.match(workflowStyles, /@media\(max-width:800px\)/);

  const source = '<!doctype html><html><head><title>LinkedIn Leads · Codistan Prospect Desk</title></head><body class="access-no-assign"><div class="app-shell"><aside id="workspace-sidebar"></aside><main class="main"><header class="topbar"><div><h1>LinkedIn Leads</h1></div></header><section class="metrics"><a class="metric-link" href="/leads/linkedin?followUp=due">Due</a></section><form class="toolbar server-toolbar"><select name="followUp"><option value="due">Due</option></select></form><section class="workspace"><div class="prospect-list"><div class="section-heading"><div><h2>Prospects</h2><p>One record</p></div></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Company</th></tr></thead><tbody id="prospect-rows"><tr class="prospect-row selected"><td><a href="/leads/linkedin?leadId=x">X</a></td></tr></tbody></table></div></div><div class="detail-panel"><div class="detail-header"><div><h2>Example</h2></div><span class="score">82<small>/100</small></span></div><div class="detail-grid"><div>Buyer</div></div><section class="detail-section evidence"><h3>Why this prospect is here</h3><p>Evidence</p></section><section class="detail-section service-box"><h3>Service and sales package</h3></section><section class="detail-section"><h3>Recommended outreach</h3></section><section class="detail-section guidance-box"><h3>Engagement intelligence</h3></section><section class="detail-section action-forms"><h3>Assign and manage</h3><form data-action-form data-endpoint="/api/prospects/x/status"><select name="status"></select><button type="submit">Update status</button></form><form data-action-form data-endpoint="/api/prospects/x/owner"><input name="owner"/><button type="submit">Assign owner</button></form><form data-action-form data-endpoint="/api/prospects/x/followup"><input name="nextFollowUpAt"/><button type="submit">Schedule follow-up</button></form></section><section class="detail-section routing-box"><h3>Reply routing</h3></section><section class="detail-section"><h3>Log team activity</h3></section><section class="detail-section feedback-box"><div>Feedback</div></section><section class="detail-section"><h3>Activity timeline</h3></section></div></section></main></div><script>base()</script></body></html>';
  const record = sampleRecord();
  const workflowEnhanced = enhanceProspectWorkflowUi(source, {
    activeRoute: '/leads/linkedin',
    records: [record],
    selected: record,
    generatedAt: '2026-07-16T05:00:00.000Z',
    page: 1,
    pageSize: 25,
    query: { search: '', status: '', signal: '', service: '', owner: '', feedback: '', followUp: '' },
  });
  assert.match(workflowEnhanced, /data-prospect-workflow-table/);
  assert.match(workflowEnhanced, /Saved views/);
  assert.match(workflowEnhanced, /Due now/);
  assert.match(workflowEnhanced, /Service & score/);
  assert.match(workflowEnhanced, /Owner & status/);
  assert.match(workflowEnhanced, /Next action/);
  assert.match(workflowEnhanced, /Evidence verified/);
  assert.match(workflowEnhanced, /Follow-up overdue/);
  assert.match(workflowEnhanced, /Priority A/);
  assert.match(workflowEnhanced, /decision-workspace/);
  assert.match(workflowEnhanced, /id="buyer-contact"/);
  assert.match(workflowEnhanced, /id="source-evidence"/);
  assert.match(workflowEnhanced, /id="commercial-fit"/);
  assert.match(workflowEnhanced, /id="outreach-plan"/);
  assert.match(workflowEnhanced, /id="activity-history"/);
  assert.match(workflowEnhanced, /Missing data/);
  assert.match(workflowEnhanced, /prospect-workflow\.v1\.css/);
  assert.match(workflowEnhanced, /prospect-workflow\.v1\.js/);
  assert.equal((workflowEnhanced.match(/data-endpoint="\/api\/prospects\/x\/status"/g) ?? []).length, 1);
  assert.equal((workflowEnhanced.match(/Assign and manage/g) ?? []).length, 0);

  const enhanced = enhanceProspectPartialNavigation(workflowEnhanced, {
    activeRoute: '/leads/linkedin',
    drawerOpen: true,
    documentTitle: 'LinkedIn Leads · Codistan Prospect Desk',
    navigationLabel: 'LinkedIn',
    eyebrow: 'Warm leads',
    title: 'LinkedIn Leads',
    description: 'Qualified LinkedIn opportunities.',
    serverMs: 123.6,
  });
  assert.match(enhanced, /<body class="access-no-assign drawer-open">/);
  assert.match(enhanced, /data-prospect-partial-root/);
  assert.match(enhanced, /data-prospect-workspace-route="\/leads\/linkedin"/);
  assert.match(enhanced, /data-prospect-document-title="LinkedIn Leads · Codistan Prospect Desk"/);
  assert.match(enhanced, /data-prospect-server-ms="124"/);
  assert.match(enhanced, /id="prospect-drawer"/);
  assert.match(enhanced, /role="dialog"/);
  const fragment = extractProspectPartialContent(enhanced);
  assert.match(fragment, /^<div id="prospect-content"/);
  assert.match(fragment, /data-prospect-workflow-table/);
  assert.doesNotMatch(fragment, /<header class="topbar">/);
  assert.match(fragment, /name="followUp"/);
  assert.doesNotMatch(fragment, /<html|<script/);
  assert.throws(() => extractProspectPartialContent('<html><body>No markers</body></html>'), /markers are missing/);

  const runtime = readRepositoryFile('vercel/workspace-dashboard-runtime.ts');
  const neonQuery = readRepositoryFile('packages/neon-state/src/prospect-query.ts');
  assert.match(runtime, /prospect-workflow-ui/);
  assert.match(runtime, /enhanceProspectWorkflowUi/);
  assert.match(runtime, /PROSPECT_WORKFLOW_UI_ERROR/);
  assert.match(runtime, /records:\s*built\.page\.records/);
  assert.match(runtime, /selected:\s*built\.selected/);
  assert.match(runtime, /prospect-partial-navigation/);
  assert.match(runtime, /enhanceProspectPartialNavigation/);
  assert.match(runtime, /extractProspectPartialContent/);
  assert.match(runtime, /x-prospect-partial-route/);
  assert.match(runtime, /x-prospect-server-ms/);
  assert.match(runtime, /server-timing/);
  assert.match(neonQuery, /follow_ups_due/);
  assert.match(neonQuery, /filters\.followUp} = 'due'/);
  assert.match(neonQuery, /actionable_follow_up\(record\)/);

  console.log('Prospect workflow, cross-workspace navigation, timing, drawer and follow-up queue contract passed');
}

function sampleRecord(): StoredLeadRecord {
  return {
    lead: {
      id: 'x',
      source: 'linkedin',
      sourceUrl: 'https://example.com/source',
      leadType: 'linkedin_warm_post',
      title: 'AI automation delivery partner needed',
      description: 'Buyer needs an implementation partner.',
      companyName: 'Example Buyer',
      companyWebsite: 'https://example.com',
      contactName: 'Buyer Name',
      contactRole: 'Founder',
      contactEmail: 'buyer@example.com',
      serviceCategory: 'ai_automation',
      opportunityStatus: 'live_opportunity',
      discoverySource: 'LinkedIn buyer post',
      evidenceUrl: 'https://example.com/source',
      evidenceSummary: 'The buyer explicitly requested an AI automation implementation partner.',
      capturedAt: '2026-07-15T10:00:00.000Z',
      createdAt: '2026-07-15T10:00:00.000Z',
      updatedAt: '2026-07-16T04:00:00.000Z',
      pipelineStatus: 'approved_to_contact',
      score: { total: 84, status: 'hot', urgency: 'urgent', explanation: 'Strong fit', redFlags: [], breakdown: { serviceFit: 15, buyerQuality: 15, budgetRoi: 10, timingUrgency: 15, portfolioProofMatch: 12, competitionAccessRisk: 9, complianceSafety: 8 } },
      owner: 'waseem@codistan.org',
      nextFollowUpAt: '2026-07-16T03:00:00.000Z',
      followUpNote: 'Send a human-reviewed AI automation capability note.',
      recommendedNextAction: 'Verify the buyer post and prepare a focused first outreach.',
      budgetSignal: 'Funded implementation request',
      timelineSignal: 'Immediate',
    },
    notes: [],
    auditLog: [],
  } as unknown as StoredLeadRecord;
}

main();
