import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface LoadEnvironmentFilesResult {
  filesRead: string[];
  keysLoaded: string[];
}

export function loadEnvironmentFiles(input: {
  directory?: string;
  files?: string[];
  environment?: NodeJS.ProcessEnv;
} = {}): LoadEnvironmentFilesResult {
  const directory = resolve(input.directory ?? process.cwd());
  const files = input.files ?? ['.env', '.env.local'];
  const environment = input.environment ?? process.env;
  const merged: Record<string, string> = {};
  const filesRead: string[] = [];

  for (const file of files) {
    const filePath = resolve(directory, file);
    if (!existsSync(filePath)) continue;
    Object.assign(merged, parseEnvironmentFile(readFileSync(filePath, 'utf8')));
    filesRead.push(filePath);
  }

  const keysLoaded: string[] = [];
  for (const [key, value] of Object.entries(merged)) {
    if (environment[key] !== undefined) continue;
    environment[key] = value;
    keysLoaded.push(key);
  }

  return { filesRead, keysLoaded };
}

export function parseEnvironmentFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values[key] = decodeEnvironmentValue(normalized.slice(separator + 1).trim());
  }
  return values;
}

function decodeEnvironmentValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  const commentIndex = value.search(/\s+#/);
  return commentIndex >= 0 ? value.slice(0, commentIndex).trimEnd() : value;
}
