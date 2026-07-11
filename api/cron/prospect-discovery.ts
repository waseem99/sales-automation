import { randomUUID } from 'node:crypto';
import {
  acquireProspectRunLock,
  loadNeonAppState,
  persistNeonAppState,
  releaseProspectRunLock,
  requireDatabaseUrl,
} from '../../packages/neon-state/src/index.js';
import {
  requireEnvironment,
  runVercelProspectDiscovery,
} from '../../vercel/runtime.js';

export const maxDuration = 300;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
    const cronSecret = requireEnvironment('CRON_SECRET');
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const databaseUrl = requireDatabaseUrl(process.env.DATABASE_URL);
    const lockToken = randomUUID();
    const locked = await acquireProspectRunLock(databaseUrl, lockToken, 10);
    if (!locked) return Response.json({ ok: true, skipped: true, reason: 'Another discovery run is active.' });

    try {
      const state = await loadNeonAppState(databaseUrl);
      const result = await runVercelProspectDiscovery(state.repository, state.runStore);
      await persistNeonAppState(databaseUrl, state);
      return Response.json({
        ok: true,
        run: result.run,
        newLeadIds: result.newLeads.map((lead) => lead.id),
      });
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 500 });
    } finally {
      await releaseProspectRunLock(databaseUrl, lockToken).catch(() => undefined);
    }
  },
};
