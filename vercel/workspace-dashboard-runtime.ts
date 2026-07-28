import {
  handleWorkspaceDashboardRuntime as handleWorkspaceDashboardRuntimeJs,
  isWorkspaceDashboardPath as isWorkspaceDashboardPathJs,
} from './workspace-dashboard-runtime.js';

export function isWorkspaceDashboardPath(pathname: string): boolean {
  return isWorkspaceDashboardPathJs(pathname);
}

export async function handleWorkspaceDashboardRuntime(input: unknown): Promise<Response> {
  return handleWorkspaceDashboardRuntimeJs(input);
}
