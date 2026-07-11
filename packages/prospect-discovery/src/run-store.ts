import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProspectDiscoveryRun, ProspectDiscoveryRunStore } from './types.js';

interface PersistedRunFile {
  version: 1;
  updatedAt: string;
  runs: ProspectDiscoveryRun[];
}

export class InMemoryProspectDiscoveryRunStore implements ProspectDiscoveryRunStore {
  protected runs: ProspectDiscoveryRun[] = [];

  constructor(initialRuns: ProspectDiscoveryRun[] = []) {
    this.replaceRuns(initialRuns);
  }

  listRuns(limit = 30): ProspectDiscoveryRun[] {
    return [...this.runs]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, Math.max(0, limit));
  }

  saveRun(run: ProspectDiscoveryRun): void {
    this.runs = [run, ...this.runs.filter((item) => item.id !== run.id)].slice(0, 180);
    this.afterMutation();
  }

  protected replaceRuns(runs: ProspectDiscoveryRun[]): void {
    this.runs = [...runs];
  }

  protected afterMutation(): void {
    // In-memory store has no side effects.
  }
}

export class LocalJsonProspectDiscoveryRunStore extends InMemoryProspectDiscoveryRunStore {
  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  protected override afterMutation(): void {
    this.persist();
  }

  private load(): void {
    ensureParentDirectory(this.filePath);
    if (!existsSync(this.filePath)) {
      this.persist();
      return;
    }
    const raw = readFileSync(this.filePath, 'utf8').trim();
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PersistedRunFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) {
      throw new Error(`Invalid discovery run store at ${this.filePath}.`);
    }
    this.replaceRuns(parsed.runs);
  }

  private persist(): void {
    ensureParentDirectory(this.filePath);
    const payload: PersistedRunFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: this.listRuns(180),
    };
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
