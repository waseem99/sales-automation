import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { LocalJsonLeadRepository } from '@sales-automation/storage';
import { evaluateLead } from '@sales-automation/evaluator';
import { createSalesAutomationHttpServer } from './server.js';

const generatedAt = new Date().toISOString();
const port = Number(process.env.PORT ?? 3000);
const storagePath = process.env.LOCAL_LEAD_STORE_PATH ?? '.data/leads.json';
const repository = new LocalJsonLeadRepository({ filePath: storagePath });

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
  actor: 'web-dev',
  now: () => new Date().toISOString(),
});

server.listen(port, () => {
  console.log(`Codistan Lead Desk running at http://localhost:${port}`);
  console.log(`Local lead store: ${storagePath}`);
});
