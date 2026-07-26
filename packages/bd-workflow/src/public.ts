import type { Lead } from '@sales-automation/shared';
import {
  BD_WORKFLOW_VERSION,
  attachBdWorkflow,
  bdWorkflowStateEqual,
  createBdTask as createBaseTask,
  readBdWorkflow,
  recordBdPipelineEvent as recordBasePipelineEvent,
  refreshBdWorkflow as refreshBaseWorkflow,
  updateBdTask as updateBaseTask,
  type BdTask,
  type BdTaskStatus,
  type BdWorkflowSnapshot,
  type CreateBdTaskInput,
  type UpdateBdTaskInput,
} from './index.js';

export {
  BD_WORKFLOW_VERSION,
  attachBdWorkflow,
  bdWorkflowStateEqual,
  readBdWorkflow,
};

export type {
  BdChannel,
  BdTask,
  BdTaskCode,
  BdTaskPriority,
  BdTaskStatus,
  BdWorkflowEvent,
  BdWorkflowEventType,
  BdWorkflowSnapshot,
  CreateBdTaskInput,
  NextBestAction,
  UpdateBdTaskInput,
} from './index.js';

const PRESERVED_GENERATED_STATUSES = new Set<BdTaskStatus>(['completed', 'dismissed', 'on_hold']);

export function refreshBdWorkflow(
  lead: Lead,
  generatedAt = new Date().toISOString(),
  actor = 'bd-workflow',
  eventSummary?: string,
): BdWorkflowSnapshot {
  return reconcileLifecycle(
    lead,
    refreshBaseWorkflow(lead, generatedAt, actor, eventSummary),
    generatedAt,
    actor,
  );
}

export function createBdTask(
  lead: Lead,
  input: CreateBdTaskInput,
  actor: string,
  generatedAt = new Date().toISOString(),
): BdWorkflowSnapshot {
  return reconcileLifecycle(
    lead,
    createBaseTask(lead, input, actor, generatedAt),
    generatedAt,
    actor,
  );
}

export function updateBdTask(
  lead: Lead,
  taskId: string,
  input: UpdateBdTaskInput,
  actor: string,
  generatedAt = new Date().toISOString(),
): BdWorkflowSnapshot {
  return reconcileLifecycle(
    lead,
    updateBaseTask(lead, taskId, input, actor, generatedAt),
    generatedAt,
    actor,
  );
}

export function recordBdPipelineEvent(
  lead: Lead,
  summary: string,
  actor: string,
  generatedAt = new Date().toISOString(),
): BdWorkflowSnapshot {
  return reconcileLifecycle(
    lead,
    recordBasePipelineEvent(lead, summary, actor, generatedAt),
    generatedAt,
    actor,
  );
}

export function workflowQueueFacts(lead: Lead, generatedAt = new Date().toISOString()): {
  openTasks: number;
  overdueTasks: number;
  nextAction: BdWorkflowSnapshot['nextBestAction'];
  blocked: boolean;
} {
  const snapshot = refreshBdWorkflow(lead, generatedAt, 'bd-workflow-read');
  return {
    openTasks: snapshot.openTaskCount,
    overdueTasks: snapshot.overdueTaskCount,
    nextAction: snapshot.nextBestAction,
    blocked: snapshot.blocked,
  };
}

function reconcileLifecycle(
  lead: Lead,
  candidate: BdWorkflowSnapshot,
  generatedAt: string,
  actor: string,
): BdWorkflowSnapshot {
  const currentOnly = refreshBaseWorkflow(stripWorkflow(lead), generatedAt, actor);
  const currentGeneratedIds = new Set(
    currentOnly.tasks.filter((task) => task.generated).map((task) => task.id),
  );
  const tasks = candidate.tasks.filter((task) => shouldPreserveTask(task, currentGeneratedIds));
  if (tasks.length === candidate.tasks.length) return candidate;

  const cleanedSnapshot: BdWorkflowSnapshot = {
    ...candidate,
    tasks,
    openTaskCount: tasks.filter(isActiveTask).length,
    overdueTaskCount: tasks.filter((task) => isActiveTask(task) && isOverdue(task, generatedAt)).length,
  };
  const cleanedLead = attachBdWorkflow(stripWorkflow(lead), cleanedSnapshot);
  return refreshBaseWorkflow(cleanedLead, generatedAt, actor);
}

function shouldPreserveTask(task: BdTask, currentGeneratedIds: Set<string>): boolean {
  if (!task.generated) return true;
  if (currentGeneratedIds.has(task.id)) return true;
  return PRESERVED_GENERATED_STATUSES.has(task.status);
}

function stripWorkflow(lead: Lead): Lead {
  const raw = asRecord(lead.rawPayload);
  const {bdWorkflow: _workflow, bdWorkflowVersion: _version, ...rest} = raw;
  return {
    ...lead,
    rawPayload: rest,
  };
}

function isActiveTask(task: BdTask): boolean {
  return task.status === 'open' || task.status === 'in_progress';
}

function isOverdue(task: BdTask, generatedAt: string): boolean {
  return Boolean(task.dueAt && Date.parse(task.dueAt) <= Date.parse(generatedAt));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
