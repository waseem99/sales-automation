import assert from 'node:assert/strict';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import {
  buildGmailReadOnlyQuery,
  classifyEmailMessage,
  InMemoryEmailSourceAdapter,
  ingestEmailSource,
  type SafeEmailMessage,
} from './index.js';

const receivedAt = '2026-07-09T06:00:00.000Z';
const messages: SafeEmailMessage[] = [
  {
    id: 'gmail-upwork-001',
    provider: 'gmail',
    from: 'alerts@upwork.com',
    subject: 'New Upwork job alert: AI RAG chatbot',
    body: `Job: Need AI RAG chatbot for internal knowledge base\nhttps://www.upwork.com/jobs/gmail-rag-001\nWe need an expert AI developer for RAG, OpenAI, vector search, and a dashboard. Budget: $5,000 - $10,000. Posted 20 minutes ago.`,
    receivedAt,
    labels: ['INBOX', 'Lead Alerts'],
  },
  {
    id: 'gmail-upwork-duplicate',
    provider: 'gmail',
    from: 'alerts@upwork.com',
    subject: 'Duplicate Upwork job alert: AI RAG chatbot',
    body: `Job: Duplicate AI RAG chatbot\nhttps://www.upwork.com/jobs/gmail-rag-001/\nSame job duplicate. Budget: $5,000. Posted 20 minutes ago.`,
    receivedAt,
    labels: ['INBOX', 'Lead Alerts'],
  },
  {
    id: 'gmail-linkedin-001',
    provider: 'gmail',
    from: 'notifications@linkedin.com',
    subject: 'Sales Navigator saved search alert',
    body: `LinkedIn Sales Navigator alert. Posted 35 minutes ago. Looking for AI automation expert to help with internal support workflows. https://www.linkedin.com/feed/update/gmail-ai-001`,
    receivedAt,
    labels: ['INBOX', 'Lead Alerts'],
  },
  {
    id: 'gmail-random-001',
    provider: 'gmail',
    from: 'newsletter@example.com',
    subject: 'Weekly newsletter',
    body: 'This is a regular newsletter and should not become a lead.',
    receivedAt,
    labels: ['INBOX'],
  },
];

assert.equal(classifyEmailMessage(messages[0]).intent, 'upwork_email');
assert.equal(classifyEmailMessage(messages[2]).intent, 'linkedin_signal');
assert.equal(classifyEmailMessage(messages[3]).intent, 'unsupported');

const query = buildGmailReadOnlyQuery({
  terms: ['upwork'],
  label: 'Lead Alerts',
  newerThanDays: 7,
  maxResults: 10,
});
assert.equal(query.query, 'upwork');
assert.equal(query.label, 'Lead Alerts');

const adapter = new InMemoryEmailSourceAdapter(messages, 'gmail');
const queriedMessages = adapter.searchMessages(query);
assert.equal(queriedMessages.length, 2);
assert.ok(queriedMessages.every((message) => message.subject.toLowerCase().includes('upwork')));

const repository = new InMemoryLeadRepository();
const result = await ingestEmailSource({
  adapter: new InMemoryEmailSourceAdapter(messages, 'gmail'),
  query: buildGmailReadOnlyQuery({ terms: [], label: 'Lead Alerts', maxResults: 10 }),
  repository,
  portfolioItems: samplePortfolioItems,
  actor: 'gmail-ingestion-test',
  generatedAt: receivedAt,
});

assert.equal(result.provider, 'gmail');
assert.equal(result.totalMessages, 3);
assert.equal(result.processedMessages, 3);
assert.equal(result.skippedMessages, 0);
assert.equal(result.totalCaptured, 2);
assert.equal(result.totalDuplicates, 1);
assert.equal(repository.listLeads().length, 2);
assert.ok(result.safetyNotes.some((note) => note.includes('read-only')));

const unsupportedOnly = await ingestEmailSource({
  messages: [messages[3]],
  repository,
  portfolioItems: samplePortfolioItems,
  generatedAt: receivedAt,
});
assert.equal(unsupportedOnly.totalMessages, 1);
assert.equal(unsupportedOnly.processedMessages, 0);
assert.equal(unsupportedOnly.skippedMessages, 1);
assert.equal(unsupportedOnly.results[0].skippedReason, 'Email does not look like a supported Upwork or LinkedIn/Sales Navigator lead signal.');

await assert.rejects(
  () => ingestEmailSource({ repository, portfolioItems: samplePortfolioItems }),
  /Either messages or a read-only email source adapter is required/,
);

console.log('Email source ingestion tests passed.');
