export interface SalesAutomationHttpRequest {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

export interface SalesAutomationHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Compatibility boundary for URLs from the retired local Lead Desk.
 *
 * The production application is the Prospect Desk. Legacy opportunity and
 * ingestion routes are intentionally not exposed by Vercel. This small handler
 * remains temporarily so stale internal calls receive a deterministic response
 * while the application no longer depends on the old dashboard, auth,
 * controller, or worker packages.
 */
export function handleSalesAutomationRequest(
  request: SalesAutomationHttpRequest,
  _retiredContext?: unknown,
): SalesAutomationHttpResponse {
  return {
    status: 410,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({
      error: 'This legacy Lead Desk route has been retired.',
      path: request.path,
      replacement: '/prospects',
    }),
  };
}
