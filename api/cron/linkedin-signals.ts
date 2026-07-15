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
  acknowledgeLinkedInSignalInbox,
  loadLinkedInSignalInboxConfig,
  pollLinkedInSignalInbox,
} from '@sales-automation/outreach-email/linkedin-signal-inbox';
import { parseLinkedInSignal } from '@sales-automation/parsers';
import {
  collectPublicLinkedInIndexSignals,
  LINKEDIN_PUBLIC_INDEX_QUERIES,
  type LinkedInWarmSignalInput,
  type ProspectDiscoveryRun,
  type PublicLinkedInIndexCollection,
} from '@sales-automation/prospect-discovery';
import { processLinkedInWarmSignalBatch } from '../../vercel/linkedin-warm-signal-engine.js';
import { approvedStarterPortfolioItems } from '../../vercel/approved-portfolio.js';
import {
  asPortfolioItems,
  ensurePortfolioCatalogSeeded,
  loadApprovedPortfolioCatalog,
  replacePortfolioArray,
} from '@sales-automation/neon-state/portfolio-catalog';

export const maxDuration = 300;
const LOCK_NAME = 'linkedin-warm-signal-intake';

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
      if (!locked) return Response.json({ ok: true, skipped: true, reason: 'Another LinkedIn signal cycle is active.' });

      await ensurePortfolioCatalogSeeded(databaseUrl, approvedStarterPortfolioItems);
      const approvedPortfolio = await loadApprovedPortfolioCatalog(databaseUrl);
      replacePortfolioArray(samplePortfolioItems, asPortfolioItems(approvedPortfolio));

      const controls = sourceControlMap(await loadDiscoverySourceControls(databaseUrl));
      const inboxEnabled = controls.linkedin_signal_inbox !== false;
      const publicIndexEnabled = controls.linkedin_public_index !== false && process.env.LINKEDIN_PUBLIC_INDEX_ENABLED !== 'false';
      const startedAt = new Date().toISOString();
      const errors: string[] = [];
      const warnings: string[] = [];
      const signals: LinkedInWarmSignalInput[] = [];

      const inboxConfig = loadLinkedInSignalInboxConfig(process.env);
      const inbox = inboxEnabled
        ? await pollLinkedInSignalInbox(inboxConfig).catch((error) => ({ configured: inboxConfig.configured, checked: 0, accepted: 0, messages: [], errors: [errorMessage(error)] }))
        : { configured: inboxConfig.configured, checked: 0, accepted: 0, messages: [], errors: [] as string[] };
      if (inboxEnabled && !inbox.configured) warnings.push('Dedicated LinkedIn signal mailbox is not configured; email ingestion was skipped.');
      errors.push(...inbox.errors.map((error) => `linkedin_signal_inbox: ${error}`));
      signals.push(...inbox.messages.map((message) => enrichInboxSignal(message)));

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
      signals.push(...publicIndex.inputs);

      const state = await loadNeonAppState(databaseUrl);
      const processed = await processLinkedInWarmSignalBatch({
        state,
        signals,
        actor: 'linkedin-warm-signal-cron',
        generatedAt: startedAt,
        enrichContacts: true,
      });
      const completedAt = new Date().toISOString();
      const run: ProspectDiscoveryRun = {
        id: `linkedin-warm-${Date.parse(startedAt)}`,
        startedAt,
        completedAt,
        sourceCount: Number(inboxEnabled) + Number(publicIndexEnabled),
        candidateCount: signals.length,
        enrichedCount: processed.contactEnrichment.updated,
        newLeadCount: processed.ingestion.created,
        duplicateCount: processed.ingestion.duplicates,
        autoAssignedCount: processed.assigned,
        closeabilityRescoredCount: processed.rescored,
        rejectedCandidateCount: processed.ingestion.rejected,
        sourceStats: [
          {
            sourceName: 'linkedin_signal_inbox',
            checked: inbox.checked,
            acceptedCandidates: inbox.messages.length,
            error: inbox.errors.length ? inbox.errors.join('; ') : undefined,
          },
          {
            sourceName: 'linkedin_public_index',
            checked: publicIndex.checked,
            acceptedCandidates: publicIndex.inputs.length,
            error: publicIndex.error,
          },
        ],
        emailStatus: 'skipped',
        emailMessage: 'Priority A alert pending after persistence.',
        errors,
        newLeadIds: processed.ingestion.captured.map((item) => item.leadId),
      };
      state.runStore.saveRun(run);
      await persistNeonAppState(databaseUrl, state);

      const acknowledged = await acknowledgeLinkedInSignalInbox(
        inboxConfig,
        inbox.messages.map((message) => message.uid),
      ).catch((error) => {
        warnings.push(`LinkedIn signal messages were persisted but could not be marked read: ${errorMessage(error)}`);
        return 0;
      });

      const alert = await sendPriorityAlert(processed.priorityALeadIds, state, startedAt)
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
          enabled: inboxEnabled,
          configured: inbox.configured,
          checked: inbox.checked,
          accepted: inbox.accepted,
          acknowledgedAfterPersistence: acknowledged,
        },
        publicIndex: {
          enabled: publicIndexEnabled,
          checked: publicIndex.checked,
          accepted: publicIndex.inputs.length,
          humanVerificationRequired: true,
        },
        result: processed,
        safeguards: {
          authenticatedLinkedInScraping: false,
          automatedExternalMessaging: false,
          dedicatedMailboxOnly: true,
          acknowledgeOnlyAfterPersistence: true,
          publicIndexContactReadyWithoutVerification: false,
        },
      });
    } catch (error) {
      console.error('LINKEDIN_SIGNAL_CRON_ERROR', error);
      return Response.json({ error: 'LinkedIn warm signal cycle failed.', detail: errorMessage(error) }, { status: 500 });
    } finally {
      if (databaseUrl && lockToken) {
        await releaseNamedRunLock(databaseUrl, LOCK_NAME, lockToken).catch((error) => console.error('LINKEDIN_SIGNAL_LOCK_RELEASE_ERROR', error));
      }
    }
  },
};

function enrichInboxSignal(message: {
  origin: 'sales_navigator_email' | 'linkedin_notification_email';
  messageId: string;
  subject?: string;
  text: string;
  sourceUrl?: string;
  receivedAt: string;
}): LinkedInWarmSignalInput {
  const parsed = parseLinkedInSignal({
    text: `${message.subject ?? ''}\n${message.text}`,
    capturedAt: message.receivedAt,
    sourceUrl: message.sourceUrl,
  });
  return {
    origin: message.origin,
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
  if (!leadIds.length) return { status: 'skipped', message: 'No new Priority A LinkedIn signals.' };
  if (process.env.LINKEDIN_SIGNAL_ALERTS_ENABLED === 'false') return { status: 'skipped', message: 'Priority A internal alerts are disabled.' };
  const host = process.env.OUTREACH_SMTP_HOST?.trim() || process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim() || process.env.PROSPECT_DIGEST_FROM?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  if (!host || !user || !password) return { status: 'skipped', message: 'SMTP configuration is incomplete; Priority A records remain in /priorities.' };
  const recipients = splitEmails(process.env.LINKEDIN_SIGNAL_ALERT_TO ?? 'waseem@codistan.org,sales@codistan.org');
  if (!recipients.length) return { status: 'skipped', message: 'No internal LinkedIn signal alert recipients are configured.' };
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
    subject: `[Priority A LinkedIn signals] ${records.length} new warm lead${records.length === 1 ? '' : 's'}`,
    text: [
      `Generated: ${generatedAt}`,
      '',
      ...records.flatMap((record, index) => [
        `${index + 1}. ${record.lead.companyName ?? record.lead.title}`,
        `Owner: ${record.lead.owner ?? 'Unassigned'}`,
        `Service: ${record.lead.serviceCategory.replace(/_/g, ' ')}`,
        `Evidence: ${record.lead.sourceUrl ?? record.lead.evidenceSummary ?? 'Open the Prospect Desk record'}`,
        `Action: ${record.lead.recommendedNextAction ?? 'Review immediately in /priorities'}`,
        '',
      ]),
      'Open the Priority queue: /priorities',
      'No external message, connection request or application was sent automatically.',
    ].join('\n'),
  });
  return { status: 'sent', message: `Sent an internal alert for ${records.length} Priority A LinkedIn signal(s).` };
}

function splitQueries(value: string | undefined): string[] { return value?.split(/\n+|\s*\|\|\s*/).map((item) => item.trim()).filter(Boolean) ?? []; }
function splitEmails(value: string): string[] { return [...new Set(value.split(/[;,\n]+/).map((item) => item.trim().toLowerCase()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))]; }
function positiveInteger(value: string | undefined, fallback: number, maximum: number): number { const parsed=Number.parseInt(value??'',10); return Number.isInteger(parsed)&&parsed>0?Math.min(parsed,maximum):fallback; }
function requireEnvironment(name: string): string { const value=process.env[name]; if(!value?.trim()) throw new Error(`${name} is required.`); return value.trim(); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
