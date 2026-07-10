import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, basename, resolve } from 'node:path';
import { loadEnvironmentFiles } from './env.js';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_PROFILE_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:53682/oauth/callback';

export interface GmailOAuthEnvironment {
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_OAUTH_REDIRECT_URI?: string;
  GMAIL_OAUTH_OUTPUT_FILE?: string;
  GMAIL_OAUTH_TIMEOUT_SECONDS?: string;
  GMAIL_OAUTH_LOGIN_HINT?: string;
}

export interface GmailOAuthFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type GmailOAuthFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<GmailOAuthFetchResponse>;

export interface GmailOAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  tokenType?: string;
  scope: string[];
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

export interface GmailAuthorizationResult {
  connectedMailbox: string;
  scope: string[];
  extraScopes: string[];
  refreshTokenWrittenTo: string;
  messagesTotal?: number;
  threadsTotal?: number;
  tokenType?: string;
  expiresIn?: number;
  safetyNotes: string[];
}

export interface GmailAuthorizationDependencies {
  fetchImpl?: GmailOAuthFetch;
  output?: (message: string) => void;
  now?: () => string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface LoopbackAuthorizationListener {
  authorizationCode: Promise<string>;
  close(): Promise<void>;
}

export async function runGmailAuthorization(
  environment: GmailOAuthEnvironment = process.env,
  dependencies: GmailAuthorizationDependencies = {},
): Promise<GmailAuthorizationResult> {
  const clientId = requireSecret(environment.GMAIL_CLIENT_ID, 'GMAIL_CLIENT_ID');
  const clientSecret = requireSecret(environment.GMAIL_CLIENT_SECRET, 'GMAIL_CLIENT_SECRET');
  const redirectUri = validateLoopbackRedirectUri(
    environment.GMAIL_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI,
  );
  const outputFile = resolve(environment.GMAIL_OAUTH_OUTPUT_FILE?.trim() || '.env.local');
  assertSafeOAuthOutputFile(outputFile);
  const timeoutMs = parsePositiveInteger(environment.GMAIL_OAUTH_TIMEOUT_SECONDS, 300) * 1_000;
  const fetchImpl = dependencies.fetchImpl ?? (globalThis.fetch as unknown as GmailOAuthFetch | undefined);
  if (!fetchImpl) throw new Error('Global fetch is unavailable. Supply a fetch implementation.');
  const output = dependencies.output ?? ((message) => process.stdout.write(`${message}\n`));
  const state = randomBytes(24).toString('base64url');
  const pkce = createPkcePair();
  const listener = await createLoopbackAuthorizationListener({
    redirectUri,
    expectedState: state,
    timeoutMs,
  });
  const authorizationUrl = buildGmailAuthorizationUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge: pkce.challenge,
    loginHint: environment.GMAIL_OAUTH_LOGIN_HINT?.trim() || undefined,
  });

  output('Open this URL in a browser and authorize the Gmail mailbox that receives Upwork alerts:');
  output(authorizationUrl);
  output('The command will continue automatically after Google redirects to the local callback.');

  let authorizationCode: string;
  try {
    authorizationCode = await listener.authorizationCode;
  } finally {
    await listener.close();
  }

  const tokens = await exchangeGmailAuthorizationCode({
    authorizationCode,
    clientId,
    clientSecret,
    redirectUri,
    codeVerifier: pkce.verifier,
    fetchImpl,
  });
  const profile = await fetchGmailProfile(tokens.accessToken, fetchImpl);
  const scopeCheck = inspectGrantedScopes(tokens.scope);
  writeOAuthEnvironmentFile(outputFile, {
    GMAIL_CLIENT_ID: clientId,
    GMAIL_CLIENT_SECRET: clientSecret,
    GMAIL_REFRESH_TOKEN: tokens.refreshToken,
    GMAIL_USER_ID: 'me',
  });

  return {
    connectedMailbox: profile.emailAddress,
    scope: tokens.scope,
    extraScopes: scopeCheck.extraScopes,
    refreshTokenWrittenTo: outputFile,
    messagesTotal: profile.messagesTotal,
    threadsTotal: profile.threadsTotal,
    tokenType: tokens.tokenType,
    expiresIn: tokens.expiresIn,
    safetyNotes: [
      'The refresh token was written to an ignored local environment file and was not printed.',
      'The requested Gmail permission is read-only.',
      'The connected mailbox was validated with the Gmail profile endpoint.',
      ...(scopeCheck.extraScopes.length > 0
        ? [`Google reported additional granted scopes: ${scopeCheck.extraScopes.join(', ')}`]
        : []),
    ],
  };
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createPkceChallenge(verifier) };
}

export function createPkceChallenge(verifier: string): string {
  if (verifier.length < 43 || verifier.length > 128) {
    throw new Error('PKCE verifier must be between 43 and 128 characters.');
  }
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildGmailAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
  return url.toString();
}

export async function exchangeGmailAuthorizationCode(input: {
  authorizationCode: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl: GmailOAuthFetch;
  tokenEndpoint?: string;
}): Promise<GmailOAuthTokenResponse> {
  const body = new URLSearchParams({
    code: input.authorizationCode,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    grant_type: 'authorization_code',
  });
  const response = await input.fetchImpl(input.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!payload.access_token) throw new Error('Google OAuth response did not include an access token.');
  if (!payload.refresh_token) {
    throw new Error('Google OAuth response did not include a refresh token. Re-run authorization with consent, or revoke the existing app grant and try again.');
  }
  const scope = (payload.scope ?? GMAIL_READONLY_SCOPE).split(/\s+/).filter(Boolean);
  inspectGrantedScopes(scope);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    tokenType: payload.token_type,
    scope,
  };
}

export async function fetchGmailProfile(
  accessToken: string,
  fetchImpl: GmailOAuthFetch,
  endpoint = GMAIL_PROFILE_ENDPOINT,
): Promise<GmailProfile> {
  const response = await fetchImpl(endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Gmail profile validation failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const profile = await response.json() as Partial<GmailProfile>;
  if (!profile.emailAddress?.trim()) {
    throw new Error('Gmail profile response did not include an email address.');
  }
  return {
    emailAddress: profile.emailAddress,
    messagesTotal: profile.messagesTotal,
    threadsTotal: profile.threadsTotal,
    historyId: profile.historyId,
  };
}

export function inspectGrantedScopes(scopes: string[]): { extraScopes: string[] } {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
  if (!normalized.includes(GMAIL_READONLY_SCOPE)) {
    throw new Error(`The granted token does not include the required scope: ${GMAIL_READONLY_SCOPE}`);
  }
  return { extraScopes: normalized.filter((scope) => scope !== GMAIL_READONLY_SCOPE) };
}

export async function createLoopbackAuthorizationListener(input: {
  redirectUri: string;
  expectedState: string;
  timeoutMs: number;
}): Promise<LoopbackAuthorizationListener> {
  const redirect = new URL(validateLoopbackRedirectUri(input.redirectUri));
  const port = Number.parseInt(redirect.port, 10);
  let server: Server;
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  let settled = false;
  let timer: NodeJS.Timeout;

  const authorizationCode = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveCode = resolvePromise;
    rejectCode = rejectPromise;
  });

  const settle = (error?: Error, code?: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) rejectCode(error);
    else resolveCode(code!);
  };

  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', redirect.origin);
    if (request.method !== 'GET' || requestUrl.pathname !== redirect.pathname) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const oauthError = requestUrl.searchParams.get('error');
    const returnedState = requestUrl.searchParams.get('state') ?? '';
    const code = requestUrl.searchParams.get('code') ?? '';
    if (oauthError) {
      response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderCallbackPage(false, `Authorization failed: ${oauthError}`));
      settle(new Error(`Google authorization failed: ${oauthError}`));
      return;
    }
    if (!secureStringEqual(returnedState, input.expectedState)) {
      response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderCallbackPage(false, 'State validation failed.'));
      settle(new Error('OAuth callback state did not match. Authorization was rejected.'));
      return;
    }
    if (!code) {
      response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderCallbackPage(false, 'Authorization code was missing.'));
      settle(new Error('OAuth callback did not include an authorization code.'));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderCallbackPage(true, 'Gmail read-only authorization completed. You can close this window.'));
    settle(undefined, code);
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, redirect.hostname, () => {
      server.removeListener('error', rejectPromise);
      resolvePromise();
    });
  });
  timer = setTimeout(() => {
    settle(new Error('Gmail authorization timed out before the OAuth callback was received.'));
  }, input.timeoutMs);
  timer.unref();

  return {
    authorizationCode,
    async close() {
      clearTimeout(timer);
      if (!server.listening) return;
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => error ? rejectPromise(error) : resolvePromise());
      });
    },
  };
}

export function validateLoopbackRedirectUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GMAIL_OAUTH_REDIRECT_URI is invalid.');
  }
  if (url.protocol !== 'http:') {
    throw new Error('GMAIL_OAUTH_REDIRECT_URI must use HTTP for the local loopback callback.');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('GMAIL_OAUTH_REDIRECT_URI must use localhost or a loopback IP address.');
  }
  if (!url.port) {
    throw new Error('GMAIL_OAUTH_REDIRECT_URI must include an explicit port.');
  }
  if (!url.pathname || url.pathname === '/') {
    throw new Error('GMAIL_OAUTH_REDIRECT_URI must include a callback path.');
  }
  return url.toString();
}

export function updateEnvironmentFileContent(
  existingContent: string,
  values: Record<string, string>,
): string {
  const lines = existingContent ? existingContent.replace(/\r\n/g, '\n').split('\n') : [];
  const updatedKeys = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = match?.[1];
    if (!key || !(key in values)) {
      output.push(line);
      continue;
    }
    if (updatedKeys.has(key)) continue;
    output.push(`${key}=${encodeEnvironmentValue(values[key]!)}`);
    updatedKeys.add(key);
  }

  const missing = Object.entries(values).filter(([key]) => !updatedKeys.has(key));
  while (output.length > 0 && output.at(-1) === '') output.pop();
  if (output.length > 0 && missing.length > 0) output.push('');
  for (const [key, value] of missing) output.push(`${key}=${encodeEnvironmentValue(value)}`);
  return `${output.join('\n')}\n`;
}

export function writeOAuthEnvironmentFile(filePath: string, values: Record<string, string>): void {
  const resolved = resolve(filePath);
  assertSafeOAuthOutputFile(resolved);
  mkdirSync(dirname(resolved), { recursive: true });
  const existing = existsSync(resolved) ? readFileSync(resolved, 'utf8') : '';
  const temporary = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temporary, updateEnvironmentFileContent(existing, values), { encoding: 'utf8', mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, resolved);
  chmodSync(resolved, 0o600);
}

function assertSafeOAuthOutputFile(filePath: string): void {
  const name = basename(filePath).toLowerCase();
  if (name === '.env.example') {
    throw new Error('Refusing to write OAuth secrets to .env.example. Use .env.local or a deployment secret store.');
  }
}

function requireSecret(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  if (/[\r\n]/.test(normalized)) throw new Error(`${name} contains an invalid newline.`);
  return normalized;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received: ${value}`);
  }
  return parsed;
}

function encodeEnvironmentValue(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Environment values cannot contain newlines.');
  if (/^[A-Za-z0-9_./:@%+\-=]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function renderCallbackPage(success: boolean, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Codistan Gmail Authorization</title></head><body><main><h1>${success ? 'Authorization complete' : 'Authorization failed'}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function main(): Promise<void> {
  try {
    loadEnvironmentFiles();
    const result = await runGmailAuthorization(process.env);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Gmail authorization failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  await main();
}
