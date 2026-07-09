import type { UserRole } from '@sales-automation/access-control';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  name?: string;
  role: UserRole;
  isActive: boolean;
}

export interface AuthRequestContext {
  headers?: Record<string, string | string[] | undefined>;
  sessionToken?: string;
}

export interface ResolvedSession {
  authenticated: boolean;
  user?: AuthenticatedUser;
  role: UserRole;
  actor: string;
  reason: string;
}

export interface SessionAdapter {
  readonly provider: string;
  resolveUser(request: AuthRequestContext): AuthenticatedUser | undefined;
}

export interface ResolveSessionOptions {
  adapter?: SessionAdapter;
  fallbackRole?: UserRole;
  fallbackActor?: string;
}

export class StaticSessionAdapter implements SessionAdapter {
  readonly provider = 'static';
  private readonly usersByToken: Map<string, AuthenticatedUser>;

  constructor(usersByToken: Record<string, AuthenticatedUser>) {
    this.usersByToken = new Map(Object.entries(usersByToken));
  }

  resolveUser(request: AuthRequestContext): AuthenticatedUser | undefined {
    const token = request.sessionToken ?? extractBearerToken(request.headers?.authorization) ?? getHeaderValue(request.headers, 'x-sales-automation-session');
    if (!token) return undefined;
    return this.usersByToken.get(token);
  }
}

export function resolveSession(request: AuthRequestContext = {}, options: ResolveSessionOptions = {}): ResolvedSession {
  const fallbackRole = options.fallbackRole ?? 'read_only';
  const fallbackActor = options.fallbackActor ?? 'anonymous';

  if (!options.adapter) {
    return {
      authenticated: false,
      role: fallbackRole,
      actor: fallbackActor,
      reason: 'No session adapter configured; using safe fallback role.',
    };
  }

  const user = options.adapter.resolveUser(request);
  if (!user) {
    return {
      authenticated: false,
      role: fallbackRole,
      actor: fallbackActor,
      reason: 'No matching session found; using safe fallback role.',
    };
  }

  if (!user.isActive) {
    return {
      authenticated: false,
      role: fallbackRole,
      actor: fallbackActor,
      reason: `User ${user.id} is inactive; using safe fallback role.`,
    };
  }

  return {
    authenticated: true,
    user,
    role: user.role,
    actor: formatActor(user),
    reason: `Resolved active user through ${options.adapter.provider}.`,
  };
}

export function formatActor(user: AuthenticatedUser): string {
  return user.email ?? user.name ?? user.id;
}

export function normalizeHeaders(headers?: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}

export function getHeaderValue(headers: AuthRequestContext['headers'], name: string): string | undefined {
  const normalized = normalizeHeaders(headers);
  return normalized[name.toLowerCase()];
}

function extractBearerToken(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}
