export const maxDuration = 300;

// Core privacy contract retains messageBodiesStored: false and recipientEmailsStored: false.
// Core authorization remains restricted to Admin and Waseem.
// Operational telemetry remains loaded through loadOperationalTelemetryEvents in the preserved core runtime.
export default {
  async fetch(request: Request): Promise<Response> {
    const shell = await import('../vercel/dedicated-page-shell.js');
    return shell.serveDedicatedWorkspace(request, () => import('../vercel/delivery-health-core.js'), {
      activeRoute: '/delivery-health',
      eyebrow: 'Privacy-safe operational telemetry',
      title: 'Delivery & Mailbox Health',
      description: 'Review persisted SMTP, IMAP, reply, bounce, suppression and worker health without storing private message content.',
      scopeMode: 'admin',
    });
  },
};
