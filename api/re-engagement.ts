export const maxDuration = 300;

export default {
  async fetch(request: Request): Promise<Response> {
    const shell = await import('../vercel/dedicated-page-shell.js');
    return shell.serveDedicatedWorkspace(request, () => import('./re-engagement-core.js'), {
      activeRoute: '/re-engagement',
      eyebrow: 'Admin/Waseem workflow',
      title: 'Re-engagement Campaigns',
      description: 'Manage previous clients and trusted partner relationships.',
      scopeMode: 'admin',
    });
  },
};
