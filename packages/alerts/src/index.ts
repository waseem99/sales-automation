import type { GeneratedDraft } from '@sales-automation/drafting';
import type { PortfolioMatch } from '@sales-automation/portfolio-matching';
import type { ProfileRecommendation } from '@sales-automation/routing';
import type { Lead, LeadScore } from '@sales-automation/shared';

export type AlertChannel = 'email' | 'dashboard' | 'slack' | 'whatsapp' | 'log';
export type AlertPriority = 'urgent' | 'normal' | 'low';
export type AlertDeliveryStatus = 'sent' | 'skipped' | 'failed' | 'dry_run';

export interface AlertPlan {
  id: string;
  shouldAlert: boolean;
  priority: AlertPriority;
  channels: AlertChannel[];
  dedupeKey: string;
  title: string;
  body: string;
  payload: {
    leadId: string;
    source: Lead['source'];
    sourceUrl?: string;
    leadType: Lead['leadType'];
    score: number;
    urgency: LeadScore['urgency'];
    status: LeadScore['status'];
    recommendedProfile: string;
    portfolioItemIds: string[];
    redFlags: string[];
    nextAction: string;
    draftIds: string[];
  };
  reason: string;
}

export interface BuildAlertPlanInput {
  lead: Lead;
  score: LeadScore;
  profileRecommendation: ProfileRecommendation;
  portfolioMatches: PortfolioMatch[];
  drafts: GeneratedDraft[];
  recommendedNextAction: string;
  configuredChannels?: AlertChannel[];
}

export interface AlertDeliveryRecord {
  channel: AlertChannel;
  status: AlertDeliveryStatus;
  dedupeKey: string;
  message: string;
  deliveredAt: string;
  providerMessageId?: string;
  error?: string;
}

export interface AlertDeliveryAdapter {
  channel: AlertChannel;
  send(plan: AlertPlan): AlertDeliveryRecord;
}

export interface AsyncAlertDeliveryAdapter {
  channel: AlertChannel;
  send(plan: AlertPlan): AlertDeliveryRecord | Promise<AlertDeliveryRecord>;
}

export interface DeliverAlertInput {
  plan: AlertPlan;
  adapters?: Partial<Record<AlertChannel, AlertDeliveryAdapter>>;
  previouslySentKeys?: ReadonlySet<string>;
  dryRun?: boolean;
  deliveredAt?: string;
}

export interface DeliverAlertAsyncInput {
  plan: AlertPlan;
  adapters?: Partial<Record<AlertChannel, AsyncAlertDeliveryAdapter>>;
  previouslySentKeys?: ReadonlySet<string>;
  dryRun?: boolean;
  deliveredAt?: string;
}

export interface DeliverAlertResult {
  attempted: boolean;
  dedupeKey: string;
  records: AlertDeliveryRecord[];
  skippedReason?: string;
}

export interface SlackWebhookFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers?: {
    get(name: string): string | null;
  };
}

export type SlackWebhookFetch = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  },
) => Promise<SlackWebhookFetchResponse>;

export interface SlackWebhookAlertAdapterOptions {
  webhookUrl: string;
  dashboardBaseUrl?: string;
  fetchImpl?: SlackWebhookFetch;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
}

export interface SlackWebhookPayload {
  text: string;
  blocks: Array<
    | { type: 'header'; text: { type: 'plain_text'; text: string } }
    | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
    | { type: 'actions'; elements: Array<{ type: 'button'; text: { type: 'plain_text'; text: string }; url: string }> }
  >;
}

export function buildAlertPlan(input: BuildAlertPlanInput): AlertPlan {
  const shouldAlert = shouldTriggerAlert(input);
  const priority = getPriority(input.score);
  const channels = selectChannels(shouldAlert, input.configuredChannels);
  const topPortfolio = input.portfolioMatches[0]?.portfolioItem;

  return {
    id: `${input.lead.id}-alert-${input.score.status}-${input.score.urgency}`,
    shouldAlert,
    priority,
    channels,
    dedupeKey: `${input.lead.id}:${input.score.status}:${input.score.urgency}`,
    title: `${priority.toUpperCase()} ${input.lead.source} lead: ${input.lead.title}`,
    body: [
      `Lead: ${input.lead.title}`,
      `Source: ${input.lead.source} / ${input.lead.leadType}`,
      `Score: ${input.score.total}/100 (${input.score.status}, ${input.score.urgency})`,
      `Recommended profile: ${input.profileRecommendation.primaryProfile}`,
      `Matched proof: ${topPortfolio ? topPortfolio.projectName : 'No approved proof matched yet'}`,
      `Red flags: ${input.score.redFlags.length > 0 ? input.score.redFlags.map((flag) => `${flag.code} (${flag.severity})`).join(', ') : 'None'}`,
      `Next action: ${input.recommendedNextAction}`,
      `Drafts ready: ${input.drafts.length}`,
    ].join('\n'),
    payload: {
      leadId: input.lead.id,
      source: input.lead.source,
      sourceUrl: input.lead.sourceUrl,
      leadType: input.lead.leadType,
      score: input.score.total,
      urgency: input.score.urgency,
      status: input.score.status,
      recommendedProfile: input.profileRecommendation.primaryProfile,
      portfolioItemIds: input.portfolioMatches.map((match) => match.portfolioItem.id),
      redFlags: input.score.redFlags.map((flag) => `${flag.code}:${flag.severity}`),
      nextAction: input.recommendedNextAction,
      draftIds: input.drafts.map((draft) => draft.id),
    },
    reason: shouldAlert ? getAlertReason(input) : 'Lead does not meet hot/urgent alert criteria or is rejected/nurture.',
  };
}

export function isDuplicateAlert(dedupeKey: string, previouslySentKeys: ReadonlySet<string>): boolean {
  return previouslySentKeys.has(dedupeKey);
}

export function deliverAlert(input: DeliverAlertInput): DeliverAlertResult {
  const deliveredAt = input.deliveredAt ?? new Date().toISOString();
  const skipped = getSkippedDelivery(input.plan, input.previouslySentKeys);
  if (skipped) return skipped;

  const records = input.plan.channels.map((channel) => {
    const adapter = input.adapters?.[channel] ?? createDryRunAlertAdapter(channel, deliveredAt);
    if (input.dryRun !== false) {
      return createDryRunDeliveryRecord(channel, input.plan, deliveredAt);
    }

    try {
      return adapter.send(input.plan);
    } catch (error) {
      return createFailedDeliveryRecord(channel, input.plan, deliveredAt, error);
    }
  });

  return {
    attempted: records.length > 0,
    dedupeKey: input.plan.dedupeKey,
    records,
  };
}

export async function deliverAlertAsync(input: DeliverAlertAsyncInput): Promise<DeliverAlertResult> {
  const deliveredAt = input.deliveredAt ?? new Date().toISOString();
  const skipped = getSkippedDelivery(input.plan, input.previouslySentKeys);
  if (skipped) return skipped;

  const records = await Promise.all(input.plan.channels.map(async (channel) => {
    const adapter = input.adapters?.[channel] ?? createDryRunAlertAdapter(channel, deliveredAt);
    if (input.dryRun !== false) {
      return createDryRunDeliveryRecord(channel, input.plan, deliveredAt);
    }

    try {
      return await adapter.send(input.plan);
    } catch (error) {
      return createFailedDeliveryRecord(channel, input.plan, deliveredAt, error);
    }
  }));

  return {
    attempted: records.length > 0,
    dedupeKey: input.plan.dedupeKey,
    records,
  };
}

export function createDryRunAlertAdapter(channel: AlertChannel, deliveredAt = new Date().toISOString()): AlertDeliveryAdapter {
  return {
    channel,
    send: (plan) => createDryRunDeliveryRecord(channel, plan, deliveredAt),
  };
}

export function createLogAlertAdapter(deliveredAt = new Date().toISOString()): AlertDeliveryAdapter {
  return {
    channel: 'log',
    send: (plan) => ({
      channel: 'log',
      status: 'sent',
      dedupeKey: plan.dedupeKey,
      message: `[${plan.priority}] ${plan.title}\n${plan.body}`,
      deliveredAt,
      providerMessageId: `log:${plan.dedupeKey}`,
    }),
  };
}

export function createDashboardAlertAdapter(deliveredAt = new Date().toISOString()): AlertDeliveryAdapter {
  return {
    channel: 'dashboard',
    send: (plan) => ({
      channel: 'dashboard',
      status: 'sent',
      dedupeKey: plan.dedupeKey,
      message: plan.title,
      deliveredAt,
      providerMessageId: `dashboard:${plan.dedupeKey}`,
    }),
  };
}

export function createExternalChannelPlaceholderAdapter(channel: Exclude<AlertChannel, 'log' | 'dashboard'>): AlertDeliveryAdapter {
  return {
    channel,
    send: (plan) => ({
      channel,
      status: 'skipped',
      dedupeKey: plan.dedupeKey,
      message: `${channel} delivery adapter is not configured. No external alert was sent.`,
      deliveredAt: new Date().toISOString(),
    }),
  };
}

export function createSlackWebhookAlertAdapter(options: SlackWebhookAlertAdapterOptions): AsyncAlertDeliveryAdapter {
  const webhookUrl = validateSlackWebhookUrl(options.webhookUrl);
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as SlackWebhookFetch | undefined);
  if (!fetchImpl) {
    throw new Error('Global fetch is unavailable. Supply fetchImpl to createSlackWebhookAlertAdapter.');
  }

  const maxAttempts = normalizePositiveInteger(options.maxAttempts, 3, 'maxAttempts');
  const retryDelayMs = normalizeNonNegativeInteger(options.retryDelayMs, 1_000, 'retryDelayMs');
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? (() => new Date().toISOString());

  return {
    channel: 'slack',
    async send(plan) {
      const payload = formatSlackWebhookPayload(plan, options.dashboardBaseUrl);
      let lastError = 'Slack webhook delivery failed.';

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await fetchImpl(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
        });
        const responseText = await response.text();

        if (response.ok) {
          return {
            channel: 'slack',
            status: 'sent',
            dedupeKey: plan.dedupeKey,
            message: 'Slack alert sent.',
            deliveredAt: now(),
            providerMessageId: `slack:${plan.dedupeKey}`,
          };
        }

        lastError = `Slack webhook returned HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 300)}` : ''}`;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === maxAttempts) break;

        const retryAfterSeconds = Number.parseInt(response.headers?.get('retry-after') ?? '', 10);
        const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1_000
          : retryDelayMs * attempt;
        await sleep(delay);
      }

      throw new Error(lastError);
    },
  };
}

export function formatSlackWebhookPayload(plan: AlertPlan, dashboardBaseUrl?: string): SlackWebhookPayload {
  const sourceUrl = safeHttpUrl(plan.payload.sourceUrl);
  const dashboardUrl = dashboardBaseUrl
    ? safeHttpUrl(`${dashboardBaseUrl.replace(/\/$/, '')}/?leadId=${encodeURIComponent(plan.payload.leadId)}`)
    : undefined;
  const headline = `${priorityIcon(plan.priority)} ${truncate(plan.title, 140)}`;
  const details = [
    `*Score:* ${plan.payload.score}/100 · ${escapeSlack(plan.payload.status)} · ${escapeSlack(plan.payload.urgency)}`,
    `*Source:* ${escapeSlack(plan.payload.source)} / ${escapeSlack(plan.payload.leadType)}`,
    `*Profile:* ${escapeSlack(plan.payload.recommendedProfile)}`,
    `*Proof matches:* ${plan.payload.portfolioItemIds.length}`,
    `*Red flags:* ${plan.payload.redFlags.length > 0 ? plan.payload.redFlags.map(escapeSlack).join(', ') : 'None'}`,
    `*Next:* ${escapeSlack(truncate(plan.payload.nextAction, 700))}`,
  ].join('\n');

  const blocks: SlackWebhookPayload['blocks'] = [
    { type: 'header', text: { type: 'plain_text', text: headline } },
    { type: 'section', text: { type: 'mrkdwn', text: details } },
  ];
  const actionElements: Array<{ type: 'button'; text: { type: 'plain_text'; text: string }; url: string }> = [];
  if (sourceUrl) actionElements.push({ type: 'button', text: { type: 'plain_text', text: 'Open source' }, url: sourceUrl });
  if (dashboardUrl) actionElements.push({ type: 'button', text: { type: 'plain_text', text: 'Open Lead Desk' }, url: dashboardUrl });
  if (actionElements.length > 0) blocks.push({ type: 'actions', elements: actionElements });

  return {
    text: `${plan.title} — score ${plan.payload.score}/100. ${plan.payload.nextAction}`,
    blocks,
  };
}

function getSkippedDelivery(plan: AlertPlan, previouslySentKeys?: ReadonlySet<string>): DeliverAlertResult | undefined {
  if (!plan.shouldAlert) {
    return {
      attempted: false,
      dedupeKey: plan.dedupeKey,
      records: [],
      skippedReason: 'Alert plan is not eligible for delivery.',
    };
  }

  if (previouslySentKeys && isDuplicateAlert(plan.dedupeKey, previouslySentKeys)) {
    return {
      attempted: false,
      dedupeKey: plan.dedupeKey,
      records: [],
      skippedReason: 'Alert was skipped because the dedupe key was already sent.',
    };
  }

  return undefined;
}

function createFailedDeliveryRecord(
  channel: AlertChannel,
  plan: AlertPlan,
  deliveredAt: string,
  error: unknown,
): AlertDeliveryRecord {
  return {
    channel,
    status: 'failed',
    dedupeKey: plan.dedupeKey,
    message: 'Alert delivery failed.',
    deliveredAt,
    error: error instanceof Error ? error.message : String(error),
  };
}

function createDryRunDeliveryRecord(channel: AlertChannel, plan: AlertPlan, deliveredAt: string): AlertDeliveryRecord {
  return {
    channel,
    status: 'dry_run',
    dedupeKey: plan.dedupeKey,
    message: `Dry run only. No ${channel} alert was sent.`,
    deliveredAt,
  };
}

function shouldTriggerAlert(input: BuildAlertPlanInput): boolean {
  if (input.score.status === 'rejected' || input.score.status === 'nurture') return false;
  if (input.score.urgency === 'urgent') return true;

  if (input.lead.leadType === 'partner_prospect' && input.score.total >= 90) return true;
  if (input.lead.leadType === 'solution_led_prospect' && input.score.total >= 85) return true;

  return false;
}

function getPriority(score: LeadScore): AlertPriority {
  if (score.status === 'rejected' || score.status === 'nurture') return 'low';
  if (score.urgency === 'urgent') return 'urgent';
  return 'normal';
}

function selectChannels(shouldAlert: boolean, configuredChannels?: AlertChannel[]): AlertChannel[] {
  if (!shouldAlert) return [];
  if (configuredChannels && configuredChannels.length > 0) return configuredChannels;
  return ['log', 'dashboard'];
}

function getAlertReason(input: BuildAlertPlanInput): string {
  if (input.score.urgency === 'urgent') {
    return `Lead has ${input.score.urgency} urgency with score ${input.score.total}.`;
  }

  if (input.lead.leadType === 'partner_prospect' && input.score.total >= 90) {
    return 'Partner prospect crossed the exceptional priority threshold.';
  }

  if (input.lead.leadType === 'solution_led_prospect' && input.score.total >= 85) {
    return 'Solution-led prospect crossed the strong buyer-fit threshold.';
  }

  return 'Lead meets configured alert criteria.';
}

function validateSlackWebhookUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('Slack webhook URL is required.');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Slack webhook URL is invalid.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Slack webhook URL must use HTTPS.');
  }
  return parsed.toString();
}

function safeHttpUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function priorityIcon(priority: AlertPriority): string {
  if (priority === 'urgent') return '🚨';
  if (priority === 'normal') return '🎯';
  return 'ℹ️';
}

function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
