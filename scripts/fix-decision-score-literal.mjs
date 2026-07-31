import fs from 'node:fs';

const sourcePath = 'packages/decision-scoring/src/index.ts';
const workflowPath = '.github/workflows/fix-decision-score-literal.yml';
const scriptPath = 'scripts/fix-decision-score-literal.mjs';
let source = fs.readFileSync(sourcePath, 'utf8');
const needle = '    version: DECISION_SCORE_VERSION,\n    weights: DECISION_SCORE_WEIGHTS,';
const replacement = '    version: DECISION_SCORE_VERSION as typeof DECISION_SCORE_VERSION,\n    weights: DECISION_SCORE_WEIGHTS,';
if (!source.includes(needle)) throw new Error('Decision score literal insertion point changed.');
source = source.replace(needle, replacement);
fs.writeFileSync(sourcePath, source, 'utf8');
for (const path of [workflowPath, scriptPath]) if (fs.existsSync(path)) fs.unlinkSync(path);
console.log('Decision score version literal fixed.');
