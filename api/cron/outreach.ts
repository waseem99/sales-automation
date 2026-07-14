export const maxDuration = 300;

const OUTREACH_LOCK_NAME = 'hourly-cpanel-outreach';
const SALES_EMAIL = 'sales@codistan.org';
const WASEEM_EMAIL = 'waseem@codistan.org';

interface MailboxLike {
  email: string;
  displayName: string;
  password: string;
  signature: string;
}

interface OutreachConfigLike {
  mailboxes: MailboxLike[];
  activeSenderEmails: string[];
  alertEmails: string[];
  unsubscribeEmail: string;
  [key: string]: unknown;
}

interface MailOptionsLike {
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  replyTo?: unknown;
  envelope?: { from?: string; to?: string[] };
  [key: string]: unknown;
}

export default {
  async fetch(request: Request): Promise<Response> {
    let phase = 'request_received';
    let databaseUrl: string | undefined;
    let lockToken: string | undefined;
    let neonModule: Awaited<ReturnType<typeof loadNeonModule>> | undefined;

    try {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }

      phase = 'validate_cron_secret';
      const cronSecret = requireEnvironment('CRON_SECRET');
      if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return Response.json({ error: 'Unauthorized.' }, { status: 401 });
      }

      phase = 'load_runtime_modules';
      const [{ randomUUID }, loadedNeonModule, nodemailerModule] = await Promise.all([
        import('node:crypto'),
        loadNeonModule(),
        import('nodemailer'),
      ]);
      installMandatoryCc(nodemailerModule.default as unknown as { createTransport: (...args: unknown[]) => unknown });
      const outreachModule = await import('@sales-automation/outreach-email');
      neonModule = loadedNeonModule;

      phase = 'connect_database';
      databaseUrl = neonModule.requireDatabaseUrl(process.env.DATABASE_URL);
      lockToken = randomUUID();
      const locked = await neonModule.acquireNamedRunLock(databaseUrl, OUTREACH_LOCK_NAME, lockToken, 20);
      if (!locked) {
        return Response.json({ ok: true, skipped: true, reason: 'Another outreach cycle is active.' });
      }

      phase = 'load_application_state';
      const state = await neonModule.loadNeonAppState(databaseUrl);
      const config = configureSalesRouting(
        outreachModule.loadOutreachEmailConfig(process.env) as unknown as OutreachConfigLike,
        process.env,
      );

      phase = 'run_outreach_cycle';
      const report = await outreachModule.runOutreachCycle({
        repository: state.repository,
        config: config as never,
      });

      phase = 'persist_application_state';
      await neonModule.persistNeonAppState(databaseUrl, state);

      return Response.json({
        ok: true,
        report,
        configuration: {
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          configuredMailboxCount: config.mailboxes.length,
          activeSenderCount: config.activeSenderEmails.length,
          primarySender: config.activeSenderEmails[0] ?? null,
          mandatoryCc: [WASEEM_EMAIL, 'assigned lead owner'],
          sendingEnabled: config.sendingEnabled,
          dnsReady: config.dnsReady,
          dryRun: config.dryRun,
          replyPollingEnabled: config.replyPollingEnabled,
          rampStartedAt: config.rampStartedAt ?? null,
        },
      });
    } catch (error) {
      const details = normalizeError(error);
      console.error('VERCEL_OUTREACH_CRON_ERROR', {
        phase,
        message: details.message,
        stack: details.stack,
      });
      return Response.json({
        error: 'Outreach cron failed.',
        phase,
        detail: details.message,
      }, { status: 500 });
    } finally {
      if (neonModule && databaseUrl && lockToken) {
        await neonModule.releaseNamedRunLock(databaseUrl, OUTREACH_LOCK_NAME, lockToken).catch((error: unknown) => {
          console.error('VERCEL_OUTREACH_LOCK_RELEASE_ERROR', normalizeError(error));
        });
      }
    }
  },
};

async function loadNeonModule() {
  return import('@sales-automation/neon-state');
}

function configureSalesRouting(config: OutreachConfigLike, environment: NodeJS.ProcessEnv): OutreachConfigLike {
  const salesPassword = environment.SALES_MAILBOX_PASSWORD?.trim()
    || (normalizeEmail(environment.SMTP_USER) === SALES_EMAIL ? environment.SMTP_PASSWORD?.trim() : undefined);
  const withoutOldSales = config.mailboxes.filter((mailbox) => normalizeEmail(mailbox.email) !== SALES_EMAIL);
  const salesMailbox = salesPassword ? [{
    email: SALES_EMAIL,
    displayName: 'Codistan Sales',
    password: salesPassword,
    signature: environment.SALES_OUTREACH_SIGNATURE?.trim()
      || 'Codistan Sales\nCodistan Pvt Limited\nhttps://codistan.org',
  }] : [];

  return {
    ...config,
    mailboxes: [...salesMailbox, ...withoutOldSales],
    activeSenderEmails: salesPassword ? [SALES_EMAIL] : [],
    alertEmails: uniqueEmails([WASEEM_EMAIL, SALES_EMAIL, ...config.alertEmails]),
    unsubscribeEmail: SALES_EMAIL,
  };
}

function installMandatoryCc(nodemailer: { createTransport: (...args: unknown[]) => unknown }): void {
  const mutable = nodemailer as { createTransport: (...args: unknown[]) => unknown; __codistanCcInstalled?: boolean };
  if (mutable.__codistanCcInstalled) return;
  const originalCreateTransport = mutable.createTransport.bind(nodemailer);
  mutable.createTransport = (...args: unknown[]) => {
    const transporter = originalCreateTransport(...args) as {
      sendMail?: (options: MailOptionsLike) => Promise<unknown>;
      [key: string]: unknown;
    };
    if (!transporter?.sendMail) return transporter;
    const originalSendMail = transporter.sendMail.bind(transporter);
    transporter.sendMail = (options: MailOptionsLike) => {
      const from = firstEmail(options.from);
      const primaryRecipients = emailList(options.to);
      const assignedOwner = firstEmail(options.replyTo);
      const mandatory = uniqueEmails([assignedOwner ?? '', WASEEM_EMAIL])
        .filter((email) => email !== from && !primaryRecipients.includes(email));
      const cc = uniqueEmails([...emailList(options.cc), ...mandatory]);
      const envelopeTo = uniqueEmails([
        ...emailList(options.envelope?.to),
        ...primaryRecipients,
        ...cc,
      ]);
      return originalSendMail({
        ...options,
        cc,
        envelope: {
          ...(options.envelope ?? {}),
          to: envelopeTo,
        },
      });
    };
    return transporter;
  };
  mutable.__codistanCcInstalled = true;
}

function firstEmail(value: unknown): string | undefined {
  return emailList(value)[0];
}

function emailList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(emailList);
  if (typeof value === 'object' && 'address' in value) {
    return emailList((value as { address?: unknown }).address);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[;,]+/)
    .map((item) => normalizeEmail(item.replace(/^.*<([^>]+)>.*$/, '$1')))
    .filter((item): item is string => Boolean(item));
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function uniqueEmails(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeEmail(value)).filter((value): value is string => Boolean(value)))];
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}
