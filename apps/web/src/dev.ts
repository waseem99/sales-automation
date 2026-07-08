import { createSalesAutomationDashboardApi } from '@sales-automation/api';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { renderDashboardPage } from './index.js';

const generatedAt = new Date().toISOString();
const repository = new InMemoryLeadRepository();

for (const lead of sampleLeads) {
  repository.saveEvaluation(
    evaluateLead({
      lead,
      portfolioItems: samplePortfolioItems,
      generatedAt,
    }),
    'web-dev',
  );
}

const api = createSalesAutomationDashboardApi(repository);
const opportunities = api.listOpportunities({ now: generatedAt });
const selectedLead = opportunities[0] ? api.getLeadDetail(opportunities[0].id, generatedAt) : undefined;
const html = renderDashboardPage({
  title: 'Codistan Lead Desk — Local Preview',
  summary: api.getDashboardSummary(generatedAt),
  opportunities,
  selectedLead,
});

console.log(html);
