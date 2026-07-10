import {
  ingestLinkedInSignal,
  ingestUpworkEmail,
  type IngestionResult,
} from '@sales-automation/ingestion';
import type { PortfolioItem } from '@sales-automation/shared';
import type { LeadRepository } from '@sales-automation/storage';

export type EmailSourceProvider = 'gmail' | 'imap' | 'manual_email_import' | 'mock';
export type EmailLeadIntent = 'upwork_email' | 'linkedin_signal' | 'unsupported';

export interface SafeEmailQuery {
  query: string;
  label?: string;
  newerThanDays?: number;
  maxResults?: number;
}

export interface SafeEmailMessage {
  id: string;
  threadId?: string;
  provider: EmailSourceProvider;
  from?: string;
  subject: string;
  body: string;
  receivedAt: string;
  labels?: string[];
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailSourceAdapter {
  provider: EmailSourceProvider;
  readonly readOnly: true;
  searchMessages(query: SafeEmailQuery): Promise<SafeEmailMessage[]> | SafeEmailMessage[];
}

export interface EmailClassification {
  messageId: string;
  intent: EmailLeadIntent;
  confidence: number;
  reason: string;
  sourceUrl?: string;
}

export interface EmailMessageIngestionResult {
  message: SafeEmailMessage;
  classification: EmailClassification;
  ingestion?: IngestionResult;
  skippedReason?: string;
}

export interface EmailIngestionRunResult {
  provider: EmailSourceProvider;
  query?: SafeEmailQuery;
  totalMessages: number;
  processedMessages: number;
  skippedMessages: number;
  totalCaptured: number;
  totalDuplicates: number;
  results: EmailMessageIngestionResult[];
  safetyNotes: string[];
}

export interface IngestEmailSourceInput {
  adapter?: EmailSourceAdapter;
  query?: SafeEmailQuery;
  messages?: SafeEmailMessage[];
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  actor?: string;
  generatedAt?: string;
  includePrivatePortfolio?: boolean;
}

export class InMemoryEmailSourceAdapter implements EmailSourceAdapter {
  readonly provider: EmailSourceProvider;
  readonly readOnly = true as const;
  private readonly messages: SafeEmailMessage[];

  constructor(messages: SafeEmailMessage[], provider: EmailSourceProvider = 'mock') {
    this.messages = messages;
    this.provider = provider;
  }

  searchMessages(query: SafeEmailQuery): SafeEmailMessage[] {
    const queryText = query.query.trim().toLowerCase();
    const maxResults = query.maxResults ?? this.messages.length;
    const cutoff = query.newerThanDays ? Date.now() - query.newerThanDays * 24 * 60 * 60 * 1000 : undefined;

    return this.messages
      .filter((message) => !query.label || message.labels?.includes(query.label))
      .filter((message) => !cutoff || Date.parse(message.receivedAt) >= cutoff)
      .filter((message) => {
        if (!queryText) return true;
        const haystack = `${message.from ?? ''} ${message.subject} ${message.body}`.toLowerCase();
        return queryText.split(/\s+/).every((term) => haystack.includes(term));
      })
      .slice(0, maxResults);
  }
}

export async function ingestEmailSource(input: IngestEmailSourceInput): Promise<EmailIngestionRunResult> {
  const messages = input.messages ?? await readFromAdapter(input.adapter, input.query);
  const provider = input.adapter?.provider ?? messages[0]?.provider ?? 'manual_email_import';
  const results: EmailMessageIngestionResult[] = [];

  for (const message of messages) {
    const classification = classifyEmailMessage(message);
    if (classification.intent === 'unsupported') {
      results.push({
        message,
        classification,
        skippedReason: 'Email does not look like a supported Upwork or LinkedIn/Sales Navigator lead signal.',
      });
      continue;
    }

    if (classification.intent === 'upwork_email') {
      const ingestion = ingestUpworkEmail({
        email: {
          emailBody: message.body,
          receivedAt: message.receivedAt,
        },
        repository: input.repository,
        portfolioItems: input.portfolioItems,
        actor: input.actor ?? 'email-source-upwork',
        generatedAt: input.generatedAt ?? message.receivedAt,
        includePrivatePortfolio: input.includePrivatePortfolio,
      });
      results.push({ message, classification, ingestion });
      continue;
    }

    const ingestion = ingestLinkedInSignal({
      signal: {
        text: message.body,
        capturedAt: message.receivedAt,
        sourceUrl: classification.sourceUrl ?? message.sourceUrl,
      },
      repository: input.repository,
      portfolioItems: input.portfolioItems,
      actor: input.actor ?? 'email-source-linkedin',
      generatedAt: input.generatedAt ?? message.receivedAt,
      includePrivatePortfolio: input.includePrivatePortfolio,
    });
    results.push({ message, classification, ingestion });
  }

  return {
    provider,
    query: input.query,
    totalMessages: messages.length,
    processedMessages: results.filter((result) => Boolean(result.ingestion)).length,
    skippedMessages: results.filter((result) => !result.ingestion).length,
    totalCaptured: results.reduce((total, result) => total + (result.ingestion?.totalCaptured ?? 0), 0),
    totalDuplicates: results.reduce((total, result) => total + (result.ingestion?.totalSkipped ?? 0), 0),
    results,
    safetyNotes: [
      'Email source adapters are read-only.',
      'No email is sent, archived, deleted, labeled, or modified by this package.',
      'Lead dedupe and scoring are delegated to the ingestion/evaluator pipeline.',
      'Unsupported emails are skipped without side effects.',
    ],
  };
}

export function classifyEmailMessage(message: SafeEmailMessage): EmailClassification {
  const text = `${message.from ?? ''}\n${message.subject}\n${message.body}`.toLowerCase();
  const sourceUrl = message.sourceUrl ?? extractFirstUrl(message.body);

  if (text.includes('upwork') || text.includes('upwork.com/jobs')) {
    return {
      messageId: message.id,
      intent: 'upwork_email',
      confidence: text.includes('upwork.com/jobs') ? 0.95 : 0.75,
      reason: 'Email contains Upwork sender/subject/body signal.',
      sourceUrl,
    };
  }

  if (text.includes('linkedin') || text.includes('sales navigator') || text.includes('linkedin.com')) {
    return {
      messageId: message.id,
      intent: 'linkedin_signal',
      confidence: text.includes('linkedin.com') || text.includes('sales navigator') ? 0.9 : 0.7,
      reason: 'Email contains LinkedIn or Sales Navigator lead signal.',
      sourceUrl,
    };
  }

  if (text.includes('looking for') && (text.includes('developer') || text.includes('agency') || text.includes('automation') || text.includes('ai '))) {
    return {
      messageId: message.id,
      intent: 'linkedin_signal',
      confidence: 0.55,
      reason: 'Email contains a generic warm buying-signal phrase but no platform source marker.',
      sourceUrl,
    };
  }

  return {
    messageId: message.id,
    intent: 'unsupported',
    confidence: 0,
    reason: 'No supported lead-source signal detected.',
    sourceUrl,
  };
}

export function buildGmailReadOnlyQuery(input: {
  terms: string[];
  label?: string;
  newerThanDays?: number;
  maxResults?: number;
}): SafeEmailQuery {
  return {
    query: input.terms.map((term) => term.trim()).filter(Boolean).join(' '),
    label: input.label,
    newerThanDays: input.newerThanDays,
    maxResults: input.maxResults,
  };
}

async function readFromAdapter(adapter?: EmailSourceAdapter, query?: SafeEmailQuery): Promise<SafeEmailMessage[]> {
  if (!adapter) {
    throw new Error('Either messages or a read-only email source adapter is required.');
  }
  if (!adapter.readOnly) {
    throw new Error('Email source adapter must be read-only.');
  }
  return adapter.searchMessages(query ?? { query: '', maxResults: 25 });
}

function extractFirstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match?.[0]?.replace(/[.,;]+$/, '');
}

export * from './gmail.js';
