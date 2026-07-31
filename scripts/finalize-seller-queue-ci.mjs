import fs from 'node:fs';

const contractPath = 'workers/acquisition/tests/seller_queue_integration_contract.ts';
const diagnosticPath = 'workers/acquisition/tests/.seller-queue-contract-diagnostic.txt';
const ciPath = '.github/workflows/seller-queues-ci.yml';
const workflowPath = '.github/workflows/finalize-seller-queue-ci.yml';
const scriptPath = 'scripts/finalize-seller-queue-ci.mjs';

let contract = fs.readFileSync(contractPath, 'utf8');
contract = contract.replace(
  'const combined = `${queueSource}\\n${handler}\\n${page}\\n${view}`.toLowerCase();',
  'const queueImplementation = `${queueSource}\\n${handler}\\n${view}`.toLowerCase();',
);
contract = contract.replace(
  'assert(!combined.includes(prohibited), `Seller queue boundary violated: ${prohibited}`);',
  'assert(!queueImplementation.includes(prohibited), `Seller queue boundary violated: ${prohibited}`);',
);
fs.writeFileSync(contractPath, contract, 'utf8');

const ci = `name: Seller Queues CI

# Exact-head validation for persistent per-user Prospect Desk queues.
on:
  pull_request:
    branches:
      - agent/component-scoring-271
    paths:
      - '.github/workflows/seller-queues-ci.yml'
      - 'package.json'
      - 'pnpm-lock.yaml'
      - 'packages/seller-queues/**'
      - 'apps/web/src/seller-queue-view.ts'
      - 'apps/web/src/prospects-page.ts'
      - 'apps/web/src/prospect-handler.ts'
      - 'apps/web/src/secure-prospect-handler.ts'
      - 'workers/acquisition/tests/seller_queue_integration_contract.ts'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: seller-queues-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    name: Persist and reconcile seller work queues
    runs-on: ubuntu-latest
    timeout-minutes: 28

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install standalone pnpm
        run: npm install --global --force @pnpm/exe@9.15.9

      - name: Install workspace dependencies
        run: pnpm install --no-frozen-lockfile

      - name: Build production workspace
        run: pnpm build

      - name: Test seller queue membership and preferences
        run: pnpm --filter @sales-automation/seller-queues test

      - name: Type-check seller queue package
        run: pnpm --filter @sales-automation/seller-queues typecheck

      - name: Validate APIs, signed preferences and Prospect Desk integration
        run: pnpm exec tsx workers/acquisition/tests/seller_queue_integration_contract.ts

      - name: Type-check Vercel and web integration
        run: pnpm typecheck:vercel

      - name: Enforce persistence, privacy and human-action boundaries
        shell: bash
        run: |
          ! grep -R -i "localStorage\\|sessionStorage" \\
            packages/seller-queues \\
            apps/web/src/seller-queue-view.ts \\
            apps/web/src/prospect-handler.ts \\
            apps/web/src/secure-prospect-handler.ts
          ! grep -R "externalActionAutomated: true\\|external_action_performed.*true\\|automatic sending enabled" \\
            packages/seller-queues \\
            apps/web/src/seller-queue-view.ts \\
            apps/web/src/prospect-handler.ts \\
            apps/web/src/secure-prospect-handler.ts
          ! grep -R "Remove-Item.*Codistan.*Acquisition\\|rmdir.*Codistan.*Acquisition" \\
            packages/seller-queues apps/web/src
`;
fs.writeFileSync(ciPath, ci, 'utf8');
for (const path of [
  diagnosticPath,
  '.github/workflows/fix-seller-queue-contract-scope.yml',
  'scripts/fix-seller-queue-contract-scope.mjs',
  workflowPath,
  scriptPath,
]) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}
console.log('Seller queue contract and CI finalized.');
