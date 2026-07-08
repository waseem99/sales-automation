export type UserRole = 'admin' | 'founder' | 'bd_manager' | 'reviewer' | 'read_only';

export type Permission =
  | 'view_opportunities'
  | 'ingest_leads'
  | 'update_pipeline_status'
  | 'assign_owner'
  | 'add_notes'
  | 'mark_alert_sent'
  | 'view_private_portfolio'
  | 'manage_sensitive_settings'
  | 'manage_compliance_rules'
  | 'manage_users';

export interface AccessDecision {
  allowed: boolean;
  role: UserRole;
  permission: Permission;
  reason: string;
}

export const rolePermissions: Record<UserRole, readonly Permission[]> = {
  admin: [
    'view_opportunities',
    'ingest_leads',
    'update_pipeline_status',
    'assign_owner',
    'add_notes',
    'mark_alert_sent',
    'view_private_portfolio',
    'manage_sensitive_settings',
    'manage_compliance_rules',
    'manage_users',
  ],
  founder: [
    'view_opportunities',
    'ingest_leads',
    'update_pipeline_status',
    'assign_owner',
    'add_notes',
    'mark_alert_sent',
    'view_private_portfolio',
    'manage_sensitive_settings',
    'manage_compliance_rules',
  ],
  bd_manager: [
    'view_opportunities',
    'ingest_leads',
    'update_pipeline_status',
    'assign_owner',
    'add_notes',
    'mark_alert_sent',
  ],
  reviewer: [
    'view_opportunities',
    'update_pipeline_status',
    'add_notes',
    'mark_alert_sent',
  ],
  read_only: ['view_opportunities'],
};

export function can(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export function checkPermission(role: UserRole, permission: Permission): AccessDecision {
  const allowed = can(role, permission);
  return {
    allowed,
    role,
    permission,
    reason: allowed
      ? `${role} can perform ${permission}.`
      : `${role} is not allowed to perform ${permission}.`,
  };
}

export function assertPermission(role: UserRole, permission: Permission): void {
  const decision = checkPermission(role, permission);
  if (!decision.allowed) {
    throw new Error(`Forbidden: ${decision.reason}`);
  }
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && value in rolePermissions;
}
