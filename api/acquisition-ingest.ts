export const maxDuration = 300;

export default {
  async fetch(request: Request): Promise<Response> {
    const runtime = await import('../vercel/acquisition-ingest-runtime.js');
    return runtime.handleAcquisitionIngest(request);
  },
};
