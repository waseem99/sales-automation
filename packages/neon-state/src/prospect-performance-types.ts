export interface ProspectPlanSummary {
  id: string;
  nodeTypes: string[];
  indexNames: string[];
  relationNames: string[];
  estimatedRows?: number;
  totalCost?: number;
  usesExpectedIndex: boolean;
}

export interface ProspectPerformanceEvidence {
  generatedAt: string;
  migration: { version: string; applied: boolean; appliedAt?: string; notes?: string };
  table: { estimatedRows: number };
  indexes: {
    expected: string[];
    installed: Array<{ name: string; scanCount: number }>;
    missing: string[];
    allExpectedInstalled: boolean;
  };
  planner: ProspectPlanSummary[];
  equivalence: {
    checked: boolean;
    visibleTotalMatches: boolean;
    stableCountMatches: boolean;
    followUpsDueMatches: boolean;
    firstPageOrderMatches: boolean;
    comparedRecordCount: number;
    pageSize: number;
    reason?: string;
  };
  metrics: {
    queryCount: number;
    schemaQueryCount: number;
    evidenceQueryCount: number;
    schemaCacheState: 'cold' | 'warm';
    indexMigrationCacheState: 'cold' | 'warm';
  };
  safeguards: {
    analyzeExecuted: false;
    leadRowsReturned: false;
    sensitiveDataIncluded: false;
    comparisonRecordLimit: 10_000;
  };
  warnings: string[];
}

export interface ProspectEvidenceMetadata {
  appliedAt?: string;
  notes?: string;
  estimatedRows: number;
  installedIndexes: Array<{ name: string; scanCount: number }>;
}

export interface ProspectEvidenceRepresentatives {
  owner?: string;
  pipelineStatus?: string;
  source?: string;
  serviceCategory?: string;
  leadType?: string;
  opportunityStatus?: string;
  prospectStage?: string;
  tenderType?: string;
}
