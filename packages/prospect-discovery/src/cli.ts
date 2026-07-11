import { resolve } from 'node:path';
import {
  loadLocalEnvironmentFiles,
  runConfiguredProspectDiscovery,
  startProspectDiscoveryWorker,
} from './worker.js';

type Command = 'run' | 'worker';

export async function runProspectCommand(
  command: Command,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (command === 'run') {
    const result = await runConfiguredProspectDiscovery(environment);
    process.stdout.write(`${JSON.stringify(result.run, null, 2)}\n`);
    return result.run.emailStatus === 'failed' ? 2 : 0;
  }

  const handle = startProspectDiscoveryWorker(
    environment,
    (result) => process.stdout.write(`${JSON.stringify(result.run, null, 2)}\n`),
    (error) => process.stderr.write(`Prospect worker run failed: ${error.message}\n`),
  );
  const shutdown = () => {
    handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdout.write('Prospect discovery worker started.\n');
  return new Promise<number>(() => undefined);
}

function requireCommand(value?: string): Command {
  if (value === 'run' || value === 'worker') return value;
  throw new Error('Expected command: run or worker.');
}

async function main(): Promise<void> {
  try {
    const loaded = loadLocalEnvironmentFiles();
    if (loaded.length > 0) process.stderr.write(`Loaded local configuration from ${loaded.join(', ')}.\n`);
    process.exitCode = await runProspectCommand(requireCommand(process.argv[2]), process.env);
  } catch (error) {
    process.stderr.write(`Prospect command failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  await main();
}
