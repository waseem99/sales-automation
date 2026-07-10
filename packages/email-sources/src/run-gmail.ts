import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createSlackWebhookAlertAdapter,
  deliverAlertAsync,
  type AlertDeliveryRecord,
  type AlertPlan,
  type SlackWebhookFetch,
} from '@sales-automation/alerts';
import type { PortfolioItem } from '@sales-automation/shared';
import { LocalJsonLeadRepository, type StoredLeadRecord } from '@sales-automation/storage';
import {
  buildGmailReadOnlyQuery,
  GmailApiEmailSourceAdapter,
  ingestEmailSource,
} from './index.js';

export interface GmailRunnerEnvironment {
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
  SLACK_WEBHOOK_URL?: string;
  SLACK_ALERT_QUALIFIED?: string;
  SLACK_ALERT_MAX_ATTEMPTS?: string;
  SLACK_ALERT_RETRY_DELAY_MS?: string;
  APP_BASE_URL?: string;
}

export interface GmailRunnerDependencies {
  slackFetch?: SlackWebhookFetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
}

export interface QualifiedLeadAlertSummary {
  configured: boolean;
  eligible: boolean;
  attempted: boolean;
  sent: boolean;
  duplicateSuppressed: boolean;
  dedupeKey?: string;
  skippedReason?: string;
  records: AlertDeliveryRecord[];
}

export interface QualifiedLeadSummary {
  leadId: string;
  title: string;
  source: string;
  sourceUrl?: string;
  capturedAt: string;
  serviceCategory: string;
  budgetSignal?: string;
  score: number;
  qualificationStatus: string;
  urgency: string;
  scoreExplanation: string;
  redFlags: unknown[];
  recommendedProfile: string;
  matchedProof: Array<{
    projectName: string;
    score: number;
    pitchAngle?: string;
  }>;
  nextAction: string;
  draft?: string;
  alertEligible: boolean;
  alertDelivery: QualifiedLeadAlertSummary;
}

export interface GmailLeadIngestionSummary {
  generatedAt: string;
  mode: 'read_only_gmail_ingestion';
  query: ReturnType<typeof buildGmailReadOnlyQuery>;
  leadStoreFile: string;
  portfolioFile: string | null;
  portfolioItemsLoaded: number;
  totalMessages: number;
  processedMessages: number;
  skippedMessages: number;
  capturedLeads: number;
  duplicateLeads: number;
  qualifiedLeadCount: number;
  alertedLeadCount: number;
  alertFailureCount: number;
  qualifiedLeads: QualifiedLeadSummary[];
  safetyNotes: string[];
  warnings: string[];
}

export async function runGmailLeadIngestion(
  environment: GmailRunnerEnvironment = process.env,
  dependencies: GmailRunnerDependencies = {},
): Promise<GmailLeadIngestionSummary> {
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
  const generatedAt = dependencies.now?.() ?? new Date().toISOString();
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
  const qualifiedRecords = [...capturedLeadIds]
    .map((leadId) => repository.getLead(leadId))
    .filter((record): record is StoredLeadRecord => Boolean(record?.latestEvaluation))
    .filter((record) => ['hot', 'qualified'].includes(record.latestEvaluation!.score.status))
    .sort((left, right) => right.latestEvaluation!.score.total - left.latestEvaluation!.score.total);

  const slackWebhookUrl = environment.SLACK_WEBHOOK_URL?.trim();
  const includeQualifiedAlerts = parseBooleanWithDefault(environment.SLACK_ALERT_QUALIFIED, true);
  const slackAdapter = slackWebhookUrl
    ? createSlackWebhookAlertAdapter({
      webhookUrl: slackWebhookUrl,
      dashboardBaseUrl: environment.APP_BASE_URL?.trim() || undefined,
      fetchImpl: dependencies.slackFetch,
      maxAttempts: parsePositiveInteger(environment.SLACK_ALERT_MAX_ATTEMPTS, 3),
      retryDelayMs: parseNonNegativeInteger(environment.SLACK_ALERT_RETRY_DELAY_MS, 1_000),
      sleep: dependencies.sleep,
      now: dependencies.now,
    })
    : undefined;

  const qualifiedLeads: QualifiedLeadSummary[] = [];
  for (const record of qualifiedRecords) {
    const evaluation = record.latestEvaluation!;
    const deliverablePlan = buildSlackDeliverablePlan(
      evaluation.alertPlan,
      evaluation.score.status,
      includeQualifiedAlerts,
    );
    const alertDelivery = await deliverQualifiedLeadAlert({
      record,
      plan: deliverablePlan,
      slackAdapter,
      repository,
    });

    qualifiedLeads.push({
      leadId: record.lead.id,
      title: record.lead.title,
      source: record.lead.source,
      sourceUrl: record.lead.sourceUrl,
      capturedAt: record.lead.capturedAt,
      serviceCategory: record.lead.serviceCategory,
      budgetSignal: record.lead.budgetSignal,
      score: evaluation.score.total,
      qualificationStatus: evaluation.score.status,
      urgency: evaluation.score.urgency,
      scoreExplanation: evaluation.score.explanation,
      redFlags: evaluation.score.redFlags,
      recommendedProfile: evaluation.profileRecommendation.primaryProfile,
      matchedProof: evaluation.portfolioMatches.map((match) => ({
        projectName: match.portfolioItem.projectName,
        score: match.score,
        pitchAngle: match.portfolioItem.bestPitchAngle,
      })),
      nextAction: evaluation.recommendedNextAction,
      draft: evaluation.drafts[0]?.body,
      alertEligible: evaluation.alertPlan.shouldAlert,
      alertDelivery,
    });
  }

  const alertedLeadCount = qualifiedLeads.filter((lead) => lead.alertDelivery.sent).length;
  const alertFailureCount = qualifiedLeads.reduce(
    (total, lead) => total + lead.alertDelivery.records.filter((record) => record.status === 'failed').length,
    0,
  );
  const warnings: string[] = [];
  if (portfolioItems.length === 0) {
    warnings.push('No portfolio proof file was loaded. Leads will still be captured, but qualification and proposal proof matching will be weaker.');
  }
  if (!slackWebhookUrl) {
    warnings.push('SLACK_WEBHOOK_URL is not configured. Qualified leads are stored and printed, but no immediate Slack alert is sent.');
  }

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
    alertedLeadCount,
    alertFailureCount,
    qualifiedLeads,
    safetyNotes: [
      ...result.safetyNotes,
      'Slack notifications are internal BD alerts only and never contact prospects.',
      'A lead alert is marked sent only after successful Slack webhook delivery.',
    ],
    warnings,
  };
}

function buildSlackDeliverablePlan(
  plan: AlertPlan,
  qualificationStatus: string,
  includeQualifiedAlerts: boolean,
): AlertPlan | undefined {
  if (plan.shouldAlert) {
    return { ...plan, channels: ['slack'] };
  }
  if (qualificationStatus === 'qualified' && includeQualifiedAlerts) {
    return {
      ...plan,
      shouldAlert: true,
      priority: 'normal',
      channels: ['slack'],
      reason: 'New qualified lead captured from a monitored source.',
    };
  }
  return undefined;
}

async function deliverQualifiedLeadAlert(input: {
  record: StoredLeadRecord;
  plan?: AlertPlan;
  slackAdapter?: ReturnType<typeof createSlackWebhookAlertAdapter>;
  repository: LocalJsonLeadRepository;
}): Promise<QualifiedLeadAlertSummary> {
  if (!input.plan) {
    return {
      configured: Boolean(input.slackAdapter),
      eligible: false,
      attempted: false,
      sent: false,
      duplicateSuppressed: false,
      skippedReason: 'Lead is not eligible for immediate Slack delivery.',
      records: [],
    };
  }
  if (!input.slackAdapter) {
    return {
      configured: false,
      eligible: true,
      attempted: false,
      sent: false,
      duplicateSuppressed: false,
      dedupeKey: input.plan.dedupeKey,
      skippedReason: 'Slack webhook is not configured.',
      records: [],
    };
  }

  const result = await deliverAlertAsync({
    plan: input.plan,
    adapters: { slack: input.slackAdapter },
    previouslySentKeys: new Set(input.record.alertDedupeKeysSent),
    dryRun: false,
  });
  const sent = result.records.some((record) => record.status === 'sent');
  if (sent) {
    input.repository.markAlertSent(input.record.lead.id, input.plan.dedupeKey, 'gmail-slack-alert');
  }

  return {
    configured: true,
    eligible: true,
    attempted: result.attempted,
    sent,
    duplicateSuppressed: Boolean(result.skippedReason?.includes('dedupe')),
    dedupeKey: result.dedupeKey,
    skippedReason: result.skippedReason,
    records: result.records,
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

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer but received: ${value}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function parseBooleanWithDefault(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Expected a boolean but received: ${value}`);
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
