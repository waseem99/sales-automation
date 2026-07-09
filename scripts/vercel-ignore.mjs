const ref = process.env.VERCEL_GIT_COMMIT_REF || '';
const allowedRefs = new Set(['main', 'fix-vercel-preview']);

if (allowedRefs.has(ref)) {
  console.log(`Vercel deployment allowed for branch: ${ref}`);
  process.exit(1);
}

console.log(`Vercel deployment skipped for branch: ${ref || 'unknown'}. Use GitHub CI for PR checks and deploy the real app through Docker/Render.`);
process.exit(0);
