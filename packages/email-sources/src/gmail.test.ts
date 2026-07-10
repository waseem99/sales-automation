import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  buildNativeGmailQuery,
  GmailApiEmailSourceAdapter,
  mapGmailMessage,
  type GmailFetch,
  type GmailFetchResponse,
} from './index.js';

function jsonResponse(value: unknown, status = 200): GmailFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
    async text() {
      return JSON.stringify(value);
    },
  };
}

function encodeBody(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

const requestedUrls: string[] = [];
const requestedAuthHeaders: string[] = [];
let tokenRequests = 0;

const fetchImpl: GmailFetch = async (input, init) => {
  requestedUrls.push(input);

  if (input === 'https://oauth.example.test/token') {
    tokenRequests += 1;
    assert.equal(init?.method, 'POST');
    assert.match(init?.body ?? '', /grant_type=refresh_token/);
    assert.match(init?.body ?? '', /refresh_token=refresh-token/);
    return jsonResponse({ access_token: 'refreshed-access-token', expires_in: 3600 });
  }

  requestedAuthHeaders.push(init?.headers?.authorization ?? '');

  if (input.startsWith('https://gmail.example.test/gmail/v1/users/me/messages?')) {
    const url = new URL(input);
    assert.equal(url.searchParams.get('maxResults'), '10');
    assert.equal(
      url.searchParams.get('q'),
      'from:(upwork.com) label:"Lead Alerts" newer_than:3d',
    );
    return jsonResponse({
      messages: [
        { id: 'message-plain', threadId: 'thread-1' },
        { id: 'message-html', threadId: 'thread-2' },
      ],
    });
  }

  if (input.includes('/messages/message-plain?format=full')) {
    return jsonResponse({
      id: 'message-plain',
      threadId: 'thread-1',
      labelIds: ['INBOX', 'Label_Lead_Alerts'],
      internalDate: '1783751400000',
      historyId: '1001',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'Upwork Alerts <alerts@upwork.com>' },
          { name: 'Subject', value: 'New Upwork job: RAG chatbot' },
        ],
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: encodeBody('Job: Build a RAG chatbot\nhttps://www.upwork.com/jobs/~012345\nBudget: $5,000'),
            },
          },
          {
            mimeType: 'text/html',
            body: {
              data: encodeBody('<p>HTML fallback should not replace plain text.</p>'),
            },
          },
        ],
      },
    });
  }

  if (input.includes('/messages/message-html?format=full')) {
    return jsonResponse({
      id: 'message-html',
      threadId: 'thread-2',
      labelIds: ['INBOX'],
      payload: {
        mimeType: 'text/html',
        headers: [
          { name: 'From', value: 'notifications@linkedin.com' },
          { name: 'Subject', value: 'Sales Navigator alert' },
          { name: 'Date', value: 'Sat, 11 Jul 2026 09:15:00 +0500' },
        ],
        body: {
          data: encodeBody('<div>Looking for an <strong>AI automation</strong> partner.</div><div>https://www.linkedin.com/in/example</div>'),
        },
      },
    });
  }

  return jsonResponse({ error: 'not found' }, 404);
};

const query = {
  query: 'from:(upwork.com)',
  label: 'Lead Alerts',
  newerThanDays: 3,
  maxResults: 10,
};

assert.equal(
  buildNativeGmailQuery(query),
  'from:(upwork.com) label:"Lead Alerts" newer_than:3d',
);

const adapter = new GmailApiEmailSourceAdapter({
  credentials: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
  },
  fetchImpl,
  now: () => Date.parse('2026-07-11T04:30:00.000Z'),
  apiBaseUrl: 'https://gmail.example.test/gmail/v1',
  tokenEndpoint: 'https://oauth.example.test/token',
});

const messages = await adapter.searchMessages(query);
assert.equal(messages.length, 2);
assert.equal(messages[0].provider, 'gmail');
assert.equal(messages[0].subject, 'New Upwork job: RAG chatbot');
assert.match(messages[0].body, /Build a RAG chatbot/);
assert.doesNotMatch(messages[0].body, /HTML fallback/);
assert.equal(messages[0].sourceUrl, 'https://www.upwork.com/jobs/~012345');
assert.equal(messages[1].receivedAt, '2026-07-11T04:15:00.000Z');
assert.match(messages[1].body, /AI automation partner/);
assert.equal(messages[1].sourceUrl, 'https://www.linkedin.com/in/example');
assert.ok(requestedAuthHeaders.every((header) => header === 'Bearer refreshed-access-token'));
assert.equal(tokenRequests, 1);

await adapter.searchMessages(query);
assert.equal(tokenRequests, 1, 'OAuth access token should be reused until its refresh window.');

const mappedFallback = mapGmailMessage({
  id: 'snippet-only',
  snippet: 'Upwork snippet only',
  payload: {
    headers: [{ name: 'Subject', value: 'Snippet fallback' }],
  },
}, () => Date.parse('2026-07-11T05:00:00.000Z'));
assert.equal(mappedFallback.body, 'Upwork snippet only');
assert.equal(mappedFallback.receivedAt, '2026-07-11T05:00:00.000Z');

assert.throws(
  () => new GmailApiEmailSourceAdapter({ credentials: {} }),
  /Missing: clientId, clientSecret, refreshToken/,
);

assert.ok(requestedUrls.some((url) => url.includes('/users/me/messages?')));
console.log('Gmail API adapter tests passed.');
