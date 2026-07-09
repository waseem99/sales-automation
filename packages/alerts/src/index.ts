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

export interface DeliverAlertInput {
  plan: AlertPlan;
  adapters?: Partial<Record<AlertChannel, AlertDeliveryAdapter>>;
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

  if (!input.plan.shouldAlert) {
    return {
      attempted: false,
      dedupeKey: input.plan.dedupeKey,
      records: [],
      skippedReason: 'Alert plan is not eligible for delivery.',
    };
  }

  if (input.previouslySentKeys && isDuplicateAlert(input.plan.dedupeKey, input.previouslySentKeys)) {
    return {
      attempted: false,
      dedupeKey: input.plan.dedupeKey,
      records: [],
      skippedReason: 'Alert was skipped because the dedupe key was already sent.',
    };
  }

  const records = input.plan.channels.map((channel) => {
    const adapter = input.adapters?.[channel] ?? createDryRunAlertAdapter(channel, deliveredAt);
    if (input.dryRun !== false) {
      return createDryRunDeliveryRecord(channel, input.plan, deliveredAt);
    }

    try {
      return adapter.send(input.plan);
    } catch (error) {
      return {
        channel,
        status: 'failed',
        dedupeKey: input.plan.dedupeKey,
        message: 'Alert delivery failed.',
        deliveredAt,
        error: (error as Error).message,
      } satisfies AlertDeliveryRecord;
    }
  });

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
