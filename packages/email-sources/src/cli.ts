import { resolve } from 'node:path';
import { runGmailAuthorization } from './authorize-gmail.js';
import { loadEnvironmentFiles } from './env.js';
import { runGmailLeadIngestion } from './run-gmail.js';
import { runGmailWorker } from './run-gmail-worker.js';

type GmailCommand = 'authorize' | 'ingest' | 'worker';

export async function runGmailCommand(
  command: GmailCommand,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (command === 'authorize') {
    const result = await runGmailAuthorization(environment);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (command === 'ingest') {
    const result = await runGmailLeadIngestion(environment);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.alertFailureCount > 0 ? 2 : 0;
  }

  return runGmailWorker(environment);
}

function requireCommand(value?: string): GmailCommand {
  if (value === 'authorize' || value === 'ingest' || value === 'worker') return value;
  throw new Error('Expected command: authorize, ingest, or worker.');
}

async function main(): Promise<void> {
  try {
    const loaded = loadEnvironmentFiles();
    const command = requireCommand(process.argv[2]);
    if (loaded.filesRead.length > 0) {
      process.stderr.write(`Loaded local configuration from ${loaded.filesRead.join(', ')}.\n`);
    }
    process.exitCode = await runGmailCommand(command, process.env);
  } catch (error) {
    process.stderr.write(`Gmail command failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  await main();
}
