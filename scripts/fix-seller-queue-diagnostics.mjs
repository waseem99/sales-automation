import fs from 'node:fs';

const sourcePath = 'packages/seller-queues/src/index.ts';
const workflowPath = '.github/workflows/fix-seller-queue-diagnostics.yml';
const scriptPath = 'scripts/fix-seller-queue-diagnostics.mjs';
let source = fs.readFileSync(sourcePath, 'utf8');
const needle = "  const diagnostics = Object.fromEntries(QUEUE_IDS.map((id) => [id, []])) as Record<SellerQueueId, string[]>;";
const replacement = "  const diagnostics = {} as Record<SellerQueueId, string[]>;\n  for (const queueId of QUEUE_IDS) diagnostics[queueId] = [];";
if (!source.includes(needle)) throw new Error('Seller queue diagnostics initialization point changed.');
source = source.replace(needle, replacement);
fs.writeFileSync(sourcePath, source, 'utf8');
for (const path of [workflowPath, scriptPath]) if (fs.existsSync(path)) fs.unlinkSync(path);
console.log('Seller queue diagnostics typing fixed.');
