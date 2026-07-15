export const maxDuration = 300;

// Retained core contracts: Tender & RFP Pipeline; Refresh tenders & documents; Jawad’s queue.
// validateStoredTenderLead; Open one-page bid/no-bid brief; Changed — re-review.
export default {
  async fetch(request: Request): Promise<Response> {
    const shell = await import('../vercel/dedicated-page-shell.js');
    return shell.serveDedicatedWorkspace(request, () => import('./tenders-core.js'), {
      activeRoute: '/tenders',
      eyebrow: 'Formal procurement intelligence',
      title: 'Tender & RFP Pipeline',
      description: 'Review validated procurement opportunities, bid/no-bid briefs, deadlines, risks and retained source evidence.',
      scopeMode: 'tenders',
    });
  },
};
