import type {
  Lead,
  OpportunitySignalStatus,
  PortfolioItem,
  TenderDocumentIntelligence,
  TenderOpportunityType,
  TenderSector,
  TenderTriState,
} from '@sales-automation/shared';
import type { LeadRepository } from '@sales-automation/storage';

export type ProspectFetch = typeof fetch;

export interface TenderCandidateMetadata {
  portal: string;
  reference?: string;
  sector: TenderSector;
  opportunityType: TenderOpportunityType;
  publishedAt?: string;
  deadline?: string;
  estimatedValue?: string;
  submissionMethod?: string;
  localPresenceRequired?: TenderTriState;
  consortiumAllowed?: TenderTriState;
  eligibilitySignals?: string[];
  riskFlags?: string[];
  documentIntelligence?: TenderDocumentIntelligence;
}

export interface DiscoveryCandidate {
  sourceName: string;
  sourceType: 'search' | 'job_board' | 'rss' | 'directory' | 'procurement';
  sourceUrl: string;
  title: string;
  summary: string;
  publishedAt?: string;
  companyName?: string;
  companyWebsite?: string;
  country?: string;
  opportunityStatus: OpportunitySignalStatus;
  tags?: string[];
  contactName?: string;
  contactRole?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactFormUrl?: string;
  linkedinUrl?: string;
  evidenceSummary?: string;
  tender?: TenderCandidateMetadata;
}

export interface ProspectSourceResult {
  sourceName: string;
  checked: number;
  candidates: DiscoveryCandidate[];
  error?: string;
}

export interface ProspectSourceRunStat {
  sourceName: string;
  checked: number;
  acceptedCandidates: number;
  error?: string;
}

export interface DiscoveryRuntimeSourceControls {
  bing_rss?: boolean;
  remoteok?: boolean;
  greenhouse?: boolean;
  lever?: boolean;
  generic_rss?: boolean;
  linkedin_signal_inbox?: boolean;
  linkedin_public_index?: boolean;
  ppra?: boolean;
  canadabuys?: boolean;
  ungm?: boolean;
  private_nonprofit_tenders?: boolean;
  expanded_public_tenders?: boolean;
}

export interface ProspectDiscoveryRun {
  id: string;
  startedAt: string;
  completedAt: string;
  sourceCount: number;
  candidateCount: number;
  enrichedCount: number;
  newLeadCount: number;
  duplicateCount: number;
  autoAssignedCount?: number;
  employmentRejectedCount?: number;
  closeabilityRescoredCount?: number;
  activeCampaignIds?: string[];
  searchQueryCount?: number;
  sourceStats?: ProspectSourceRunStat[];
  lookbackHours?: number;
  tenderCandidateCount?: number;
  newTenderCount?: number;
  rejectedCandidateCount?: number;
  tenderDocumentIntelligenceCount?: number;
  tenderAmendmentCount?: number;
  tenderExistingEnrichedCount?: number;
  emailStatus: 'sent' | 'skipped' | 'failed';
  emailMessage?: string;
  errors: string[];
  newLeadIds: string[];
}

export interface ProspectDiscoveryRunStore {
  listRuns(limit?: number): ProspectDiscoveryRun[];
  saveRun(run: ProspectDiscoveryRun): void;
}

export interface ProspectDigestOptions {
  to?: string;
  from?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  subjectPrefix?: string;
}

export interface ProspectDiscoveryOptions {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  fetchImpl?: ProspectFetch;
  now?: () => string;
  maxCandidates?: number;
  maxSearchQueries?: number;
  lookbackHours?: number;
  searchQueries?: string[];
  campaignIds?: string[];
  sourceControls?: DiscoveryRuntimeSourceControls;
  remoteOkEnabled?: boolean;
  bingRssEnabled?: boolean;
  greenhouseBoards?: string[];
  leverSites?: string[];
  rssFeeds?: string[];
  tenderSourcesEnabled?: boolean;
  tenderOnly?: boolean;
  ppraEnabled?: boolean;
  canadaBuysEnabled?: boolean;
  ungmEnabled?: boolean;
  privateNonprofitTendersEnabled?: boolean;
  expandedPublicTendersEnabled?: boolean;
  tenderDocumentIntelligenceEnabled?: boolean;
  tenderDocumentMaxBytes?: number;
  digest?: ProspectDigestOptions;
  runStore?: ProspectDiscoveryRunStore;
}

export interface ProspectDiscoveryResult {
  run: ProspectDiscoveryRun;
  newLeads: Lead[];
  sourceResults: ProspectSourceResult[];
}
