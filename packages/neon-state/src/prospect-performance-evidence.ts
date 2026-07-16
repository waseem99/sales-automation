import { neon } from '@neondatabase/serverless';
import { ensureNeonSchemaWithMetrics, requireDatabaseUrl } from './index.js';
import { loadNeonProspectPageWithMetrics } from './prospect-page-query.js';
import { loadNeonScopedRecords } from './prospect-query.js';
import {
  ensureProspectQueryIndexesWithMetrics,
  PROSPECT_QUERY_INDEX_MIGRATION_VERSION,
  PROSPECT_QUERY_INDEX_NAMES,
} from './prospect-query-indexes.js';
import { compareDefaultProspectPage } from './prospect-performance-equivalence.js';
import { loadProspectEvidenceMetadata, loadProspectEvidenceRepresentatives } from './prospect-performance-metadata.js';
import { loadProspectPlanEvidence } from './prospect-performance-plan.js';
import type { ProspectPerformanceEvidence } from './prospect-performance-types.js';

export { summarizeProspectPlan } from './prospect-performance-plan.js';
export type { ProspectPerformanceEvidence, ProspectPlanSummary } from './prospect-performance-types.js';

export async function loadProspectPerformanceEvidence(databaseUrl: string): Promise<ProspectPerformanceEvidence> {
  const normalizedUrl = requireDatabaseUrl(databaseUrl);
  const generatedAt = new Date().toISOString();
  const schema = await ensureNeonSchemaWithMetrics(normalizedUrl);
  const indexMigration = await ensureProspectQueryIndexesWithMetrics(normalizedUrl);
  const sql = neon(normalizedUrl);
  const metadata = await loadProspectEvidenceMetadata(sql, PROSPECT_QUERY_INDEX_MIGRATION_VERSION);
  const representatives = await loadProspectEvidenceRepresentatives(sql);
  const planner = await loadProspectPlanEvidence(sql, representatives);
  const optimizedPage = await loadNeonProspectPageWithMetrics(normalizedUrl, { page: 1, pageSize: 25 }, { canViewAll: true, ownerTokens: [] }, {});
  const comparisonRecords = await loadNeonScopedRecords(normalizedUrl, { canViewAll: true, ownerTokens: [] }, 10_000);
  const equivalence = compareDefaultProspectPage(optimizedPage.page, comparisonRecords, generatedAt);

  const installedNames = new Set(metadata.installedIndexes.map((item) => item.name));
  const missing = PROSPECT_QUERY_INDEX_NAMES.filter((name) => !installedNames.has(name));
  const warnings: string[] = [];
  if (!metadata.appliedAt) warnings.push(`Migration ${PROSPECT_QUERY_INDEX_MIGRATION_VERSION} is not recorded as applied.`);
  if (missing.length > 0) warnings.push(`${missing.length} expected index${missing.length === 1 ? ' is' : 'es are'} missing.`);
  const sequentialPlans = planner.filter((plan) => !plan.usesExpectedIndex).map((plan) => plan.id);
  if (sequentialPlans.length > 0) warnings.push(`Planner did not select an expected index for: ${sequentialPlans.join(', ')}. Small tables may legitimately prefer sequential scans.`);
  if (!equivalence.checked || !equivalence.stableCountMatches || !equivalence.followUpsDueMatches || !equivalence.firstPageOrderMatches) {
    warnings.push('Live result-equivalence evidence is incomplete or did not match.');
  }

  const evidenceQueryCount = 4 + planner.length;
  return {
    generatedAt,
    migration: {
      version: PROSPECT_QUERY_INDEX_MIGRATION_VERSION,
      applied: Boolean(metadata.appliedAt),
      appliedAt: metadata.appliedAt,
      notes: metadata.notes,
    },
    table: { estimatedRows: metadata.estimatedRows },
    indexes: {
      expected: [...PROSPECT_QUERY_INDEX_NAMES],
      installed: metadata.installedIndexes,
      missing,
      allExpectedInstalled: missing.length === 0,
    },
    planner,
    equivalence,
    metrics: {
      queryCount: schema.queryCount + indexMigration.queryCount + evidenceQueryCount,
      schemaQueryCount: schema.queryCount + indexMigration.queryCount,
      evidenceQueryCount,
      schemaCacheState: schema.cacheState,
      indexMigrationCacheState: indexMigration.cacheState,
    },
    safeguards: {
      analyzeExecuted: false,
      leadRowsReturned: false,
      sensitiveDataIncluded: false,
      comparisonRecordLimit: 10_000,
    },
    warnings,
  };
}
