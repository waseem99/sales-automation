import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PortfolioItem } from '@sales-automation/shared';
import { LocalJsonLeadRepository } from '@sales-automation/storage';
import {
  buildGmailReadOnlyQuery,
  GmailApiEmailSourceAdapter,
  ingestEmailSource,
} from './index.js';

interface GmailRunnerEnvironment {
  GMAIL_ACCESS_TOKEN?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_USER_ID?: string;
  GMAIL_QUERY?: string;
  GMAIL_LABEL?: string;
  GMAIL_NEWER_THAN_DAYS?: string;
  GMAIL_MAX_RESULTS?: string;
  LEAD_STORE_FILE?: string;
  PORTFOLIO_FILE?: string;
  INCLUDE_PRIVATE_PORTFOLIO?: string;
}

export async function runGmailLeadIngestion(
  environment: GmailRunnerEnvironment = process.env,
): Promise<unknown> {
  const leadStoreFile = resolve(environment.LEAD_STORE_FILE?.trim() || '.data/leads.json');
  const portfolioFile = environment.PORTFOLIO_FILE?.trim()
    ? resolve(environment.PORTFOLIO_FILE.trim())
    : undefined;
  const portfolioItems = loadPortfolioItems(portfolioFile);
  const repository = new LocalJsonLeadRepository({ filePath: leadStoreFile });
  const adapter = new GmailApiEmailSourceAdapter({
    credentials: {
      accessToken: environment.GMAIL_ACCESS_TOKEN,
      clientId: environment.GMAIL_CLIENT_ID,
      clientSecret: environment.GMAIL_CLIENT_SECRET,
      refreshToken: environment.GMAIL_REFRESH_TOKEN,
    },
    userId: environment.GMAIL_USER_ID,
  });

  const query = buildGmailReadOnlyQuery({
    terms: [environment.GMAIL_QUERY?.trim() || defaultUpworkGmailQuery()],
    label: environment.GMAIL_LABEL?.trim() || undefined,
    newerThanDays: parsePositiveInteger(environment.GMAIL_NEWER_THAN_DAYS, 2),
    maxResults: parsePositiveInteger(environment.GMAIL_MAX_RESULTS, 50),
  });
  const generatedAt = new Date().toISOString();
  const result = await ingestEmailSource({
    adapter,
    query,
    repository,
    portfolioItems,
    actor: 'gmail-upwork-runner',
    generatedAt,
    includePrivatePortfolio: parseBoolean(environment.INCLUDE_PRIVATE_PORTFOLIO),
  });

  const capturedLeadIds = new Set(
    result.results.flatMap((item) => item.ingestion?.captured.map((captured) => captured.leadId) ?? []),
  );
  const qualifiedLeads = [...capturedLeadIds]
    .map((leadId) => repository.getLead(leadId))
    .filter((record) => record?.latestEvaluation)
    .map((record) => record!)
    .filter((record) => ['hot', 'qualified'].includes(record.latestEvaluation!.score.status))
    .sort((left, right) => right.latestEvaluation!.score.total - left.latestEvaluation!.score.total)
    .map((record) => ({
      leadId: record.lead.id,
      title: record.lead.title,
      source: record.lead.source,
      sourceUrl: record.lead.sourceUrl,
      capturedAt: record.lead.capturedAt,
      serviceCategory: record.lead.serviceCategory,
      budgetSignal: record.lead.budgetSignal,
      score: record.latestEvaluation!.score.total,
      qualificationStatus: record.latestEvaluation!.score.status,
      urgency: record.latestEvaluation!.score.urgency,
      scoreExplanation: record.latestEvaluation!.score.explanation,
      redFlags: record.latestEvaluation!.score.redFlags,
      recommendedProfile: record.latestEvaluation!.profileRecommendation.primaryProfile,
      matchedProof: record.latestEvaluation!.portfolioMatches.map((match) => ({
        projectName: match.portfolioItem.projectName,
        score: match.score,
        pitchAngle: match.portfolioItem.bestPitchAngle,
      })),
      nextAction: record.latestEvaluation!.recommendedNextAction,
      draft: record.latestEvaluation!.drafts[0]?.body,
      alertEligible: record.latestEvaluation!.alertPlan.shouldAlert,
    }));

  return {
    generatedAt,
    mode: 'read_only_gmail_ingestion',
    query,
    leadStoreFile,
    portfolioFile: portfolioFile ?? null,
    portfolioItemsLoaded: portfolioItems.length,
    totalMessages: result.totalMessages,
    processedMessages: result.processedMessages,
    skippedMessages: result.skippedMessages,
    capturedLeads: result.totalCaptured,
    duplicateLeads: result.totalDuplicates,
    qualifiedLeadCount: qualifiedLeads.length,
    qualifiedLeads,
    safetyNotes: result.safetyNotes,
    warnings: portfolioItems.length === 0
      ? ['No portfolio proof file was loaded. Leads will still be captured, but qualification and proposal proof matching will be weaker.']
      : [],
  };
}

function loadPortfolioItems(filePath?: string): PortfolioItem[] {
  if (!filePath) return [];
  if (!existsSync(filePath)) {
    throw new Error(`Portfolio file not found: ${filePath}`);
  }

  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('PORTFOLIO_FILE must contain a JSON array of portfolio items.');
  }

  return parsed.map((item, index) => validatePortfolioItem(item, index));
}

function validatePortfolioItem(value: unknown, index: number): PortfolioItem {
  if (!value || typeof value !== 'object') {
    throw new Error(`Portfolio item ${index + 1} must be an object.`);
  }

  const item = value as Partial<PortfolioItem>;
  const requiredStrings: Array<keyof Pick<PortfolioItem, 'id' | 'projectName' | 'problemSolved'>> = [
    'id',
    'projectName',
    'problemSolved',
  ];
  for (const key of requiredStrings) {
    if (typeof item[key] !== 'string' || !item[key]?.trim()) {
      throw new Error(`Portfolio item ${index + 1} is missing ${key}.`);
    }
  }

  if (!['public', 'private', 'anonymized'].includes(item.confidentiality ?? '')) {
    throw new Error(`Portfolio item ${index + 1} has invalid confidentiality.`);
  }
  if (!Array.isArray(item.serviceCategories) || !Array.isArray(item.techStack) || !Array.isArray(item.assetUrls) || !Array.isArray(item.tags) || !Array.isArray(item.bestProfiles)) {
    throw new Error(`Portfolio item ${index + 1} is missing one or more required arrays.`);
  }

  return item as PortfolioItem;
}

function defaultUpworkGmailQuery(): string {
  return '(from:(upwork.com) OR subject:(Upwork)) (job OR opportunity OR alert)';
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received: ${value}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

async function main(): Promise<void> {
  try {
    const summary = await runGmailLeadIngestion(process.env);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Gmail lead ingestion failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  await main();
}
