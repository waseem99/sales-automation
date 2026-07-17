import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { matchesProspectWorkspaceScope } from '@sales-automation/neon-state';
import type { Lead } from '@sales-automation/shared';
import { WORKSPACE_PAGES } from '../vercel/workspace-page-model.ts';

const repositoryRoot = process.cwd();
const repositoryPrefix = `${resolve(repositoryRoot)}${sep}`.toLowerCase();
const readRepositoryFile = (path: string): string => {
  const absolutePath = resolve(repositoryRoot, path);
  const source = readFileSync(absolutePath, 'utf8');
  const pointer = source.trim();
  if (/^[^\r\n\\/]+\.(?:js|ts)$/.test(pointer)) {
    const targetPath = resolve(dirname(absolutePath), pointer);
    if (targetPath.toLowerCase().startsWith(repositoryPrefix) && existsSync(targetPath)) {
      return readFileSync(targetPath, 'utf8');
    }
  }
  return source;
};
const runtimeSource = readRepositoryFile('vercel/workspace-dashboard-runtime.ts');
const pageSource = readRepositoryFile('vercel/workspace-pages.ts');
const modelSource = readRepositoryFile('vercel/workspace-page-model.ts');
const neonStateSource = readRepositoryFile('packages/neon-state/src/index.ts');
const prospectQuerySource = readRepositoryFile('packages/neon-state/src/prospect-query.ts');

assert.equal(hasStaticSalesAutomationRuntimeImport(runtimeSource), false, 'workspace-dashboard-runtime must not use static @sales-automation runtime imports');
assert.equal(hasStaticSalesAutomationRuntimeImport(pageSource), false, 'workspace-pages must allow type-only package imports but reject static runtime package imports');
assert.equal(hasStaticSalesAutomationRuntimeImport(modelSource), false, 'workspace-page-model must allow type-only package imports but reject static runtime package imports');
assert.match(runtimeSource, /import\s*\(\s*['"]@sales-automation\/neon-state['"]\s*\)/, 'workspace runtime must dynamically import neon-state');
assert.match(runtimeSource, /import\s*\(\s*['"]@sales-automation\/prospect-discovery['"]\s*\)/, 'workspace runtime must dynamically import prospect-discovery');
assert.match(runtimeSource, /import\s*\(\s*['"]@sales-automation\/storage['"]\s*\)/, 'workspace runtime must dynamically import storage');
assert.match(runtimeSource, /import\s*\(\s*['"]@sales-automation\/web\/prospect-handler['"]\s*\)/, 'workspace runtime must dynamically import prospect-handler');
assert.doesNotMatch(runtimeSource, /import\s*\(\s*['"]@sales-automation\/neon-state\/portfolio-catalog['"]\s*\)/, 'workspace runtime must not load the portfolio catalog module');
assert.equal(runtimeSource.includes('loadNeonDiscoveryRuns'), false, 'workspace runtime must not load discovery runs');
assert.equal(runtimeSource.includes('loadApprovedPortfolioCatalog'), false, 'workspace runtime must not load the approved portfolio catalog');
assert.equal(runtimeSource.includes('persistLeadRecords'), false, 'workspace runtime must not persist the full lead collection');
assert.equal(runtimeSource.includes('loadNeonScopedRecordsWithMetrics'), false, 'workspace runtime must not use the legacy scoped-record loader');
assert.equal(runtimeSource.includes('buildWorkspacePage('), false, 'workspace runtime must not build pages from a full in-memory collection');
assert.match(runtimeSource, /loadNeonProspectPageWithMetrics/);
assert.match(runtimeSource, /loadNeonProspectRecordWithMetrics/);
assert.match(runtimeSource, /workspace\.queryScope/);
assert.match(runtimeSource, /selectedId\s*\?\s*await neonState\.loadNeonProspectRecordWithMetrics/);
assert.match(runtimeSource, /new prospectDiscovery\.InMemoryProspectDiscoveryRunStore\(\)/);
assert.match(runtimeSource, /portfolioItems: \[\]/);
assert.match(runtimeSource, /x-prospect-query-count/);
assert.match(runtimeSource, /x-prospect-schema-query-count/);
assert.match(runtimeSource, /x-prospect-data-query-count/);
assert.match(runtimeSource, /x-prospect-page-query-count/);
assert.match(runtimeSource, /x-prospect-detail-query-count/);
assert.match(runtimeSource, /x-prospect-support-query-count/);
assert.match(runtimeSource, /x-prospect-schema-cache/);
assert.match(runtimeSource, /x-prospect-runtime-state/);
assert.match(runtimeSource, /PROSPECT_WORKSPACE_TIMING/);
assert.match(runtimeSource, /leadDetailRequested: Boolean\(selectedId\)/);
assert.match(runtimeSource, /prospect_modules/);
assert.match(runtimeSource, /prospect_page/);
assert.match(runtimeSource, /prospect_detail/);
assert.match(runtimeSource, /prospect_render/);
assert.match(runtimeSource, /prospect_total/);
assert.match(neonStateSource, /schemaReadiness/);
assert.match(neonStateSource, /ensureNeonSchemaWithMetrics/);
assert.match(neonStateSource, /SCHEMA_QUERY_COUNT = 5/);
assert.match(neonStateSource, /cacheState: 'cold' \| 'warm'/);
assert.match(neonStateSource, /schemaReadiness\.delete/);
assert.match(prospectQuerySource, /ProspectWorkspaceScope/);
assert.match(prospectQuerySource, /loadNeonProspectPageWithMetrics/);
assert.match(prospectQuerySource, /loadNeonProspectRecordWithMetrics/);
assert.match(prospectQuerySource, /queryCount: schema\.queryCount \+ 4/);
assert.match(prospectQuerySource, /dataQueryCount: 4/);
assert.match(prospectQuerySource, /queryCount: schema\.queryCount \+ 1/);
assert.match(prospectQuerySource, /dataQueryCount: 1/);
assert.match(prospectQuerySource, /requireKnownService/);
assert.match(prospectQuerySource, /jsonb_typeof\(record->'lead'->'tender'\)/);
assert.match(prospectQuerySource, /LOWER\(record::text\)/);
assert.match(prospectQuerySource, /follow_up_at\(record\)/);
assert.match(modelSource, /queryScope: ProspectWorkspaceScope/);
assert.match(modelSource, /queryScopeFor/);
assert.match(pageSource, /from\s+['"]\.\/workspace-page-model\.js['"]/, 'workspace-pages must import workspace-page-model using the runtime .js path');
assert.equal(modelSource.includes('normalizeWorkspacePageQuery'), true, 'workspace-page-model must use normalizeWorkspacePageQuery');
assert.equal(modelSource.includes('normalizeProspectPageQuery'), false, 'workspace-page-model must not use the legacy normalizeProspectPageQuery');

const samples = workspaceSamples();
for (const page of WORKSPACE_PAGES) {
  for (const lead of samples) {
    assert.equal(
      matchesProspectWorkspaceScope(lead, page.queryScope),
      page.match(lead),
      `${page.id} query scope must match the established in-memory predicate for ${lead.id}`,
    );
  }
}

console.log('Neon-native workspace pagination keeps dynamic boundaries, uses four warm list statements plus optional detail, and matches established workspace predicates');

function hasStaticSalesAutomationRuntimeImport(source: string): boolean {
  const importDeclarations = source.match(/^\s*import\b[\s\S]*?;\s*$/gm) ?? [];
  return importDeclarations.some((declaration) => {
    if (!/from\s+['"]@sales-automation\//.test(declaration)) return false;
    return !/^\s*import\s+type\b/.test(declaration);
  });
}

function workspaceSamples(): Lead[] {
  return [
    lead('generic'),
    lead('linkedin-source', { source: 'linkedin' }),
    lead('sales-nav-source', { source: 'sales_navigator' }),
    lead('linkedin-type', { leadType: 'linkedin_warm_post' }),
    lead('sales-nav-type', { leadType: 'linkedin_sales_nav_alert' }),
    lead('upwork-source', { source: 'upwork' }),
    lead('upwork-type', { leadType: 'upwork_job' }),
    lead('rfq', { tender: tender('rfq') }),
    lead('rfp', { tender: tender('rfp') }),
    lead('eoi', { tender: tender('eoi') }),
    lead('rfi', { tender: tender('rfi') }),
    lead('itt', { tender: tender('itt') }),
    lead('public-procurement', { source: 'public_procurement' }),
    lead('research', { pipelineStatus: 'needs_research' }),
    lead('partner-stage', { prospectStage: 'partner_prospect' }),
    lead('partner-status', { opportunityStatus: 'partnership_target' }),
    lead('partner-type', { leadType: 'partner_prospect' }),
    lead('partner-source', { source: 'partner_research' }),
    lead('ai', { serviceCategory: 'ai_automation' }),
    lead('rag', { serviceCategory: 'rag_document_intelligence' }),
    lead('ai-saas', { serviceCategory: 'ai_saas_mvp' }),
    lead('voice-ai', { serviceCategory: 'voice_ai_agent' }),
    lead('fullstack', { serviceCategory: 'fullstack_web_app' }),
    lead('nextjs', { serviceCategory: 'nextjs_python_app' }),
    lead('enterprise', { serviceCategory: 'enterprise_systems' }),
    lead('cybersecurity', { serviceCategory: 'cybersecurity_compliance' }),
    lead('immersive', { serviceCategory: 'ar_3d_unity_unreal' }),
    lead('marketing', { serviceCategory: 'website_portal' }),
    lead('unknown-service', { serviceCategory: 'unknown' }),
  ];
}

function lead(id: string, overrides: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'public_web',
    sourceUrl: `https://example.com/${id}`,
    leadType: 'public_opportunity',
    title: id,
    description: id,
    companyName: id,
    serviceCategory: 'unknown',
    pipelineStatus: 'new',
    capturedAt: '2026-07-16T00:00:00.000Z',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  } as Lead;
}

function tender(opportunityType: NonNullable<Lead['tender']>['opportunityType']): NonNullable<Lead['tender']> {
  return {
    opportunityType,
    sector: 'public',
  } as NonNullable<Lead['tender']>;
}
