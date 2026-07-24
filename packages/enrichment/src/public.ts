import type { Lead } from '@sales-automation/shared';
import {
  buildEvidenceBasedEnrichment as buildBaseEnrichment,
  type EnrichmentSnapshot,
} from './index.js';

export * from './index.js';

export function buildEvidenceBasedEnrichment(
  lead: Lead,
  previous?: EnrichmentSnapshot,
  generatedAt?: string,
): EnrichmentSnapshot {
  const snapshot = buildBaseEnrichment(lead, previous, generatedAt);
  if (!snapshot.suppression.suppressed) return snapshot;
  return {
    ...snapshot,
    contactRoutes: snapshot.contactRoutes.map((route) => ({
      ...route,
      status: 'suppressed' as const,
      restriction: snapshot.suppression.reason ?? route.restriction ?? 'Do-not-contact evidence is present.',
    })),
    tasks: [],
    contactability: 'suppressed',
  };
}
