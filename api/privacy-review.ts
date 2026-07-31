import {createHash, timingSafeEqual} from 'node:crypto';
import {
  EXTENSION_PERMISSION_REVIEWS,
  privacyAccessFor,
  PRIVACY_GOVERNANCE_VERSION,
  RETENTION_POLICY_VERSION,
  RETENTION_RULES,
} from '@sales-automation/privacy-governance';
import {resolveDashboardAccess} from '../apps/web/src/dashboard-access.js';

export const maxDuration = 30;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET') return responseJson({error: 'Method not allowed.'}, 405, {allow: 'GET'});
      authenticate(request);
      const actor = requiredText(request.headers.get('x-codistan-actor'), 'x-codistan-actor');
      const dashboardAccess = resolveDashboardAccess(actor);
      const access = privacyAccessFor({
        actor: dashboardAccess.identifier,
        scopeKind: dashboardAccess.scopeKind,
        canRunGlobalOperations: dashboardAccess.canRunGlobalOperations,
      });
      const url = new URL(request.url);
      const includeDetails = url.searchParams.get('detail') === 'full' && access.diagnostics === 'full_redacted';
      return responseJson({
        version: PRIVACY_GOVERNANCE_VERSION,
        retentionVersion: RETENTION_POLICY_VERSION,
        access,
        permissionSummary: Object.values(EXTENSION_PERMISSION_REVIEWS).map((review) => ({
          extension: review.extension,
          extensionVersion: review.extensionVersion,
          permissions: review.permissions.map((permission) => permission.permission),
          hostPermissionCount: review.hostPermissions.length,
          prohibitedPermissions: review.prohibitedPermissions,
          cookiesCaptured: false,
          privateMessagesCaptured: false,
          remoteCodeAllowed: false,
          externalActionAutomated: false,
        })),
        permissionDetails: includeDetails ? EXTENSION_PERMISSION_REVIEWS : undefined,
        retentionRules: RETENTION_RULES,
        diagnostics: {
          accessLevel: access.diagnostics,
          rawSecretsVisible: false,
          privateMessagesVisible: false,
          exportAllowed: access.canExportRedactedDiagnostics,
        },
        deletion: {
          planningAllowed: access.canPlanDeletion,
          executionAvailable: false,
          humanApprovalRequired: true,
          stateRootPreserved: true,
        },
        humanReviewRequired: true,
        externalActionAutomated: false,
      });
    } catch (error) {
      const message = safeErrorMessage(error);
      const status = message === 'Unauthorized.' ? 401 : message.includes('required') ? 400 : 500;
      return responseJson({error: message, humanReviewRequired: true, externalActionAutomated: false}, status, status === 401 ? {'www-authenticate': 'Bearer'} : {});
    }
  },
};

function authenticate(request: Request): void {
  const configured = requireEnvironment('ACQUISITION_INGEST_TOKEN');
  const supplied = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1]?.trim();
  if (!supplied || !safeEqual(supplied, configured)) throw new Error('Unauthorized.');
}

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
}

function responseJson(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
      ...extraHeaders,
    },
  });
}
