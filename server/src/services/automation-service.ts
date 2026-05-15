/**
 * Automation Service
 *
 * Handles automation task scheduling, lifecycle, and state management.
 * Extracted from automation.ts route to separate business logic from HTTP concerns.
 */

import { nanoid } from 'nanoid';
import type { Task } from '@veritas-kanban/shared';

export interface AutomationStartResult {
  taskId: string;
  attemptId: string;
  title: string;
  description: string;
  project?: string;
  automation?: Task['automation'];
}

export interface AutomationCompleteResult {
  taskId: string;
  status: 'complete' | 'failed';
  automation?: Task['automation'];
}

export interface AutomationTaskFilter {
  pending?: boolean;
  running?: boolean;
  failed?: boolean;
}

export type BlockedIntakeAction = 'ignored' | 'annotated' | 'requeued' | 'judgment-blocked';

export interface BlockedIntakeResolution {
  taskId: string;
  action: BlockedIntakeAction;
  reason: string;
  missingFields: string[];
  filePaths: string[];
  acceptanceCriteria: string[];
  progressNote: string;
  enrichedDescription?: string;
}

function uniq(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim().replace(/[),.;:]+$/, '')).filter(Boolean))
  );
}

function firstMatchingLines(text: string, patterns: RegExp[]): string[] {
  return uniq(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => patterns.some((pattern) => pattern.test(line)))
      .slice(0, 5)
  );
}

export class AutomationService {
  // ============ Task Filtering / Scheduling Decisions ============

  /**
   * Find tasks pending automation execution.
   * These are automation tasks that are either:
   * 1. Type automation AND status todo (not yet started)
   * 2. OR have a failed veritas attempt and need retry
   */
  getPendingTasks(tasks: Task[]): Task[] {
    return tasks.filter((task) => {
      if (task.type !== 'automation') return false;
      if (task.status === 'todo') return true;
      if (
        task.status === 'blocked' &&
        task.attempt?.agent === 'veritas' &&
        task.attempt?.status === 'failed'
      ) {
        return true; // Failed, might need retry
      }
      return false;
    });
  }

  /**
   * Find currently running automation tasks
   */
  getRunningTasks(tasks: Task[]): Task[] {
    return tasks.filter(
      (task) =>
        task.type === 'automation' &&
        task.attempt?.agent === 'veritas' &&
        task.attempt?.status === 'running'
    );
  }

  /**
   * Find failed automation tasks that might need attention
   */
  getFailedTasks(tasks: Task[]): Task[] {
    return tasks.filter(
      (task) =>
        task.type === 'automation' && task.attempt?.status === 'failed' && task.status !== 'done'
    );
  }

  /**
   * Get all automation tasks by filter
   */
  filterTasks(tasks: Task[], filter: AutomationTaskFilter): Task[] {
    let result: Task[] = [];

    if (filter.pending) {
      result = [...result, ...this.getPendingTasks(tasks)];
    }
    if (filter.running) {
      result = [...result, ...this.getRunningTasks(tasks)];
    }
    if (filter.failed) {
      result = [...result, ...this.getFailedTasks(tasks)];
    }

    // Remove duplicates
    const seen = new Set<string>();
    return result.filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
  }

  // ============ Blocked Intake Resolution ============

  isBriefQualityRejection(task: Task): boolean {
    if (task.status !== 'blocked') return false;
    if (task.blockedReason?.category !== 'other') return false;

    const text = [
      task.blockedReason?.note,
      task.automation?.result,
      task.comments?.map((comment) => comment.text).join('\n'),
      task.observations?.map((observation) => observation.content).join('\n'),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    return /brief[-_\s]?quality|quality[_\s-]?failure|brief.*reject|dispatcher.*reject|insufficient.*brief/.test(
      text
    );
  }

  extractFilePaths(task: Task): string[] {
    const text = [task.title, task.description, task.blockedReason?.note]
      .filter(Boolean)
      .join('\n');
    const matches = text.match(
      /(?:\/Users\/[\w./ -]+|(?:server|web|cli|shared|mcp|app|src|docs|scripts|tests|__tests__)\/[\w./-]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|sh|py))/g
    );
    return uniq(matches ?? []).slice(0, 20);
  }

  extractAcceptanceCriteria(task: Task): string[] {
    const criteriaFromSubtasks = (task.subtasks ?? [])
      .flatMap((subtask) => subtask.acceptanceCriteria ?? [])
      .filter(Boolean);
    const criteriaFromVerification = (task.verificationSteps ?? [])
      .map((step) => step.description)
      .filter(Boolean);
    const criteriaFromDescription = firstMatchingLines(task.description, [
      /done when/i,
      /acceptance criteria/i,
      /verified by/i,
      /qa evidence/i,
      /passes? when/i,
    ]);

    return uniq([
      ...criteriaFromSubtasks,
      ...criteriaFromVerification,
      ...criteriaFromDescription,
    ]).slice(0, 10);
  }

  isJudgmentBlocked(task: Task): boolean {
    const originalDescription = task.description.split('## Hawk execution brief')[0];
    const text = [task.title, originalDescription, task.blockedReason?.note]
      .filter(Boolean)
      .join('\n');
    return /\b(strategy|credential|secret|token|oauth|password|payment|invoice|customer-facing|publish|publishing|deploy|production restart|restart|destructive|drop table|rm -rf|approval required|andy approval)\b/i.test(
      text
    );
  }

  planBlockedIntakeResolution(task: Task): BlockedIntakeResolution {
    if (!this.isBriefQualityRejection(task)) {
      return {
        taskId: task.id,
        action: 'ignored',
        reason: 'not a dispatcher brief-quality blocked task',
        missingFields: [],
        filePaths: [],
        acceptanceCriteria: [],
        progressNote: '',
      };
    }

    const filePaths = this.extractFilePaths(task);
    const acceptanceCriteria = this.extractAcceptanceCriteria(task);
    const missingFields = [
      ...(filePaths.length === 0 ? ['explicit file paths'] : []),
      ...(acceptanceCriteria.length === 0 ? ['acceptance criteria / DONE WHEN'] : []),
    ];
    const decisionPrefix = 'Hawk blocked-column poll detected dispatcher brief-quality rejection.';

    if (this.isJudgmentBlocked(task)) {
      return {
        taskId: task.id,
        action: 'judgment-blocked',
        reason:
          'scope contains strategy, credential, publishing, customer-facing, restart, destructive, or approval language',
        missingFields,
        filePaths,
        acceptanceCriteria,
        progressNote: `${decisionPrefix} Left blocked: the brief includes approval/judgment-risk language and must stay blocked for Andy or the named owner. Missing fields seen: ${missingFields.join(', ') || 'none'}.`,
      };
    }

    const executionBrief = [
      '## Hawk execution brief',
      '',
      'Hawk enriched this Andy-created/simple-intake task after a dispatcher brief-quality rejection.',
      '',
      'Scope files:',
      ...(filePaths.length > 0
        ? filePaths.map((filePath) => `- ${filePath}`)
        : ['- MISSING: add explicit file paths before this task is runnable.']),
      '',
      'DONE WHEN / acceptance criteria:',
      ...(acceptanceCriteria.length > 0
        ? acceptanceCriteria.map((criterion) => `- ${criterion}`)
        : [
            '- MISSING: add explicit acceptance criteria / DONE WHEN before this task is runnable.',
          ]),
      '',
      'Guardrails:',
      '- Do not delete tasks.',
      '- Leave strategy, credential, publishing, customer-facing, restart, destructive, or approval decisions blocked.',
    ].join('\n');

    if (missingFields.length > 0) {
      return {
        taskId: task.id,
        action: 'annotated',
        reason: 'mechanical brief-quality blocker, but runnable fields are still missing',
        missingFields,
        filePaths,
        acceptanceCriteria,
        progressNote: `${decisionPrefix} Missing fields: ${missingFields.join(', ')}. Enriched safe execution brief was added, but task remains blocked until file paths and DONE WHEN are explicit.`,
        enrichedDescription: task.description.includes('## Hawk execution brief')
          ? task.description
          : `${task.description.trim()}\n\n${executionBrief}`.trim(),
      };
    }

    return {
      taskId: task.id,
      action: 'requeued',
      reason:
        'mechanical brief-quality blocker resolved; explicit file paths and acceptance criteria are present',
      missingFields,
      filePaths,
      acceptanceCriteria,
      progressNote: `${decisionPrefix} Enriched execution brief with explicit file paths (${filePaths.join(', ')}) and DONE WHEN (${acceptanceCriteria.join('; ')}). Moving back to todo/runnable.`,
      enrichedDescription: task.description.includes('## Hawk execution brief')
        ? task.description
        : `${task.description.trim()}\n\n${executionBrief}`.trim(),
    };
  }

  // ============ Lifecycle Logic ============

  /**
   * Validate that a task can start automation
   */
  validateCanStart(task: Task): { valid: boolean; error?: string } {
    if (task.type !== 'automation') {
      return { valid: false, error: 'Task must be of type "automation"' };
    }
    return { valid: true };
  }

  /**
   * Generate the update payload for starting automation
   */
  getStartPayload(sessionKey?: string): {
    status: 'in-progress';
    attempt: Task['attempt'];
    automation: Task['automation'];
  } {
    const attemptId = `attempt_${nanoid(8)}`;
    const now = new Date().toISOString();

    return {
      status: 'in-progress',
      attempt: {
        id: attemptId,
        agent: 'veritas',
        status: 'running',
        started: now,
      },
      automation: {
        sessionKey,
        spawnedAt: now,
      },
    };
  }

  /**
   * Build the start result from an updated task
   */
  buildStartResult(task: Task, attemptId: string): AutomationStartResult {
    return {
      taskId: task.id,
      attemptId,
      title: task.title,
      description: task.description,
      project: task.project,
      automation: task.automation,
    };
  }

  /**
   * Validate that a task can be completed
   */
  validateCanComplete(task: Task): { valid: boolean; error?: string } {
    if (!task.attempt || task.attempt.agent !== 'veritas') {
      return { valid: false, error: 'Task does not have an active veritas attempt' };
    }
    return { valid: true };
  }

  /**
   * Generate the update payload for completing automation
   */
  getCompletePayload(
    existingAttempt: Task['attempt'],
    existingAutomation: Task['automation'],
    result?: string,
    status: 'complete' | 'failed' = 'complete'
  ): {
    status: 'done' | 'blocked';
    attempt: Task['attempt'];
    automation: Task['automation'];
  } {
    const isSuccess = status === 'complete';
    const now = new Date().toISOString();

    return {
      status: isSuccess ? 'done' : 'blocked',
      attempt: {
        ...existingAttempt!,
        status: isSuccess ? 'complete' : 'failed',
        ended: now,
      },
      automation: {
        ...existingAutomation,
        completedAt: now,
        result,
      },
    };
  }

  /**
   * Build the complete result from an updated task
   */
  buildCompleteResult(task: Task, status: 'complete' | 'failed'): AutomationCompleteResult {
    return {
      taskId: task.id,
      status,
      automation: task.automation,
    };
  }
}

// Singleton instance
let instance: AutomationService | null = null;

export function getAutomationService(): AutomationService {
  if (!instance) {
    instance = new AutomationService();
  }
  return instance;
}
