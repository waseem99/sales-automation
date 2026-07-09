import type { Lead, PortfolioItem } from '@sales-automation/shared';

export interface PortfolioMatch {
  portfolioItem: PortfolioItem;
  score: number;
  matchedTags: string[];
  reasons: string[];
}

export interface MatchPortfolioInput {
  lead: Lead;
  portfolioItems: PortfolioItem[];
  limit?: number;
  includePrivate?: boolean;
}

const confidentialityScore = {
  public: 12,
  anonymized: 8,
  private: 2,
} as const;

export function matchPortfolio(input: MatchPortfolioInput): PortfolioMatch[] {
  const limit = input.limit ?? 3;
  const normalizedLeadText = normalizeText(`${input.lead.title} ${input.lead.description} ${input.lead.industry ?? ''}`);

  return input.portfolioItems
    .filter((item) => input.includePrivate || item.confidentiality !== 'private')
    .map((item) => scorePortfolioItem(input.lead, normalizedLeadText, item))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function scorePortfolioItem(lead: Lead, normalizedLeadText: string, item: PortfolioItem): PortfolioMatch {
  const matchedTags = item.tags.filter((tag) => normalizedLeadText.includes(normalizeText(tag)));
  const reasons: string[] = [];
  let score = 0;

  if (item.serviceCategories.includes(lead.serviceCategory)) {
    score += 45;
    reasons.push(`Service category matches ${lead.serviceCategory}.`);
  }

  if (lead.industry && item.industry && normalizeText(lead.industry) === normalizeText(item.industry)) {
    score += 15;
    reasons.push(`Industry matches ${lead.industry}.`);
  }

  if (matchedTags.length > 0) {
    score += Math.min(25, matchedTags.length * 5);
    reasons.push(`Matched tags: ${matchedTags.join(', ')}.`);
  }

  score += confidentialityScore[item.confidentiality];
  reasons.push(`Proof confidentiality is ${item.confidentiality}.`);

  if (item.assetUrls.length > 0) {
    score += 8;
    reasons.push('Portfolio item has assets/links available.');
  }

  if (item.businessOutcome) {
    score += 5;
    reasons.push('Portfolio item includes a business outcome.');
  }

  return {
    portfolioItem: item,
    score: Math.min(100, score),
    matchedTags,
    reasons,
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
