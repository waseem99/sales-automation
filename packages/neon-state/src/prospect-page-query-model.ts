import type { StoredLeadRecord } from '@sales-automation/storage';
import type {
  ProspectDashboardSummary,
  ProspectWorkspaceScope,
} from './prospect-query-legacy.js';

export interface AggregatePageRow {
  total: number | string;
  live: number | string;
  contacted: number | string;
  replied: number | string;
  follow_ups_due: number | string;
  unassigned: number | string;
  won: number | string;
  feedback_pending: number | string;
  filtered_total: number | string;
  total_pages: number | string;
  page: number | string;
  owners: unknown;
  records: unknown;
}

export function bindNamedQuery(sqlText: string, values: Record<string, unknown>): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const indexes = new Map<string, number>();
  const text = sqlText.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) throw new Error(`Missing SQL parameter: ${name}`);
    let index = indexes.get(name);
    if (!index) {
      params.push(values[name]);
      index = params.length;
      indexes.set(name, index);
    }
    return `$${index}`;
  });
  if (/\{\{/.test(text)) throw new Error('Unresolved SQL parameter marker.');
  return { text, params };
}

export function workspaceSqlParameters(scope: ProspectWorkspaceScope) {
  const normalized = normalizeWorkspaceScope(scope);
  return {
    all: !workspaceScopeHasCriteria(normalized),
    sourcesJson: JSON.stringify(normalized.sources),
    leadTypesJson: JSON.stringify(normalized.leadTypes),
    tenderTypesJson: JSON.stringify(normalized.tenderOpportunityTypes),
    prospectStagesJson: JSON.stringify(normalized.prospectStages),
    opportunityStatusesJson: JSON.stringify(normalized.opportunityStatuses),
    serviceCategoriesJson: JSON.stringify(normalized.serviceCategories),
    pipelineStatusesJson: JSON.stringify(normalized.pipelineStatuses),
    hasTender: normalized.hasTender,
    requireKnownService: normalized.requireKnownService,
  };
}

function normalizeWorkspaceScope(scope: ProspectWorkspaceScope) {
  return {
    sources: normalizeTokens(scope.sources ?? []),
    leadTypes: normalizeTokens(scope.leadTypes ?? []),
    tenderOpportunityTypes: normalizeTokens(scope.tenderOpportunityTypes ?? []),
    prospectStages: normalizeTokens(scope.prospectStages ?? []),
    opportunityStatuses: normalizeTokens(scope.opportunityStatuses ?? []),
    serviceCategories: normalizeTokens(scope.serviceCategories ?? []),
    pipelineStatuses: normalizeTokens(scope.pipelineStatuses ?? []),
    hasTender: scope.hasTender === true,
    requireKnownService: scope.requireKnownService === true,
  };
}

function workspaceScopeHasCriteria(scope: ReturnType<typeof normalizeWorkspaceScope>): boolean {
  return scope.sources.length > 0
    || scope.leadTypes.length > 0
    || scope.tenderOpportunityTypes.length > 0
    || scope.prospectStages.length > 0
    || scope.opportunityStatuses.length > 0
    || scope.serviceCategories.length > 0
    || scope.pipelineStatuses.length > 0
    || scope.hasTender
    || scope.requireKnownService;
}

export function summaryFromAggregateRow(row: AggregatePageRow | undefined): ProspectDashboardSummary {
  return {
    total: numberValue(row?.total),
    live: numberValue(row?.live),
    contacted: numberValue(row?.contacted),
    replied: numberValue(row?.replied),
    followUpsDue: numberValue(row?.follow_ups_due),
    unassigned: numberValue(row?.unassigned),
    won: numberValue(row?.won),
    feedbackPending: numberValue(row?.feedback_pending),
  };
}

export function normalizeTokens(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => token.trim().toLowerCase()).filter(Boolean))];
}

export function numberValue(value: number | string | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function parseJson<T>(value: unknown): T | undefined {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string') return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

export function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const parsed = parseJson<unknown>(value);
  return Array.isArray(parsed) ? parsed as T[] : [];
}

export function isStoredRecord(value: StoredLeadRecord | undefined): value is StoredLeadRecord {
  return Boolean(value?.lead?.id);
}
