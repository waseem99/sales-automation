#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import type { Lead } from '@sales-automation/shared';

function main(): void {
  const [, , command, arg] = process.argv;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'sample') {
    evaluateSample(arg);
    return;
  }

  if (command === 'json') {
    evaluateJsonFile(arg);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function evaluateSample(leadId?: string): void {
  const lead = leadId ? sampleLeads.find((item) => item.id === leadId) : sampleLeads[0];

  if (!lead) {
    throw new Error(`Sample lead not found: ${leadId}`);
  }

  const evaluation = evaluateLead({
    lead,
    portfolioItems: samplePortfolioItems,
  });

  printEvaluation(evaluation);
}

function evaluateJsonFile(filePath?: string): void {
  if (!filePath) {
    throw new Error('Missing JSON file path. Usage: pnpm evaluate:json ./lead.json');
  }

  const raw = readFileSync(filePath, 'utf8');
  const lead = JSON.parse(raw) as Lead;

  const evaluation = evaluateLead({
    lead,
    portfolioItems: samplePortfolioItems,
  });

  printEvaluation(evaluation);
}

function printEvaluation(evaluation: ReturnType<typeof evaluateLead>): void {
  const output = {
    leadId: evaluation.lead.id,
    title: evaluation.lead.title,
    source: evaluation.lead.source,
    leadType: evaluation.lead.leadType,
    score: evaluation.score.total,
    status: evaluation.score.status,
    urgency: evaluation.score.urgency,
    scoreBreakdown: evaluation.score.breakdown,
    redFlags: evaluation.score.redFlags,
    recommendedProfile: evaluation.profileRecommendation.primaryProfile,
    profileConfidence: evaluation.profileRecommendation.confidence,
    profileReasons: evaluation.profileRecommendation.reasons,
    profileRisks: evaluation.profileRecommendation.risks,
    matchedPortfolio: evaluation.portfolioMatches.map((match) => ({
      id: match.portfolioItem.id,
      projectName: match.portfolioItem.projectName,
      score: match.score,
      matchedTags: match.matchedTags,
      reasons: match.reasons,
    })),
    recommendedNextAction: evaluation.recommendedNextAction,
    explanation: evaluation.score.explanation,
  };

  console.log(JSON.stringify(output, null, 2));
}

function printHelp(): void {
  console.log(`Codistan Sales Automation CLI\n\nCommands:\n  sample [leadId]      Evaluate a bundled sample lead\n  json <filePath>      Evaluate a lead from a JSON file\n\nExamples:\n  pnpm evaluate:sample\n  pnpm evaluate:sample lead-upwork-rag-001\n  pnpm evaluate:json ./lead.json\n`);
}

main();
