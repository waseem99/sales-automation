export {
  handleProspectDashboardRequest,
  type ProspectDashboardContext,
  type ProspectDashboardRequest,
  type ProspectDashboardResponse,
} from './auto-prospect-handler.js';
export {
  accessScopePayload,
  canAccessLead,
  resolveDashboardAccess,
  scopeRecords,
  type DashboardAccessScope,
} from './dashboard-access.js';
export { createProspectDashboardHttpServer } from './prospect-server.js';
