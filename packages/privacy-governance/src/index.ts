import {createHash} from 'node:crypto';

export const PRIVACY_GOVERNANCE_VERSION = 'extension-privacy.v1';
export const RETENTION_POLICY_VERSION = 'acquisition-retention.v1';

export type ExtensionId = 'linkedin_sales_navigator' | 'upwork';
export type DashboardScopeKind = 'all' | 'team' | 'own';
export type DiagnosticAccessLevel = 'full_redacted' | 'scoped_summary' | 'own_summary' | 'none';
export type RetentionClass =
  | 'transient_extension_status'
  | 'parser_diagnostics'
  | 'successful_outbox'
  | 'unresolved_outbox'
  | 'source_evidence'
  | 'audit_and_version_pins';

export interface ExtensionPermissionReview {
  extension: ExtensionId;
  manifestVersion: 3;
  extensionVersion: string;
  permissions: Array<{
    permission: 'tabs' | 'storage' | 'scripting' | 'alarms';
    required: true;
    justification: string;
    usageEvidence: string[];
  }>;
  hostPermissions: Array<{
    pattern: string;
    purpose: string;
    dataBoundary: string;
  }>;
  prohibitedPermissions: string[];
  cookiesCaptured: false;
  privateMessagesCaptured: false;
  remoteCodeAllowed: false;
  externalActionAutomated: false;
}

export interface RetentionRule {
  class: RetentionClass;
  durationDays?: number;
  trigger: string;
  automaticDeletionAllowed: boolean;
  protectedWhen: string[];
  deletionOutcome: string;
}

export interface PrivacyAccessDecision {
  actor: string;
  scopeKind: DashboardScopeKind;
  diagnostics: DiagnosticAccessLevel;
  canViewPermissionInventory: boolean;
  canViewRetentionPolicy: boolean;
  canExportRedactedDiagnostics: boolean;
  canPlanDeletion: boolean;
  canExecuteDeletion: false;
  rawSecretsVisible: false;
  privateMessagesVisible: false;
}

export interface RetentionSubject {
  class: RetentionClass;
  createdAt: string;
  terminalAt?: string;
  resolvedAt?: string;
  legalHold?: boolean;
  unresolved?: boolean;
  auditRequired?: boolean;
}

export interface RetentionDecision {
  version: typeof RETENTION_POLICY_VERSION;
  class: RetentionClass;
  action: 'retain' | 'archive' | 'manual_deletion_eligible';
  reason: string;
  eligibleAt?: string;
  automaticDeletionAllowed: false;
  stateRootPreserved: true;
  auditTombstoneRequired: true;
}

export interface DeletionPlan {
  version: 'privacy-deletion-plan.v1';
  actor: string;
  requestedAt: string;
  stateRoot: string;
  targets: string[];
  rejectedTargets: Array<{target: string; reason: string}>;
  retainAuditTombstones: true;
  preserveUnresolvedOutbox: true;
  preserveRollbackState: true;
  executeAutomatically: false;
  humanApprovalRequired: true;
  planHash: string;
}

const PROHIBITED_PERMISSIONS = [
  'activeTab',
  'cookies',
  'webRequest',
  'webRequestBlocking',
  'history',
  'downloads',
  'nativeMessaging',
  'clipboardRead',
  'clipboardWrite',
  'declarativeNetRequest',
  '<all_urls>',
];

export const EXTENSION_PERMISSION_REVIEWS: Record<ExtensionId, ExtensionPermissionReview> = {
  linkedin_sales_navigator: {
    extension: 'linkedin_sales_navigator',
    manifestVersion: 3,
    extensionVersion: '1.6.1',
    permissions: [
      {
        permission: 'tabs',
        required: true,
        justification: 'Open registered LinkedIn or Sales Navigator searches in inactive tabs, inspect completion/redirect state, message the approved content script and close the scheduled tab.',
        usageEvidence: ['chrome.tabs.create', 'chrome.tabs.get', 'chrome.tabs.sendMessage', 'chrome.tabs.onUpdated', 'chrome.tabs.remove'],
      },
      {
        permission: 'storage',
        required: true,
        justification: 'Store approved campaign definitions, scheduler preference and bounded operational status only.',
        usageEvidence: ['chrome.storage.local.get', 'chrome.storage.local.set'],
      },
      {
        permission: 'scripting',
        required: true,
        justification: 'Re-inject repository-bundled content scripts only when an approved page has not yet received them.',
        usageEvidence: ['chrome.scripting.executeScript'],
      },
      {
        permission: 'alarms',
        required: true,
        justification: 'Run bounded approved-search capture schedules without background polling.',
        usageEvidence: ['chrome.alarms.create', 'chrome.alarms.get', 'chrome.alarms.clear', 'chrome.alarms.onAlarm'],
      },
    ],
    hostPermissions: [
      {pattern: 'https://www.linkedin.com/*', purpose: 'Approved warm-demand and Sales Navigator pages.', dataBoundary: 'Visible public/professional page evidence only; login, checkpoint and messaging surfaces are excluded.'},
      {pattern: 'https://sales.linkedin.com/*', purpose: 'Licensed Sales Navigator lead-search compatibility.', dataBoundary: 'Visible lead-card evidence only; no private messages or credentials.'},
      {pattern: 'http://127.0.0.1:8775/*', purpose: 'Local warm-demand collector.', dataBoundary: 'Loopback transport only.'},
      {pattern: 'http://127.0.0.1:8785/*', purpose: 'Local Sales Navigator collector.', dataBoundary: 'Loopback transport only.'},
    ],
    prohibitedPermissions: PROHIBITED_PERMISSIONS,
    cookiesCaptured: false,
    privateMessagesCaptured: false,
    remoteCodeAllowed: false,
    externalActionAutomated: false,
  },
  upwork: {
    extension: 'upwork',
    manifestVersion: 3,
    extensionVersion: '1.1.1',
    permissions: [
      {
        permission: 'tabs',
        required: true,
        justification: 'Open approved saved searches in inactive tabs, verify page state, message bundled content scripts and close scheduled tabs.',
        usageEvidence: ['chrome.tabs.create', 'chrome.tabs.get', 'chrome.tabs.sendMessage', 'chrome.tabs.onUpdated', 'chrome.tabs.remove'],
      },
      {
        permission: 'storage',
        required: true,
        justification: 'Store scheduler preference, approved-search status and bounded capture results only.',
        usageEvidence: ['chrome.storage.local.get', 'chrome.storage.local.set'],
      },
      {
        permission: 'scripting',
        required: true,
        justification: 'Re-inject repository-bundled content scripts only on approved Upwork pages when needed.',
        usageEvidence: ['chrome.scripting.executeScript'],
      },
      {
        permission: 'alarms',
        required: true,
        justification: 'Run bounded approved saved-search schedules without continuous background polling.',
        usageEvidence: ['chrome.alarms.create', 'chrome.alarms.get', 'chrome.alarms.clear', 'chrome.alarms.onAlarm'],
      },
    ],
    hostPermissions: [
      {pattern: 'https://www.upwork.com/*', purpose: 'Approved saved-search and job-card capture.', dataBoundary: 'Visible job and client evidence only; proposals, messages and account settings are excluded.'},
      {pattern: 'http://127.0.0.1:8765/*', purpose: 'Local Upwork collector.', dataBoundary: 'Loopback transport only.'},
    ],
    prohibitedPermissions: PROHIBITED_PERMISSIONS,
    cookiesCaptured: false,
    privateMessagesCaptured: false,
    remoteCodeAllowed: false,
    externalActionAutomated: false,
  },
};

export const RETENTION_RULES: RetentionRule[] = [
  {
    class: 'transient_extension_status',
    durationDays: 30,
    trigger: 'Last scheduler/capture status update.',
    automaticDeletionAllowed: false,
    protectedWhen: ['status documents an unresolved failure or active investigation'],
    deletionOutcome: 'Explicit scoped cleanup may remove expired status keys; campaign definitions and captured records remain.',
  },
  {
    class: 'parser_diagnostics',
    durationDays: 30,
    trigger: 'Diagnostic capture timestamp.',
    automaticDeletionAllowed: false,
    protectedWhen: ['linked to a parser regression, security investigation or unresolved dead-letter record'],
    deletionOutcome: 'Expired redacted diagnostics may be removed after human review; event counters and audit tombstones remain.',
  },
  {
    class: 'successful_outbox',
    durationDays: 90,
    trigger: 'Terminal applied, duplicate or merged reconciliation timestamp.',
    automaticDeletionAllowed: false,
    protectedWhen: ['reconciliation hash mismatch', 'seller-field dispute', 'rollback investigation'],
    deletionOutcome: 'Payload may be archived or removed from the active outbox while idempotency/reconciliation metadata remains.',
  },
  {
    class: 'unresolved_outbox',
    trigger: 'Resolution of pending, retrying, conflicted or dead-letter status.',
    automaticDeletionAllowed: false,
    protectedWhen: ['always until resolved'],
    deletionOutcome: 'Never delete automatically; resolve/replay first and retain original source evidence.',
  },
  {
    class: 'source_evidence',
    durationDays: 365,
    trigger: 'Opportunity becomes terminal (won, lost, rejected or archived).',
    automaticDeletionAllowed: false,
    protectedWhen: ['active opportunity', 'legal/contractual hold', 'open dispute', 'pilot or release evidence'],
    deletionOutcome: 'A targeted approved deletion may remove source payload after the period while retaining a non-sensitive audit tombstone and version pins.',
  },
  {
    class: 'audit_and_version_pins',
    durationDays: 730,
    trigger: 'Opportunity becomes terminal.',
    automaticDeletionAllowed: false,
    protectedWhen: ['legal/contractual hold', 'release/rollback dependency', 'unresolved reconciliation'],
    deletionOutcome: 'Retain event hashes, actors, timestamps, reason codes, offer/model versions and reconciliation outcomes; raw secrets are never part of this class.',
  },
];

export function privacyAccessFor(input: {
  actor: string;
  scopeKind: DashboardScopeKind;
  canRunGlobalOperations: boolean;
}): PrivacyAccessDecision {
  const actor = requiredText(input.actor, 'actor');
  const global = input.canRunGlobalOperations && input.scopeKind === 'all';
  const diagnostics: DiagnosticAccessLevel = global
    ? 'full_redacted'
    : input.scopeKind === 'team'
      ? 'scoped_summary'
      : input.scopeKind === 'own'
        ? 'own_summary'
        : 'none';
  return {
    actor,
    scopeKind: input.scopeKind,
    diagnostics,
    canViewPermissionInventory: true,
    canViewRetentionPolicy: true,
    canExportRedactedDiagnostics: global,
    canPlanDeletion: global,
    canExecuteDeletion: false,
    rawSecretsVisible: false,
    privateMessagesVisible: false,
  };
}

export function retentionDecision(subject: RetentionSubject, now = new Date().toISOString()): RetentionDecision {
  const rule = RETENTION_RULES.find((item) => item.class === subject.class);
  if (!rule) throw new Error('Unsupported retention class.');
  const nowDate = validDate(now, 'now');
  validDate(subject.createdAt, 'createdAt');
  if (subject.legalHold || subject.auditRequired) return decision(subject.class, 'retain', 'A legal, audit or release hold protects this record.');
  if (subject.class === 'unresolved_outbox' || subject.unresolved) return decision(subject.class, 'retain', 'Unresolved synchronization state must never be deleted automatically.');

  const trigger = subject.resolvedAt ?? subject.terminalAt ?? subject.createdAt;
  const triggerDate = validDate(trigger, 'retention trigger');
  if (!rule.durationDays) return decision(subject.class, 'retain', 'This class requires an explicit resolution before any deletion review.');
  const eligible = new Date(triggerDate.getTime() + rule.durationDays * 86_400_000);
  if (nowDate < eligible) {
    return decision(subject.class, subject.class === 'successful_outbox' ? 'archive' : 'retain', `Retention period remains active until ${eligible.toISOString()}.`, eligible.toISOString());
  }
  return decision(subject.class, 'manual_deletion_eligible', 'Retention period elapsed; a scoped human-approved deletion plan may be created.', eligible.toISOString());
}

export function createDeletionPlan(input: {
  actor: string;
  canRunGlobalOperations: boolean;
  stateRoot: string;
  targets: string[];
  requestedAt?: string;
}): DeletionPlan {
  if (!input.canRunGlobalOperations) throw new Error('Global operations permission is required to plan deletion.');
  const actor = requiredText(input.actor, 'actor');
  const stateRoot = normalizePath(requiredText(input.stateRoot, 'stateRoot'));
  if (!/codistan\/acquisition$/i.test(stateRoot)) throw new Error('State root must be the Codistan Acquisition directory.');
  const requestedAt = validDate(input.requestedAt ?? new Date().toISOString(), 'requestedAt').toISOString();
  const approved: string[] = [];
  const rejectedTargets: DeletionPlan['rejectedTargets'] = [];
  for (const rawTarget of [...new Set(input.targets.map((item) => normalizePath(item)).filter(Boolean))].slice(0, 100)) {
    if (rawTarget === stateRoot) {
      rejectedTargets.push({target: rawTarget, reason: 'The durable Acquisition state root can never be deleted.'});
      continue;
    }
    if (!rawTarget.startsWith(`${stateRoot}/`)) {
      rejectedTargets.push({target: rawTarget, reason: 'Target is outside the approved Acquisition state root.'});
      continue;
    }
    if (/\/sync\/(?:outbox|dead-letter|reconciliation)(?:\/|$)/i.test(rawTarget)) {
      rejectedTargets.push({target: rawTarget, reason: 'Synchronization and reconciliation state requires record-level retention review.'});
      continue;
    }
    if (/\/(?:rollback|release|audit)(?:\/|$)/i.test(rawTarget)) {
      rejectedTargets.push({target: rawTarget, reason: 'Rollback, release and audit state is protected.'});
      continue;
    }
    approved.push(rawTarget);
  }
  const base = {
    version: 'privacy-deletion-plan.v1' as const,
    actor,
    requestedAt,
    stateRoot,
    targets: approved,
    rejectedTargets,
    retainAuditTombstones: true as const,
    preserveUnresolvedOutbox: true as const,
    preserveRollbackState: true as const,
    executeAutomatically: false as const,
    humanApprovalRequired: true as const,
  };
  return {...base, planHash: sha256(stableStringify(base))};
}

export function permissionReview(extension: ExtensionId): ExtensionPermissionReview {
  return structuredClone(EXTENSION_PERMISSION_REVIEWS[extension]);
}

function decision(
  retentionClass: RetentionClass,
  action: RetentionDecision['action'],
  reason: string,
  eligibleAt?: string,
): RetentionDecision {
  return {
    version: RETENTION_POLICY_VERSION,
    class: retentionClass,
    action,
    reason,
    eligibleAt,
    automaticDeletionAllowed: false,
    stateRootPreserved: true,
    auditTombstoneRequired: true,
  };
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
}

function validDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date.`);
  return parsed;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
