import type { Lead, OpportunitySignalStatus, PortfolioItem } from '@sales-automation/shared';
import type { LeadRepository } from '@sales-automation/storage';

export type ProspectFetch = typeof fetch;

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
}

export interface ProspectSourceResult {
  sourceName: string;
  checked: number;
  candidates: DiscoveryCandidate[];
  error?: string;
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
  lookbackHours?: number;
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
  remoteOkEnabled?: boolean;
  bingRssEnabled?: boolean;
  greenhouseBoards?: string[];
  leverSites?: string[];
  rssFeeds?: string[];
  digest?: ProspectDigestOptions;
  runStore?: ProspectDiscoveryRunStore;
}

export interface ProspectDiscoveryResult {
  run: ProspectDiscoveryRun;
  newLeads: Lead[];
  sourceResults: ProspectSourceResult[];
}
