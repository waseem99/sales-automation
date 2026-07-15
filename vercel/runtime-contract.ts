export type RuntimeRole = 'public' | 'admin' | 'team_lead' | 'bd_user';
export type RuntimeTarget = 'auth' | 'portfolio' | 'operations' | 'workspace' | 'priorities' | 'dashboard' | 'dedicated';
export type RuntimeResponseKind = 'html' | 'json' | 'redirect';

export interface RuntimeRouteContract {
  id: string;
  method: 'GET' | 'POST';
  samplePath: string;
  pattern: RegExp;
  target: RuntimeTarget;
  response: RuntimeResponseKind;
  access: readonly RuntimeRole[];
}

const AUTHENTICATED_ROLES = ['admin', 'team_lead', 'bd_user'] as const;
const ADMIN_ONLY = ['admin'] as const;

export const runtimeRouteContracts: readonly RuntimeRouteContract[] = [
  { id: 'health', method: 'GET', samplePath: '/health', pattern: /^\/health\/?$/, target: 'auth', response: 'json', access: ['public'] },
  { id: 'login-page', method: 'GET', samplePath: '/login', pattern: /^\/login\/?$/, target: 'auth', response: 'html', access: ['public'] },
  { id: 'login-action', method: 'POST', samplePath: '/api/login', pattern: /^\/api\/login\/?$/, target: 'auth', response: 'json', access: ['public'] },
  { id: 'logout-action', method: 'POST', samplePath: '/api/logout', pattern: /^\/api\/logout\/?$/, target: 'auth', response: 'json', access: AUTHENTICATED_ROLES },
  { id: 'session', method: 'GET', samplePath: '/api/session', pattern: /^\/api\/session\/?$/, target: 'auth', response: 'json', access: AUTHENTICATED_ROLES },
  { id: 'prospects', method: 'GET', samplePath: '/prospects', pattern: /^\/(?:|prospects)\/?$/, target: 'workspace', response: 'html', access: AUTHENTICATED_ROLES },
  { id: 'priorities', method: 'GET', samplePath: '/priorities', pattern: /^\/priorities\/?$/, target: 'priorities', response: 'html', access: AUTHENTICATED_ROLES },
  { id: 'lead-workspaces', method: 'GET', samplePath: '/leads/linkedin', pattern: /^\/leads\/(?:linkedin|upwork|rfq|rfp|eoi|rfi|tenders|research|partnerships)\/?$/, target: 'workspace', response: 'html', access: AUTHENTICATED_ROLES },
  { id: 'service-workspaces', method: 'GET', samplePath: '/services/software', pattern: /^\/services(?:\/(?:ai|software|cybersecurity|immersive|marketing))?\/?$/, target: 'workspace', response: 'html', access: AUTHENTICATED_ROLES },
  { id: 'signal-intake', method: 'GET', samplePath: '/lead-signals', pattern: /^\/lead-signals\/?$/, target: 'dedicated', response: 'html', access: ADMIN_ONLY },
  { id: 'linkedin-signals', method: 'GET', samplePath: '/linkedin-signals', pattern: /^\/linkedin-signals\/?$/, target: 'dedicated', response: 'html', access: ADMIN_ONLY },
  { id: 'tenders', method: 'GET', samplePath: '/tenders', pattern: /^\/tenders\/?$/, target: 'dedicated', response: 'html', access: AUTHENTICATED_ROLES },
  { id: 'portfolio', method: 'GET', samplePath: '/portfolio', pattern: /^\/portfolio\/?$/, target: 'portfolio', response: 'html', access: AUTHENTICATED_ROLES },
  { id: 're-engagement', method: 'GET', samplePath: '/re-engagement', pattern: /^\/re-engagement\/?$/, target: 'dedicated', response: 'html', access: ADMIN_ONLY },
  { id: 'operations', method: 'GET', samplePath: '/operations', pattern: /^\/operations\/?$/, target: 'operations', response: 'html', access: AUTHENTICATED_ROLES },
  { id: 'delivery-health', method: 'GET', samplePath: '/delivery-health', pattern: /^\/delivery-health\/?$/, target: 'dedicated', response: 'html', access: ADMIN_ONLY },
  { id: 'portfolio-catalog-api', method: 'GET', samplePath: '/api/portfolio-catalog', pattern: /^\/api\/portfolio-catalog\/?$/, target: 'portfolio', response: 'json', access: AUTHENTICATED_ROLES },
  { id: 'portfolio-catalog-mutation', method: 'POST', samplePath: '/api/portfolio-catalog', pattern: /^\/api\/portfolio-catalog\/?$/, target: 'portfolio', response: 'json', access: ADMIN_ONLY },
  { id: 'source-controls-mutation', method: 'POST', samplePath: '/api/source-controls', pattern: /^\/api\/source-controls\/?$/, target: 'operations', response: 'json', access: ADMIN_ONLY },
  { id: 'closeability-rescore', method: 'POST', samplePath: '/api/closeability-rescore', pattern: /^\/api\/closeability-rescore\/?$/, target: 'priorities', response: 'json', access: ADMIN_ONLY },
] as const;

export function normalizeRuntimePath(value: string): string {
  const pathname = value.startsWith('/') ? value : `/${value}`;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function resolveRuntimeRoute(pathname: string, method: string): RuntimeRouteContract | undefined {
  const normalizedPath = normalizeRuntimePath(pathname);
  const normalizedMethod = method.toUpperCase();
  return runtimeRouteContracts.find((route) => route.method === normalizedMethod && route.pattern.test(normalizedPath));
}

export function roleCanAccessRoute(route: RuntimeRouteContract, role: RuntimeRole): boolean {
  return route.access.includes(role);
}

export class RuntimeBoundaryError extends Error {
  readonly operation: string;
  override readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Runtime boundary failed during ${operation}: ${message}`);
    this.name = 'RuntimeBoundaryError';
    this.operation = operation;
    this.cause = cause;
  }
}

export async function loadRuntimeBoundary<T>(operation: string, loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw error instanceof RuntimeBoundaryError ? error : new RuntimeBoundaryError(operation, error);
  }
}

export interface RuntimeFailure {
  referenceId: string;
  operation: string;
  message: string;
  stack?: string;
}

export function runtimeFailureDetails(error: unknown, fallbackOperation: string): RuntimeFailure {
  const cause = error instanceof RuntimeBoundaryError ? error.cause : error;
  const normalized = cause instanceof Error ? { message: cause.message, stack: cause.stack } : { message: String(cause), stack: undefined };
  return {
    referenceId: createRuntimeReferenceId(),
    operation: error instanceof RuntimeBoundaryError ? error.operation : fallbackOperation,
    message: normalized.message,
    stack: normalized.stack,
  };
}

export function runtimeErrorResponse(request: Request, failure: RuntimeFailure): Response {
  const headers = {
    ...runtimeSecurityHeaders(),
    'cache-control': 'no-store',
    'x-runtime-reference': failure.referenceId,
  };
  const acceptsHtml = request.headers.get('accept')?.includes('text/html') ?? false;
  if (!acceptsHtml) {
    return new Response(JSON.stringify({
      error: 'Application runtime failed.',
      operation: failure.operation,
      referenceId: failure.referenceId,
    }), {
      status: 500,
      headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prospect Desk unavailable</title></head><body style="font-family:system-ui;background:#f8fafc;padding:40px"><main style="max-width:760px;margin:auto;background:#fff;padding:28px;border-radius:16px"><h1>Prospect Desk could not complete this request</h1><p>The failure occurred during <strong>${escapeRuntimeHtml(failure.operation)}</strong>.</p><p>Retry the request or return to <a href="/prospects">Prospect Desk</a>.</p><p>Reference: <code>${escapeRuntimeHtml(failure.referenceId)}</code></p></main></body></html>`, {
    status: 500,
    headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
  });
}

export function runtimeSecurityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}

function createRuntimeReferenceId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
    ?? Math.random().toString(36).slice(2, 14);
  return `rt-${Date.now().toString(36)}-${random}`;
}

function escapeRuntimeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}
