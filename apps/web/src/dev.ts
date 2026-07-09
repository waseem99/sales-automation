import { StaticSessionAdapter } from '@sales-automation/auth';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { LocalJsonLeadRepository } from '@sales-automation/storage';
import { createSalesAutomationHttpServer } from './server.js';

const generatedAt = new Date().toISOString();
const port = Number(process.env.PORT ?? 3000);
const storagePath = process.env.LOCAL_LEAD_STORE_PATH ?? '.data/leads.json';
const repository = new LocalJsonLeadRepository({ filePath: storagePath });
const devSessionAdapter = new StaticSessionAdapter({
  'dev-founder-token': {
    id: 'dev-founder',
    email: 'dev@codistan.org',
    name: 'Codistan Dev Founder',
    role: 'founder',
    isActive: true,
  },
});

if (repository.listLeads().length === 0) {
  for (const lead of sampleLeads) {
    repository.saveEvaluation(
      evaluateLead({
        lead,
        portfolioItems: samplePortfolioItems,
        generatedAt,
      }),
      'web-dev-seed',
    );
  }
}

const server = createSalesAutomationHttpServer({
  repository,
  portfolioItems: samplePortfolioItems,
  sessionAdapter: devSessionAdapter,
  now: () => new Date().toISOString(),
});

server.listen(port, () => {
  console.log(`Codistan Lead Desk running at http://localhost:${port}`);
  console.log(`Local lead store: ${storagePath}`);
  console.log('Dev session token enabled for local form submissions only: dev-founder-token');
});
