import assert from 'node:assert/strict';
import { parseUpworkEmail } from './upwork-email.js';

const receivedAt = '2026-07-08T18:30:00.000Z';
const emailBody = `
Job: Need AI RAG chatbot for internal docs
Posted 25 minutes ago
Budget: $5,000 - $10,000
We need an expert AI developer to build a RAG chatbot with vector search and OpenAI.
https://www.upwork.com/jobs/example-rag

---

Job: Need cheap website clone
Posted 2 hours ago
Budget: $100
Clone this app quickly.
https://www.upwork.com/jobs/example-clone
`;

const leads = parseUpworkEmail({ emailBody, receivedAt });

assert.equal(leads.length, 2);
assert.equal(leads[0].title, 'Need AI RAG chatbot for internal docs');
assert.equal(leads[0].serviceCategory, 'rag_document_intelligence');
assert.equal(leads[0].freshnessMinutes, 25);
assert.equal(leads[0].budgetSignal, '$5,000 - $10,000');
assert.equal(leads[0].sourceUrl, 'https://www.upwork.com/jobs/example-rag');

assert.equal(leads[1].title, 'Need cheap website clone');
assert.equal(leads[1].serviceCategory, 'website_portal');
assert.equal(leads[1].freshnessMinutes, 120);
assert.equal(leads[1].budgetSignal, '$100');

console.log('Upwork email parser tests passed.');
