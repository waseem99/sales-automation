import { Buffer } from 'node:buffer';
import type { EmailSourceAdapter, SafeEmailMessage, SafeEmailQuery } from './index.js';

export interface GmailApiCredentials {
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

export interface GmailFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type GmailFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<GmailFetchResponse>;

export interface GmailApiEmailSourceAdapterOptions {
  credentials: GmailApiCredentials;
  userId?: string;
  fetchImpl?: GmailFetch;
  now?: () => number;
  apiBaseUrl?: string;
  tokenEndpoint?: string;
}

interface GmailListResponse {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    data?: string;
    size?: number;
  };
  parts?: GmailMessagePart[];
}

interface GmailMessageResponse {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

const DEFAULT_GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1';
const DEFAULT_GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MAX_GMAIL_RESULTS = 500;

/**
 * Read-only Gmail REST adapter. It only calls the Gmail messages.list and
 * messages.get endpoints and never sends, labels, archives, deletes, or marks
 * email as read.
 */
export class GmailApiEmailSourceAdapter implements EmailSourceAdapter {
  readonly provider = 'gmail' as const;
  readonly readOnly = true as const;

  private readonly credentials: GmailApiCredentials;
  private readonly userId: string;
  private readonly fetchImpl: GmailFetch;
  private readonly now: () => number;
  private readonly apiBaseUrl: string;
  private readonly tokenEndpoint: string;
  private cachedAccessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(options: GmailApiEmailSourceAdapterOptions) {
    this.credentials = options.credentials;
    this.userId = options.userId?.trim() || 'me';
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init) as Promise<GmailFetchResponse>);
    this.now = options.now ?? (() => Date.now());
    this.apiBaseUrl = stripTrailingSlash(options.apiBaseUrl ?? DEFAULT_GMAIL_API_BASE_URL);
    this.tokenEndpoint = options.tokenEndpoint ?? DEFAULT_GOOGLE_TOKEN_ENDPOINT;

    validateCredentials(this.credentials);
  }

  async searchMessages(query: SafeEmailQuery): Promise<SafeEmailMessage[]> {
    const accessToken = await this.getAccessToken();
    const maxResults = clamp(query.maxResults ?? 25, 1, MAX_GMAIL_RESULTS);
    const nativeQuery = buildNativeGmailQuery(query);
    const messageRefs = await this.listMessageRefs(accessToken, nativeQuery, maxResults);
    const messages: SafeEmailMessage[] = [];

    for (const messageRef of messageRefs) {
      const message = await this.getMessage(accessToken, messageRef.id);
      messages.push(mapGmailMessage(message, this.now));
    }

    return messages;
  }

  private async listMessageRefs(
    accessToken: string,
    nativeQuery: string,
    maxResults: number,
  ): Promise<Array<{ id: string; threadId?: string }>> {
    const messageRefs: Array<{ id: string; threadId?: string }> = [];
    let pageToken: string | undefined;

    do {
      const pageSize = Math.min(100, maxResults - messageRefs.length);
      const params = new URLSearchParams({
        maxResults: String(pageSize),
      });
      if (nativeQuery) params.set('q', nativeQuery);
      if (pageToken) params.set('pageToken', pageToken);

      const response = await this.authorizedRequest(
        `${this.apiBaseUrl}/users/${encodeURIComponent(this.userId)}/messages?${params.toString()}`,
        accessToken,
      );
      const payload = await readJson<GmailListResponse>(response, 'Gmail message list');

      for (const message of payload.messages ?? []) {
        if (!message.id) continue;
        messageRefs.push({ id: message.id, threadId: message.threadId });
        if (messageRefs.length >= maxResults) break;
      }

      pageToken = payload.nextPageToken;
    } while (pageToken && messageRefs.length < maxResults);

    return messageRefs;
  }

  private async getMessage(accessToken: string, messageId: string): Promise<GmailMessageResponse> {
    const params = new URLSearchParams({ format: 'full' });
    const response = await this.authorizedRequest(
      `${this.apiBaseUrl}/users/${encodeURIComponent(this.userId)}/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
      accessToken,
    );
    return readJson<GmailMessageResponse>(response, `Gmail message ${messageId}`);
  }

  private async authorizedRequest(url: string, accessToken: string): Promise<GmailFetchResponse> {
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Gmail API request failed with status ${response.status}: ${await safeErrorText(response)}`);
    }

    return response;
  }

  private async getAccessToken(): Promise<string> {
    const configuredAccessToken = this.credentials.accessToken?.trim();
    if (configuredAccessToken) return configuredAccessToken;

    if (this.cachedAccessToken && this.accessTokenExpiresAt > this.now()) {
      return this.cachedAccessToken;
    }

    const response = await this.fetchImpl(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.credentials.clientId!,
        client_secret: this.credentials.clientSecret!,
        refresh_token: this.credentials.refreshToken!,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Google OAuth token refresh failed with status ${response.status}: ${await safeErrorText(response)}`);
    }

    const payload = await readJson<GmailTokenResponse>(response, 'Google OAuth token refresh');
    const accessToken = payload.access_token?.trim();
    if (!accessToken) {
      throw new Error('Google OAuth token refresh response did not include access_token.');
    }

    const expiresInSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
    this.cachedAccessToken = accessToken;
    this.accessTokenExpiresAt = this.now() + Math.max(60, expiresInSeconds - 60) * 1000;
    return accessToken;
  }
}

export function buildNativeGmailQuery(query: SafeEmailQuery): string {
  const parts: string[] = [];
  const queryText = query.query.trim();
  if (queryText) parts.push(queryText);
  if (query.label?.trim()) parts.push(`label:"${escapeGmailQueryValue(query.label.trim())}"`);
  if (query.newerThanDays && query.newerThanDays > 0) {
    parts.push(`newer_than:${Math.floor(query.newerThanDays)}d`);
  }
  return parts.join(' ');
}

export function mapGmailMessage(message: GmailMessageResponse, now: () => number = () => Date.now()): SafeEmailMessage {
  if (!message.id) throw new Error('Gmail message payload is missing id.');

  const headers = message.payload?.headers ?? [];
  const subject = getHeader(headers, 'subject') || '(no subject)';
  const from = getHeader(headers, 'from');
  const receivedAt = resolveReceivedAt(message, headers, now);
  const body = extractPreferredBody(message.payload) || message.snippet?.trim() || '';
  const sourceUrl = extractFirstUrl(body);

  return {
    id: message.id,
    threadId: message.threadId,
    provider: 'gmail',
    from,
    subject,
    body,
    receivedAt,
    labels: message.labelIds,
    sourceUrl,
    metadata: {
      historyId: message.historyId,
      gmailInternalDate: message.internalDate,
      readOnlySource: true,
    },
  };
}

function validateCredentials(credentials: GmailApiCredentials): void {
  if (credentials.accessToken?.trim()) return;

  const missing = [
    ['clientId', credentials.clientId],
    ['clientSecret', credentials.clientSecret],
    ['refreshToken', credentials.refreshToken],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Gmail credentials require accessToken or OAuth refresh credentials. Missing: ${missing.join(', ')}.`);
  }
}

function extractPreferredBody(payload?: GmailMessagePart): string {
  if (!payload) return '';

  const plainBodies: string[] = [];
  const htmlBodies: string[] = [];
  collectBodies(payload, plainBodies, htmlBodies);

  const plain = plainBodies.map((value) => value.trim()).filter(Boolean).join('\n\n').trim();
  if (plain) return plain;

  return htmlBodies
    .map(htmlToText)
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function collectBodies(part: GmailMessagePart, plainBodies: string[], htmlBodies: string[]): void {
  const mimeType = part.mimeType?.toLowerCase();
  const data = part.body?.data;

  if (data && (!part.filename || part.filename.trim() === '')) {
    const decoded = decodeBase64Url(data);
    if (mimeType === 'text/plain') plainBodies.push(decoded);
    if (mimeType === 'text/html') htmlBodies.push(decoded);
    if (!mimeType && !part.parts?.length) plainBodies.push(decoded);
  }

  for (const child of part.parts ?? []) {
    collectBodies(child, plainBodies, htmlBodies);
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<\/div\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function resolveReceivedAt(message: GmailMessageResponse, headers: GmailHeader[], now: () => number): string {
  const internalDate = Number(message.internalDate);
  if (Number.isFinite(internalDate) && internalDate > 0) {
    return new Date(internalDate).toISOString();
  }

  const dateHeader = getHeader(headers, 'date');
  const parsedDate = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  return new Date(Number.isFinite(parsedDate) ? parsedDate : now()).toISOString();
}

function getHeader(headers: GmailHeader[], name: string): string | undefined {
  const value = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim();
  return value || undefined;
}

function extractFirstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)<>"']+/i);
  return match?.[0]?.replace(/[.,;]+$/, '');
}

async function readJson<T>(response: GmailFetchResponse, label: string): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

async function safeErrorText(response: GmailFetchResponse): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    return text.slice(0, 300) || 'No error body returned.';
  } catch {
    return 'Unable to read error body.';
  }
}

function escapeGmailQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
