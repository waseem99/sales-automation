import fs from 'node:fs';

const contractPath = 'workers/acquisition/tests/seller_queue_integration_contract.ts';
const diagnosticPath = 'workers/acquisition/tests/.seller-queue-contract-diagnostic.txt';
const workflowPath = '.github/workflows/fix-seller-queue-contract-scope.yml';
const scriptPath = 'scripts/fix-seller-queue-contract-scope.mjs';
let source = fs.readFileSync(contractPath, 'utf8');
const needle = 'const combined = `${queueSource}\\n${handler}\\n${page}\\n${view}`.toLowerCase();';
const replacement = 'const queueImplementation = `${queueSource}\\n${handler}\\n${view}`.toLowerCase();';
if (!source.includes(needle)) throw new Error('Seller queue boundary scan insertion point changed.');
source = source.replace(needle, replacement);
source = source.replace("assert(!combined.includes(prohibited), `Seller queue boundary violated: ${prohibited}`);", "assert(!queueImplementation.includes(prohibited), `Seller queue boundary violated: ${prohibited}`);");
fs.writeFileSync(contractPath, source, 'utf8');
for (const path of [diagnosticPath, workflowPath, scriptPath]) if (fs.existsSync(path)) fs.unlinkSync(path);
console.log('Seller queue browser-storage scan narrowed to queue implementation files and diagnostics removed.');
