export const maxDuration = 300;

export default {
  async fetch(request: Request): Promise<Response> {
    const shell = await import('../vercel/dedicated-page-shell.js');
    return shell.serveDedicatedWorkspace(request, () => import('../vercel/lead-signals-core.js'), {
      activeRoute: '/lead-signals',
      eyebrow: 'Unified controlled intake',
      title: 'Lead Signals',
      description: 'Review saved-search and professional-network opportunity signals in one controlled workspace.',
      scopeMode: 'admin',
    });
  },
};
