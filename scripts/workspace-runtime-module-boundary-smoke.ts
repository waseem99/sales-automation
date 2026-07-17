import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { matchesProspectWorkspaceScope } from '@sales-automation/neon-state';
import type { Lead } from '@sales-automation/shared';
import { WORKSPACE_PAGES } from '../vercel/workspace-page-model.ts';

const runtimeSource = readFileSync(new URL('../vercel/workspace-dashboard-runtime.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../vercel/workspace-pages.ts', import.meta.url), 'utf8');
const modelSource = readFileSync(new URL('../vercel/workspace-page-model.ts', import.meta.url), 'utf8');
const neonStateSource = readFileSync(new URL('../packages/neon-state/src/index.ts', import.meta.url), 'utf8');
const prospectQuerySource = readFileSync(new URL('../packages/neon-state/src/prospect-query.ts', import.meta.url), 'utf8');

assert.equal(hasStaticSalesAutomationRuntimeImport(runtimeSource, 'workspace-dashboard-runtime.ts'), false);
assert.equal(hasStaticSalesAutomationRuntimeImport(pageSource, 'workspace-pages.ts'), false);
assert.equal(hasStaticSalesAutomationRuntimeImport(modelSource, 'workspace-page-model.ts'), false);
assert.equal(runtimeSource.includes("import('@sales-automation/neon-state')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/prospect-discovery')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/storage')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/web/prospect-handler')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/neon-state/portfolio-catalog')"), false);
assert.equal(runtimeSource.includes('loadNeonDiscoveryRuns'), false);
assert.equal(runtimeSource.includes('loadApprovedPortfolioCatalog'), false);
assert.equal(runtimeSource.includes('persistLeadRecords'), false);
assert.equal(runtimeSource.includes('loadNeonScopedRecordsWithMetrics'), false);
assert.equal(runtimeSource.includes('buildWorkspacePage('), false);
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
assert.equal(pageSource.includes("from './workspace-page-model.js'"), true);
assert.equal(modelSource.includes('normalizeWorkspacePageQuery'), true);
assert.equal(modelSource.includes('normalizeProspectPageQuery'), false);

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

function hasStaticSalesAutomationRuntimeImport(source: string, fileName: string): boolean {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sourceFile.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement)) return false;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return false;
    if (!statement.moduleSpecifier.text.startsWith('@sales-automation/')) return false;
    return statement.importClause?.isTypeOnly !== true;
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
