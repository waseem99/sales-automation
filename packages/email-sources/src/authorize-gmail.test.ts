import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GMAIL_READONLY_SCOPE,
  buildGmailAuthorizationUrl,
  createPkceChallenge,
  exchangeGmailAuthorizationCode,
  fetchGmailProfile,
  inspectGrantedScopes,
  updateEnvironmentFileContent,
  validateLoopbackRedirectUri,
  writeOAuthEnvironmentFile,
  type GmailOAuthFetch,
  type GmailOAuthFetchResponse,
} from './authorize-gmail.js';
import { loadEnvironmentFiles, parseEnvironmentFile } from './env.js';

function jsonResponse(value: unknown, status = 200): GmailOAuthFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
    async text() { return JSON.stringify(value); },
  };
}

const verifier = 'a'.repeat(43);
const challenge = createPkceChallenge(verifier);
assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
assert.throws(() => createPkceChallenge('too-short'), /43 and 128/);

const redirectUri = validateLoopbackRedirectUri('http://127.0.0.1:53682/oauth/callback');
const authorizationUrl = new URL(buildGmailAuthorizationUrl({
  clientId: 'client-id.apps.googleusercontent.com',
  redirectUri,
  state: 'state-value',
  codeChallenge: challenge,
  loginHint: 'leads@example.com',
}));
assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
assert.equal(authorizationUrl.searchParams.get('scope'), GMAIL_READONLY_SCOPE);
assert.equal(authorizationUrl.searchParams.get('access_type'), 'offline');
assert.equal(authorizationUrl.searchParams.get('prompt'), 'consent');
assert.equal(authorizationUrl.searchParams.get('state'), 'state-value');
assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authorizationUrl.searchParams.get('login_hint'), 'leads@example.com');
assert.throws(() => validateLoopbackRedirectUri('https://example.com/oauth/callback'), /HTTP/);
assert.throws(() => validateLoopbackRedirectUri('http://example.com:53682/oauth/callback'), /loopback/);
assert.throws(() => validateLoopbackRedirectUri('http://127.0.0.1/oauth/callback'), /port/);

const requests: Array<{ url: string; body?: string; authorization?: string }> = [];
const fetchImpl: GmailOAuthFetch = async (url, init) => {
  requests.push({
    url,
    body: init?.body,
    authorization: init?.headers?.authorization,
  });
  if (url.includes('/token')) {
    return jsonResponse({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: `${GMAIL_READONLY_SCOPE} profile`,
    });
  }
  if (url.includes('/profile')) {
    return jsonResponse({
      emailAddress: 'leads@example.com',
      messagesTotal: 120,
      threadsTotal: 95,
      historyId: '12345',
    });
  }
  return jsonResponse({ error: 'not found' }, 404);
};

const tokens = await exchangeGmailAuthorizationCode({
  authorizationCode: 'authorization-code',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri,
  codeVerifier: verifier,
  fetchImpl,
  tokenEndpoint: 'https://oauth.example.test/token',
});
assert.equal(tokens.accessToken, 'access-token');
assert.equal(tokens.refreshToken, 'refresh-token');
assert.deepEqual(tokens.scope, [GMAIL_READONLY_SCOPE, 'profile']);
assert.match(requests[0]?.body ?? '', /grant_type=authorization_code/);
assert.match(requests[0]?.body ?? '', /code_verifier=/);
assert.doesNotMatch(JSON.stringify(tokens), /client-secret/);

const profile = await fetchGmailProfile(
  tokens.accessToken,
  fetchImpl,
  'https://gmail.example.test/profile',
);
assert.equal(profile.emailAddress, 'leads@example.com');
assert.equal(profile.messagesTotal, 120);
assert.equal(requests[1]?.authorization, 'Bearer access-token');
assert.deepEqual(inspectGrantedScopes(tokens.scope).extraScopes, ['profile']);
assert.throws(() => inspectGrantedScopes(['profile']), /required scope/);

await assert.rejects(
  () => exchangeGmailAuthorizationCode({
    authorizationCode: 'authorization-code',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri,
    codeVerifier: verifier,
    fetchImpl: async () => jsonResponse({ access_token: 'access-only', scope: GMAIL_READONLY_SCOPE }),
  }),
  /refresh token/,
);

const existingEnvironment = [
  '# Existing settings',
  'GMAIL_CLIENT_ID=old-client',
  'OTHER_SETTING=keep-me',
  'GMAIL_REFRESH_TOKEN=old-token',
  'GMAIL_REFRESH_TOKEN=duplicate-token',
  '',
].join('\n');
const updatedEnvironment = updateEnvironmentFileContent(existingEnvironment, {
  GMAIL_CLIENT_ID: 'new-client',
  GMAIL_CLIENT_SECRET: 'secret with spaces',
  GMAIL_REFRESH_TOKEN: 'new-refresh-token',
  GMAIL_USER_ID: 'me',
});
assert.match(updatedEnvironment, /# Existing settings/);
assert.match(updatedEnvironment, /OTHER_SETTING=keep-me/);
assert.match(updatedEnvironment, /GMAIL_CLIENT_ID=new-client/);
assert.match(updatedEnvironment, /GMAIL_CLIENT_SECRET="secret with spaces"/);
assert.equal((updatedEnvironment.match(/GMAIL_REFRESH_TOKEN=/g) ?? []).length, 1);
assert.match(updatedEnvironment, /GMAIL_USER_ID=me/);
assert.doesNotMatch(updatedEnvironment, /old-token|duplicate-token/);

const directory = mkdtempSync(join(tmpdir(), 'gmail-oauth-'));
const outputFile = join(directory, '.env.local');
writeFileSync(outputFile, 'EXISTING=value\n', 'utf8');
chmodSync(outputFile, 0o644);
writeOAuthEnvironmentFile(outputFile, {
  GMAIL_CLIENT_ID: 'client-id',
  GMAIL_CLIENT_SECRET: 'client-secret',
  GMAIL_REFRESH_TOKEN: 'refresh-token',
});
const written = readFileSync(outputFile, 'utf8');
assert.match(written, /EXISTING=value/);
assert.match(written, /GMAIL_REFRESH_TOKEN=refresh-token/);
assert.equal(statSync(outputFile).mode & 0o777, 0o600);
assert.throws(
  () => writeOAuthEnvironmentFile(join(directory, '.env.example'), { GMAIL_REFRESH_TOKEN: 'nope' }),
  /Refusing/,
);

const parsedEnvironment = parseEnvironmentFile([
  '# comment',
  'PLAIN=value',
  'export EXPORTED="hello world"',
  "SINGLE='literal value'",
  'INLINE=value # comment',
  'INVALID-KEY=nope',
].join('\n'));
assert.deepEqual(parsedEnvironment, {
  PLAIN: 'value',
  EXPORTED: 'hello world',
  SINGLE: 'literal value',
  INLINE: 'value',
});

const envDirectory = join(directory, 'load');
const fs = await import('node:fs');
fs.mkdirSync(envDirectory, { recursive: true });
writeFileSync(join(envDirectory, '.env'), 'FROM_BASE=base\nOVERRIDE=base\n', 'utf8');
writeFileSync(join(envDirectory, '.env.local'), 'OVERRIDE=local\nFROM_LOCAL=local\n', 'utf8');
const targetEnvironment: NodeJS.ProcessEnv = { OVERRIDE: 'process' };
const loadResult = loadEnvironmentFiles({ directory: envDirectory, environment: targetEnvironment });
assert.equal(loadResult.filesRead.length, 2);
assert.equal(targetEnvironment.FROM_BASE, 'base');
assert.equal(targetEnvironment.FROM_LOCAL, 'local');
assert.equal(targetEnvironment.OVERRIDE, 'process');

rmSync(directory, { recursive: true, force: true });
console.log('Gmail OAuth bootstrap and environment loader tests passed.');
