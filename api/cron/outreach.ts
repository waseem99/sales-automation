export const maxDuration = 300;

const OUTREACH_LOCK_NAME = 'hourly-cpanel-outreach';

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
      const [{ randomUUID }, loadedNeonModule, outreachModule] = await Promise.all([
        import('node:crypto'),
        loadNeonModule(),
        import('@sales-automation/outreach-email'),
      ]);
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
      const config = outreachModule.loadOutreachEmailConfig(process.env);

      phase = 'run_outreach_cycle';
      const report = await outreachModule.runOutreachCycle({
        repository: state.repository,
        config,
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

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}
