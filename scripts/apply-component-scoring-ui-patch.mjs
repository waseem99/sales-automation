import fs from 'node:fs';

const pagePath = 'apps/web/src/prospects-page.ts';
const workflowPath = '.github/workflows/apply-component-scoring-ui-patch.yml';
const scriptPath = 'scripts/apply-component-scoring-ui-patch.mjs';
let source = fs.readFileSync(pagePath, 'utf8');

const importNeedle = "import type { StoredLeadRecord } from '@sales-automation/storage';\nimport {";
const importReplacement = "import type { StoredLeadRecord } from '@sales-automation/storage';\nimport { renderDecisionScorePanel } from './decision-score-view.js';\nimport {";
if (!source.includes(importNeedle)) throw new Error('Prospect Desk import insertion point changed.');
source = source.replace(importNeedle, importReplacement);

const panelNeedle = `  <section class="detail-section evidence"><h3>Why this prospect is here</h3><p>\${escapeHtml(lead.evidenceSummary ?? lead.description)}</p><p><strong>Recommended contact method:</strong> \${escapeHtml(lead.reachMethod ?? 'Research the most relevant public contact route.')}</p><div class="evidence-links">\${link(lead.evidenceUrl ?? lead.sourceUrl, 'Open source evidence')} \${link(lead.companyWebsite, 'Open company website')} \${portfolioUrl ? link(portfolioUrl, 'Open portfolio library') : ''}</div><small>Source: \${escapeHtml(lead.discoverySource ?? lead.source)} · Discovered \${escapeHtml(formatDateTime(lead.discoveredAt ?? lead.capturedAt))}</small></section>\n\n  <section class="detail-section service-box">`;
const panelReplacement = `  <section class="detail-section evidence"><h3>Why this prospect is here</h3><p>\${escapeHtml(lead.evidenceSummary ?? lead.description)}</p><p><strong>Recommended contact method:</strong> \${escapeHtml(lead.reachMethod ?? 'Research the most relevant public contact route.')}</p><div class="evidence-links">\${link(lead.evidenceUrl ?? lead.sourceUrl, 'Open source evidence')} \${link(lead.companyWebsite, 'Open company website')} \${portfolioUrl ? link(portfolioUrl, 'Open portfolio library') : ''}</div><small>Source: \${escapeHtml(lead.discoverySource ?? lead.source)} · Discovered \${escapeHtml(formatDateTime(lead.discoveredAt ?? lead.capturedAt))}</small></section>\n\n  \${renderDecisionScorePanel(lead)}\n\n  <section class="detail-section service-box">`;
if (!source.includes(panelNeedle)) throw new Error('Prospect Desk detail insertion point changed.');
source = source.replace(panelNeedle, panelReplacement);

fs.writeFileSync(pagePath, source, 'utf8');
for (const path of [workflowPath, scriptPath]) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}
console.log('Prospect Desk decision score panel integrated and one-shot patch files removed.');
