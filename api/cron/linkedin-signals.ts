import nodemailer from 'nodemailer';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import {
  acquireNamedRunLock,
  loadNeonAppState,
  persistDiscoveryRuns,
  persistNeonAppState,
  releaseNamedRunLock,
  requireDatabaseUrl,
} from '@sales-automation/neon-state';
import {
  loadDiscoverySourceControls,
  sourceControlMap,
} from '@sales-automation/neon-state/source-controls';
import {
  acknowledgeLeadSignalInbox,
  loadLeadSignalInboxConfig,
  pollLeadSignalInbox,
  type LeadSignalInboxMessage,
} from '@sales-automation/outreach-email/lead-signal-inbox';
import { parseLinkedInSignal } from '@sales-automation/parsers';
import {
  collectPublicLinkedInIndexSignals,
  LINKEDIN_PUBLIC_INDEX_QUERIES,
  type LinkedInWarmSignalInput,
  type ProspectDiscoveryRun,
  type PublicLinkedInIndexCollection,
} from '@sales-automation/prospect-discovery';
import { processLinkedInWarmSignalBatch } from '../../vercel/linkedin-warm-signal-engine.js';
import { processUpworkSavedSearchBatch } from '../../vercel/upwork-saved-search-engine.js';
import { approvedStarterPortfolioItems } from '../../vercel/approved-portfolio.js';
import {
  asPortfolioItems,
  ensurePortfolioCatalogSeeded,
  loadApprovedPortfolioCatalog,
  replacePortfolioArray,
} from '@sales-automation/neon-state/portfolio-catalog';

export const maxDuration = 300;
const LOCK_NAME = 'unified-lead-signal-intake';

export default {
  async fetch(request: Request): Promise<Response> {
    let databaseUrl: string | undefined;
    let lockToken: string | undefined;
    try {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const cronSecret = requireEnvironment('CRON_SECRET');
      if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return Response.json({ error: 'Unauthorized.' }, { status: 401 });

      const { randomUUID } = await import('node:crypto');
      databaseUrl = requireDatabaseUrl(process.env.DATABASE_URL);
      lockToken = randomUUID();
      const locked = await acquireNamedRunLock(databaseUrl, LOCK_NAME, lockToken, 20);
      if (!locked) return Response.json({ ok: true, skipped: true, reason: 'Another lead-signal cycle is active.' });

      await ensurePortfolioCatalogSeeded(databaseUrl, approvedStarterPortfolioItems);
      const approvedPortfolio = await loadApprovedPortfolioCatalog(databaseUrl);
      replacePortfolioArray(samplePortfolioItems, asPortfolioItems(approvedPortfolio));

      const controls = sourceControlMap(await loadDiscoverySourceControls(databaseUrl));
      const upworkEnabled = controls.upwork_saved_search_inbox !== false;
      const linkedinInboxEnabled = controls.linkedin_signal_inbox !== false;
      const publicIndexEnabled = controls.linkedin_public_index !== false && process.env.LINKEDIN_PUBLIC_INDEX_ENABLED !== 'false';
      const startedAt = new Date().toISOString();
      const errors: string[] = [];
      const warnings: string[] = [];

      const inboxConfig = loadLeadSignalInboxConfig(process.env);
      const inbox = upworkEnabled || linkedinInboxEnabled
        ? await pollLeadSignalInbox(inboxConfig, {
          upworkEnabled,
          linkedinEnabled: linkedinInboxEnabled,
        }).catch((error) => ({
          configured: inboxConfig.configured,
          checked: 0,
          accepted: 0,
          messages: [],
          checkedBySource: {
            upwork_saved_search: 0,
            sales_navigator_email: 0,
            linkedin_notification_email: 0,
          },
          acceptedBySource: {
            upwork_saved_search: 0,
            sales_navigator_email: 0,
            linkedin_notification_email: 0,
          },
          errors: [errorMessage(error)],
        }))
        : {
          configured: inboxConfig.configured,
          checked: 0,
          accepted: 0,
          messages: [] as LeadSignalInboxMessage[],
          checkedBySource: {
            upwork_saved_search: 0,
            sales_navigator_email: 0,
            linkedin_notification_email: 0,
          },
          acceptedBySource: {
            upwork_saved_search: 0,
            sales_navigator_email: 0,
            linkedin_notification_email: 0,
          },
          errors: [] as string[],
        };
      if ((upworkEnabled || linkedinInboxEnabled) && !inbox.configured) {
        warnings.push('Unified lead-signal mailbox is not configured; email ingestion was skipped.');
      }
      errors.push(...inbox.errors.map((error) => `lead_signal_inbox: ${error}`));

      const upworkMessages = inbox.messages.filter((message) => message.source === 'upwork_saved_search');
      const linkedinMessages = inbox.messages.filter((message) => message.source !== 'upwork_saved_search');
      const linkedinSignals = linkedinMessages.map(enrichLinkedInInboxSignal);

      const publicQueries = splitQueries(process.env.LINKEDIN_PUBLIC_INDEX_QUERIES);
      const publicIndex: PublicLinkedInIndexCollection = publicIndexEnabled
        ? await collectPublicLinkedInIndexSignals(
          globalThis.fetch,
          publicQueries.length ? publicQueries : LINKEDIN_PUBLIC_INDEX_QUERIES,
          positiveInteger(process.env.LINKEDIN_PUBLIC_INDEX_MAX_QUERIES, 6, 12),
          startedAt,
        )
        : { checked: 0, inputs: [], error: undefined };
      if (publicIndex.error) errors.push(`linkedin_public_index: ${publicIndex.error}`);
      linkedinSignals.push(...publicIndex.inputs);

      const state = await loadNeonAppState(databaseUrl);
      const linkedin = await processLinkedInWarmSignalBatch({
        state,
        signals: linkedinSignals,
        actor: 'unified-lead-signal-cron',
        generatedAt: startedAt,
        enrichContacts: true,
      });
      const upwork = await processUpworkSavedSearchBatch({
        state,
        emails: upworkMessages.map((message) => ({
          messageId: message.messageId,
          subject: message.subject,
          text: message.text,
          receivedAt: message.receivedAt,
          sourceUrl: message.sourceUrl,
        })),
        actor: 'unified-lead-signal-cron',
        generatedAt: startedAt,
        enrichContacts: true,
        minimumFixedBudgetUsd: positiveNumber(process.env.UPWORK_MIN_FIXED_BUDGET_USD, 500),
        minimumHourlyRateUsd: positiveNumber(process.env.UPWORK_MIN_HOURLY_RATE_USD, 15),
        maximumAgeHours: positiveNumber(process.env.UPWORK_MAX_AGE_HOURS, 168),
      });

      const completedAt = new Date().toISOString();
      const newLeadIds = [...linkedin.ingestion.captured.map((item) => item.leadId), ...upwork.createdLeadIds];
      const priorityLeadIds = [...linkedin.priorityALeadIds, ...upwork.priorityALeadIds];
      const run: ProspectDiscoveryRun = {
        id: `lead-signals-${Date.parse(startedAt)}`,
        startedAt,
        completedAt,
        sourceCount: Number(upworkEnabled) + Number(linkedinInboxEnabled) + Number(publicIndexEnabled),
        candidateCount: linkedinSignals.length + upwork.totalParsed,
        enrichedCount: linkedin.contactEnrichment.updated + upwork.contactEnrichment.updated,
        newLeadCount: newLeadIds.length,
        duplicateCount: linkedin.ingestion.duplicates + upwork.duplicates,
        autoAssignedCount: linkedin.assigned + upwork.assigned,
        closeabilityRescoredCount: linkedin.rescored + upwork.rescored,
        rejectedCandidateCount: linkedin.ingestion.rejected + upwork.rejected,
        sourceStats: [
          {
            sourceName: 'upwork_saved_search_inbox',
            checked: inbox.checkedBySource.upwork_saved_search,
            acceptedCandidates: upwork.totalParsed,
          },
          {
            sourceName: 'linkedin_signal_inbox',
            checked: inbox.checkedBySource.sales_navigator_email + inbox.checkedBySource.linkedin_notification_email,
            acceptedCandidates: linkedinMessages.length,
          },
          {
            sourceName: 'linkedin_public_index',
            checked: publicIndex.checked,
            acceptedCandidates: publicIndex.inputs.length,
            error: publicIndex.error,
          },
        ],
        emailStatus: 'skipped',
        emailMessage: 'Priority A internal alert pending after persistence.',
        errors,
        newLeadIds,
      };
      state.runStore.saveRun(run);
      await persistNeonAppState(databaseUrl, state);

      const acknowledged = await acknowledgeLeadSignalInbox(
        inboxConfig,
        inbox.messages.map((message) => message.uid),
      ).catch((error) => {
        warnings.push(`Lead-signal messages were persisted but could not be marked read: ${errorMessage(error)}`);
        return 0;
      });

      const alert = await sendPriorityAlert(priorityLeadIds, state, startedAt)
        .catch((error) => ({ status: 'failed' as const, message: errorMessage(error) }));
      run.emailStatus = alert.status;
      run.emailMessage = alert.message;
      state.runStore.saveRun(run);
      await persistDiscoveryRuns(databaseUrl, state.runStore.listRuns(180));

      return Response.json({
        ok: true,
        run,
        warnings,
        inbox: {
          configured: inbox.configured,
          mailbox: inboxConfig.mailboxEmail,
          host: inboxConfig.host,
          checked: inbox.checked,
          accepted: inbox.accepted,
          checkedBySource: inbox.checkedBySource,
          acceptedBySource: inbox.acceptedBySource,
          acknowledgedAfterPersistence: acknowledged,
        },
        upwork,
        linkedin,
        publicIndex: {
          enabled: publicIndexEnabled,
          checked: publicIndex.checked,
          accepted: publicIndex.inputs.length,
          humanVerificationRequired: true,
        },
        safeguards: {
          authenticatedLinkedInScraping: false,
          automatedLinkedInMessaging: false,
          automatedUpworkApplication: false,
          outreachReplyMailboxFallback: false,
          sourceIsolatedImapSearches: true,
          acknowledgeOnlyAfterPersistence: true,
          approvedForwardersOnly: true,
          publicIndexContactReadyWithoutVerification: false,
        },
      });
    } catch (error) {
      console.error('UNIFIED_LEAD_SIGNAL_CRON_ERROR', error);
      return Response.json({ error: 'Unified lead-signal cycle failed.', detail: errorMessage(error) }, { status: 500 });
    } finally {
      if (databaseUrl && lockToken) {
        await releaseNamedRunLock(databaseUrl, LOCK_NAME, lockToken).catch((error) => console.error('UNIFIED_LEAD_SIGNAL_LOCK_RELEASE_ERROR', error));
      }
    }
  },
};

function enrichLinkedInInboxSignal(message: LeadSignalInboxMessage): LinkedInWarmSignalInput {
  const parsed = parseLinkedInSignal({
    text: `${message.subject ?? ''}\n${message.text}`,
    capturedAt: message.receivedAt,
    sourceUrl: message.sourceUrl,
  });
  return {
    origin: message.source === 'sales_navigator_email' ? 'sales_navigator_email' : 'linkedin_notification_email',
    text: message.text,
    receivedAt: message.receivedAt,
    subject: message.subject,
    messageId: message.messageId,
    sourceUrl: message.sourceUrl,
    authorName: parsed.contactName,
    authorRole: parsed.contactRole,
    companyName: parsed.companyName,
    country: parsed.country,
    region: parsed.region,
  };
}

async function sendPriorityAlert(leadIds: string[], state: Awaited<ReturnType<typeof loadNeonAppState>>, generatedAt: string): Promise<{ status: 'sent' | 'skipped' | 'failed'; message?: string }> {
  if (!leadIds.length) return { status: 'skipped', message: 'No new Priority A lead signals.' };
  if (process.env.LEAD_SIGNAL_ALERTS_ENABLED === 'false' || process.env.LINKEDIN_SIGNAL_ALERTS_ENABLED === 'false') {
    return { status: 'skipped', message: 'Priority A internal lead-signal alerts are disabled.' };
  }
  const host = process.env.OUTREACH_SMTP_HOST?.trim() || process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim() || process.env.PROSPECT_DIGEST_FROM?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  if (!host || !user || !password) return { status: 'skipped', message: 'SMTP configuration is incomplete; Priority A records remain in /priorities.' };
  const recipients = splitEmails(process.env.LEAD_SIGNAL_ALERT_TO ?? process.env.LINKEDIN_SIGNAL_ALERT_TO ?? 'waseem@codistan.org,sales@codistan.org');
  if (!recipients.length) return { status: 'skipped', message: 'No internal lead-signal alert recipients are configured.' };
  const records = leadIds.map((leadId) => state.repository.getLead(leadId)).filter((record): record is NonNullable<typeof record> => Boolean(record));
  const transporter = nodemailer.createTransport({
    host,
    port: positiveInteger(process.env.OUTREACH_SMTP_PORT ?? process.env.SMTP_PORT, 465, 65535),
    secure: (process.env.OUTREACH_SMTP_SECURE ?? process.env.SMTP_SECURE) !== 'false',
    auth: { user, pass: password },
    tls: { minVersion: 'TLSv1.2' },
  });
  await transporter.verify();
  await transporter.sendMail({
    from: user,
    to: recipients,
    subject: `[Priority A lead signals] ${records.length} new warm lead${records.length === 1 ? '' : 's'}`,
    text: [
      `Generated: ${generatedAt}`,
      '',
      ...records.flatMap((record, index) => [
        `${index + 1}. ${record.lead.companyName ?? record.lead.title}`,
        `Source: ${record.lead.discoverySource ?? record.lead.source}`,
        `Owner: ${record.lead.owner ?? 'Unassigned'}`,
        `Service: ${record.lead.serviceCategory.replace(/_/g, ' ')}`,
        `Evidence: ${record.lead.sourceUrl ?? record.lead.evidenceSummary ?? 'Open the Prospect Desk record'}`,
        `Action: ${record.lead.recommendedNextAction ?? 'Review immediately in /priorities'}`,
        '',
      ]),
      'Open the Priority queue: /priorities',
      'No LinkedIn message, connection request, Upwork proposal or application was sent automatically.',
    ].join('\n'),
  });
  return { status: 'sent', message: `Sent an internal alert for ${records.length} Priority A lead signal(s).` };
}

function splitQueries(value: string | undefined): string[] { return value?.split(/\n+|\s*\|\|\s*/).map((item) => item.trim()).filter(Boolean) ?? []; }
function splitEmails(value: string): string[] { return [...new Set(value.split(/[;,\n]+/).map((item) => item.trim().toLowerCase()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))]; }
function positiveInteger(value: string | undefined, fallback: number, maximum: number): number { const parsed=Number.parseInt(value??'',10); return Number.isInteger(parsed)&&parsed>0?Math.min(parsed,maximum):fallback; }
function positiveNumber(value: string | undefined, fallback: number): number { const parsed=Number(value); return Number.isFinite(parsed)&&parsed>0?parsed:fallback; }
function requireEnvironment(name: string): string { const value=process.env[name]; if(!value?.trim()) throw new Error(`${name} is required.`); return value.trim(); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
