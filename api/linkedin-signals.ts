export const maxDuration = 300;

// Authorization remains restricted to Admin and Waseem in linkedin-signals-core.ts.
export default {
  async fetch(request: Request): Promise<Response> {
    const shell = await import('../vercel/dedicated-page-shell.js');
    return shell.serveDedicatedWorkspace(request, () => import('./linkedin-signals-core.js'), {
      activeRoute: '/linkedin-signals',
      eyebrow: 'Compliant warm-signal intake',
      title: 'LinkedIn & Sales Navigator Signals',
      description: 'Qualify buyer-side LinkedIn and Sales Navigator signals while keeping every external action human-reviewed.',
      scopeMode: 'admin',
    });
  },
};
