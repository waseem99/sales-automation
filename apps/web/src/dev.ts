import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import {
  buildProspectDiscoveryOptionsFromEnvironment,
  LocalJsonProspectDiscoveryRunStore,
  runProspectDiscovery,
  type ProspectDiscoveryResult,
} from '@sales-automation/prospect-discovery';
import { LocalJsonLeadRepository } from '@sales-automation/storage';
import { createProspectDashboardHttpServer } from './prospect-server.js';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const storagePath = process.env.LOCAL_LEAD_STORE_PATH ?? '.data/leads.json';
const runStorePath = process.env.PROSPECT_RUN_STORE_PATH ?? '.data/prospect-runs.json';
const repository = new LocalJsonLeadRepository({ filePath: storagePath });
const runStore = new LocalJsonProspectDiscoveryRunStore(runStorePath);
const adminPassword = requiredProductionSecret('ADMIN_PASSWORD', 'codistan-dev-password');
const sessionSecret = requiredProductionSecret('SESSION_SECRET', 'codistan-dev-session-secret-change-me');

if (process.env.SEED_SAMPLE_DATA === 'true' && repository.listLeads().length === 0) {
  const generatedAt = new Date().toISOString();
  for (const lead of sampleLeads) {
    repository.saveEvaluation(
      evaluateLead({ lead, portfolioItems: samplePortfolioItems, generatedAt }),
      'web-dev-seed',
    );
  }
}

const configuredDiscovery = buildProspectDiscoveryOptionsFromEnvironment(process.env);
let activeDiscovery: Promise<ProspectDiscoveryResult> | undefined;
const runDiscovery = (): Promise<ProspectDiscoveryResult> => {
  if (activeDiscovery) return activeDiscovery;
  activeDiscovery = runProspectDiscovery({
    ...configuredDiscovery,
    repository,
    runStore,
    portfolioItems: samplePortfolioItems,
  }).finally(() => {
    activeDiscovery = undefined;
  });
  return activeDiscovery;
};

const server = createProspectDashboardHttpServer({
  repository,
  portfolioItems: samplePortfolioItems,
  runStore,
  runDiscovery,
  adminPassword,
  sessionSecret,
  secureCookies: production,
  now: () => new Date().toISOString(),
});

server.listen(port, () => {
  console.log(`Codistan Prospect Desk running at http://localhost:${port}`);
  console.log(`Lead store: ${storagePath}`);
  console.log(`Discovery run store: ${runStorePath}`);
  if (!production) console.log('Local login password: codistan-dev-password (override with ADMIN_PASSWORD).');
});

const workerEnabled = process.env.PROSPECT_WORKER_ENABLED === 'true'
  || (production && process.env.PROSPECT_WORKER_ENABLED !== 'false');
if (workerEnabled) {
  const intervalHours = positiveNumber(process.env.PROSPECT_RUN_INTERVAL_HOURS, 24);
  const runOnStart = process.env.PROSPECT_RUN_ON_START !== 'false';
  const execute = () => void runDiscovery()
    .then((result) => console.log(`Prospect discovery completed: ${result.run.newLeadCount} new leads.`))
    .catch((error) => console.error(`Prospect discovery failed: ${(error as Error).message}`));
  if (runOnStart) execute();
  const timer = setInterval(execute, intervalHours * 60 * 60 * 1_000);
  timer.unref?.();
  console.log(`Prospect discovery worker enabled every ${intervalHours} hour(s).`);
}

function requiredProductionSecret(name: string, developmentFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (production) throw new Error(`${name} is required in production.`);
  return developmentFallback;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
