import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { LocalJsonLeadRepository } from '@sales-automation/storage';
import { LocalJsonProspectDiscoveryRunStore } from './run-store.js';
import { runProspectDiscovery } from './runner.js';
import type { ProspectDiscoveryOptions, ProspectDiscoveryResult } from './types.js';

export interface ProspectWorkerHandle {
  stop(): void;
  runNow(): Promise<ProspectDiscoveryResult>;
}

export function buildProspectDiscoveryOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ProspectDiscoveryOptions {
  const leadStorePath = environment.LOCAL_LEAD_STORE_PATH ?? '.data/leads.json';
  const runStorePath = environment.PROSPECT_RUN_STORE_PATH ?? '.data/prospect-runs.json';
  const repository = new LocalJsonLeadRepository({ filePath: leadStorePath });
  const runStore = new LocalJsonProspectDiscoveryRunStore(runStorePath);

  return {
    repository,
    runStore,
    portfolioItems: samplePortfolioItems,
    maxCandidates: optionalInteger(environment.PROSPECT_MAX_CANDIDATES) ?? 50,
    maxSearchQueries: optionalInteger(environment.PROSPECT_MAX_SEARCH_QUERIES) ?? 12,
    searchQueries: splitList(environment.PROSPECT_SEARCH_QUERIES),
    remoteOkEnabled: environment.PROSPECT_REMOTEOK_ENABLED !== 'false',
    bingRssEnabled: environment.PROSPECT_BING_RSS_ENABLED !== 'false',
    greenhouseBoards: splitList(environment.PROSPECT_GREENHOUSE_BOARDS),
    leverSites: splitList(environment.PROSPECT_LEVER_SITES),
    rssFeeds: splitList(environment.PROSPECT_RSS_FEEDS),
    digest: {
      to: environment.PROSPECT_DIGEST_TO,
      from: environment.PROSPECT_DIGEST_FROM ?? environment.SMTP_FROM,
      smtpHost: environment.SMTP_HOST,
      smtpPort: optionalInteger(environment.SMTP_PORT) ?? 587,
      smtpSecure: environment.SMTP_SECURE === 'true',
      smtpUser: environment.SMTP_USER,
      smtpPassword: environment.SMTP_PASSWORD,
      subjectPrefix: environment.PROSPECT_DIGEST_SUBJECT_PREFIX,
    },
  };
}

export async function runConfiguredProspectDiscovery(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProspectDiscoveryResult> {
  return runProspectDiscovery(buildProspectDiscoveryOptionsFromEnvironment(environment));
}

export function startProspectDiscoveryWorker(
  environment: NodeJS.ProcessEnv = process.env,
  onResult?: (result: ProspectDiscoveryResult) => void,
  onError?: (error: Error) => void,
): ProspectWorkerHandle {
  const intervalHours = optionalNumber(environment.PROSPECT_RUN_INTERVAL_HOURS) ?? 24;
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1_000;
  let running: Promise<ProspectDiscoveryResult> | undefined;

  const runNow = async (): Promise<ProspectDiscoveryResult> => {
    if (running) return running;
    running = runConfiguredProspectDiscovery(environment);
    try {
      const result = await running;
      onResult?.(result);
      return result;
    } catch (error) {
      onError?.(error as Error);
      throw error;
    } finally {
      running = undefined;
    }
  };

  const timer = setInterval(() => {
    void runNow().catch(() => undefined);
  }, intervalMs);
  timer.unref?.();

  if (environment.PROSPECT_RUN_ON_START !== 'false') {
    void runNow().catch(() => undefined);
  }

  return {
    stop: () => clearInterval(timer),
    runNow,
  };
}

export function loadLocalEnvironmentFiles(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string[] {
  const loaded: string[] = [];
  for (const filename of ['.env', '.env.local']) {
    const path = resolve(cwd, filename);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!match?.[1]) continue;
      const key = match[1];
      if (environment[key] !== undefined) continue;
      environment[key] = unquote(match[2] ?? '');
    }
    loaded.push(path);
  }
  return loaded;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function optionalInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
