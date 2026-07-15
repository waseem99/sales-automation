type ScopeMode = 'admin' | 'tenders';

export interface DedicatedWorkspaceShellOptions {
  activeRoute: string;
  eyebrow: string;
  title: string;
  description: string;
  scopeMode: ScopeMode;
}

interface RuntimeHandler {
  fetch(request: Request): Promise<Response>;
}

const ACTOR_COOKIE = 'codistan_admin_actor';
const displayNames: Record<string, string> = {
  admin: 'Administrator',
  'waseem@codistan.org': 'Waseem Khan',
  'talha.bashir@codistan.org': 'Talha Bashir',
  'jawad.jutt@codistan.org': 'Jawad Jutt',
  'moiz.khalid@codistan.org': 'Moiz Khalid',
  'subainaaamir@codistan.org': 'Subaina Aamir',
  'danishkhalid@codistan.org': 'Danish Khalid',
  'hibasohail@codistan.org': 'Hiba Sohail',
  'bilalahmed@codistan.org': 'Bilal Ahmed',
};

export async function serveDedicatedWorkspace(request: Request, loadHandler: () => Promise<unknown>, options: DedicatedWorkspaceShellOptions): Promise<Response> {
  const handler = resolveHandler(await loadHandler());
  return applyDedicatedWorkspaceShell(request, await handler.fetch(request), options);
}

export async function applyDedicatedWorkspaceShell(request: Request, response: Response, options: DedicatedWorkspaceShellOptions): Promise<Response> {
  if (response.status < 200 || response.status >= 300) return response;
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return response;
  const fallback = response.clone();
  try {
    const layout = await import('./dedicated-page-layout.js');
    const identifier = actorIdentifier(request.headers.get('cookie'));
    const wrapped = await layout.applyDedicatedPageLayout(await response.text(), {
      ...options,
      actor: displayNames[identifier] ?? identifier,
      scopeLabel: scopeLabelFor(identifier, options.scopeMode),
    });
    if (!wrapped.includes('id="workspace-sidebar"') || !wrapped.includes(`href="${options.activeRoute}"`)) throw new Error(`Shared shell did not attach to ${options.activeRoute}.`);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('x-prospect-shell', 'shared-v2');
    return new Response(wrapped, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    console.error('DEDICATED_WORKSPACE_SHELL_ERROR', { route: options.activeRoute, error: error instanceof Error ? error.message : String(error) });
    return fallback;
  }
}

function resolveHandler(module: unknown): RuntimeHandler {
  const first = (module as { default?: unknown }).default;
  const candidate = (first as { default?: unknown } | undefined)?.default ?? first;
  if (!candidate || typeof (candidate as { fetch?: unknown }).fetch !== 'function') throw new Error('Dedicated workspace module must expose a fetch handler.');
  return candidate as RuntimeHandler;
}

function actorIdentifier(cookieHeader: string | null): string {
  const token = parseCookies(cookieHeader ?? '')[ACTOR_COOKIE];
  if (!token) return 'admin';
  const match = token.match(/^([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/);
  if (!match?.[1]) return 'Authenticated user';
  try { return Buffer.from(match[1], 'base64url').toString('utf8').trim().toLowerCase() || 'Authenticated user'; }
  catch { return 'Authenticated user'; }
}

function scopeLabelFor(identifier: string, mode: ScopeMode): string {
  if (mode === 'admin') return 'Admin/Waseem · all company data';
  if (identifier === 'admin' || identifier === 'waseem@codistan.org') return 'All company tenders';
  if (identifier === 'talha.bashir@codistan.org') return 'Talha team tenders';
  return 'My assigned tenders';
}

function parseCookies(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) result[name] = rest.join('=');
  }
  return result;
}
