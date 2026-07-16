interface EvidenceSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  query(text: string, params?: unknown[]): Promise<unknown[]>;
}

import type { ProspectEvidenceRepresentatives, ProspectPlanSummary } from './prospect-performance-types.js';

interface PlanRow { 'QUERY PLAN'?: unknown; query_plan?: unknown }
interface PlanDefinition { id: string; sql: string; params: unknown[]; expectedIndexes: readonly string[] }
const MISSING_VALUE = '__prospect_evidence_missing__';
const EXPLAIN = 'EXPLAIN (FORMAT JSON, ANALYZE FALSE, COSTS TRUE, VERBOSE FALSE, BUFFERS FALSE)';

export async function loadProspectPlanEvidence(
  sql: EvidenceSql,
  values: ProspectEvidenceRepresentatives,
): Promise<ProspectPlanSummary[]> {
  const definitions: PlanDefinition[] = [
    plan('owner', "LOWER(COALESCE(record->'lead'->>'owner', ''))", values.owner, 'prospect_records_owner_lower_idx'),
    plan('pipeline-status', "COALESCE(record->'lead'->>'pipelineStatus', '')", values.pipelineStatus, 'prospect_records_pipeline_status_idx'),
    plan('source', "COALESCE(record->'lead'->>'source', '')", values.source, 'prospect_records_source_idx'),
    plan('service-category', "COALESCE(record->'lead'->>'serviceCategory', '')", values.serviceCategory, 'prospect_records_service_category_idx'),
    plan('lead-type', "COALESCE(record->'lead'->>'leadType', '')", values.leadType, 'prospect_records_lead_type_idx'),
    plan('opportunity-status', "COALESCE(record->'lead'->>'opportunityStatus', '')", values.opportunityStatus, 'prospect_records_opportunity_status_idx'),
    plan('prospect-stage', "COALESCE(record->'lead'->>'prospectStage', '')", values.prospectStage, 'prospect_records_prospect_stage_idx'),
    plan('tender-type', "COALESCE(record->'lead'->'tender'->>'opportunityType', '')", values.tenderType, 'prospect_records_tender_type_idx'),
    {
      id: 'rank-updated-order',
      sql: `${EXPLAIN} SELECT lead_id FROM prospect_records ORDER BY CASE WHEN COALESCE(record->'lead'->>'rank', '') ~ '^[0-9]+$' THEN (record->'lead'->>'rank')::int ELSE 999999 END ASC, COALESCE(record->'lead'->>'updatedAt', record->'lead'->>'createdAt', '') DESC LIMIT 25`,
      params: [],
      expectedIndexes: ['prospect_records_rank_updated_idx'],
    },
  ];
  const summaries: ProspectPlanSummary[] = [];
  for (const definition of definitions) {
    const rows = await sql.query(definition.sql, definition.params) as PlanRow[];
    summaries.push(summarizeProspectPlan(definition.id, rows[0]?.['QUERY PLAN'] ?? rows[0]?.query_plan, definition.expectedIndexes));
  }
  return summaries;
}

function plan(id: string, expression: string, value: string | undefined, expectedIndex: string): PlanDefinition {
  return {
    id,
    sql: `${EXPLAIN} SELECT lead_id FROM prospect_records WHERE ${expression} = $1 LIMIT 25`,
    params: [value || MISSING_VALUE],
    expectedIndexes: [expectedIndex],
  };
}

export function summarizeProspectPlan(id: string, rawPlan: unknown, expectedIndexes: readonly string[]): ProspectPlanSummary {
  const parsed = parseJsonValue(rawPlan);
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  const planRoot = asObject(root)?.Plan ?? asObject(root)?.plan ?? root;
  const nodeTypes = new Set<string>();
  const indexNames = new Set<string>();
  const relationNames = new Set<string>();
  let estimatedRows: number | undefined;
  let totalCost: number | undefined;
  const visit = (value: unknown): void => {
    const object = asObject(value);
    if (!object) return;
    addText(nodeTypes, object['Node Type'] ?? object.nodeType);
    addText(indexNames, object['Index Name'] ?? object.indexName);
    addText(relationNames, object['Relation Name'] ?? object.relationName);
    estimatedRows ??= optionalNumber(object['Plan Rows'] ?? object.planRows);
    totalCost ??= optionalNumber(object['Total Cost'] ?? object.totalCost);
    const children = object.Plans ?? object.plans;
    if (Array.isArray(children)) for (const child of children) visit(child);
  };
  visit(planRoot);
  return {
    id,
    nodeTypes: [...nodeTypes],
    indexNames: [...indexNames],
    relationNames: [...relationNames],
    estimatedRows,
    totalCost,
    usesExpectedIndex: expectedIndexes.some((name) => indexNames.has(name)),
  };
}

function addText(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) target.add(value.trim());
}
function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
}
function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function optionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
