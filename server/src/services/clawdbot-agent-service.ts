/**
 * HermesAgentService - delegates agent work to Hermes sub-agents
 *
 * Instead of managing PTY processes directly, this service:
 * 1. Sends a task request to the main Hermes/Veritas session
 * 2. Hermes spawns a sub-agent with proper PTY handling
 * 3. Sub-agent works in the task's worktree
 * 4. On completion, Veritas calls back to update the task
 *
 * This keeps agent management simple and leverages Hermes infrastructure.
 * Legacy Clawdbot export names remain compatibility aliases only.
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import path from 'path';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { getAgentRoutingService } from './agent-routing-service.js';
import { getGatewayRun, sendGatewayRun, type RunStatusResponse } from './gateway-chat-client.js';
import { getBreaker } from './circuit-registry.js';
import { validatePathSegment, ensureWithinBase } from '../utils/sanitize.js';
import type { Task, AgentType, TaskAttempt, AttemptStatus } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
const log = createLogger('clawdbot-agent-service');

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const LOGS_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'logs');
const HERMES_GATEWAY =
  process.env.HERMES_API_SERVER_URL ||
  process.env.HERMES_GATEWAY ||
  process.env.HERMES_GATEWAY_URL ||
  process.env.CLAWDBOT_GATEWAY ||
  'http://127.0.0.1:8642';
void HERMES_GATEWAY;
const RUNTIME_MONITOR_INTERVAL_MS = Number(
  process.env.HERMES_RUNTIME_MONITOR_INTERVAL_MS || 30_000
);
const RUNTIME_MONITOR_MAX_CHECKS = Number(process.env.HERMES_RUNTIME_MONITOR_MAX_CHECKS || 120);
const RUNTIME_SUCCESS_STATUSES = new Set(['complete', 'completed', 'done', 'success', 'succeeded']);
const RUNTIME_FAILURE_STATUSES = new Set([
  'aborted',
  'cancelled',
  'canceled',
  'error',
  'failed',
  'monitor_timeout',
  'timed_out',
  'timeout',
]);

export interface AgentStatus {
  taskId: string;
  attemptId: string;
  agent: AgentType;
  status: AttemptStatus;
  startedAt?: string;
  endedAt?: string;
  backend?: 'hermes-api' | 'request-file';
  runId?: string;
  sessionKey?: string;
  requestFile?: string;
  lastRuntimeStatus?: string;
  monitorChecks?: number;
  escalationReason?: string;
}

interface HermesDispatchResult {
  backend: 'hermes-api' | 'request-file';
  runId?: string;
  sessionKey: string;
  requestFile?: string;
}

export interface AgentOutput {
  type: 'stdout' | 'stderr' | 'stdin' | 'system';
  content: string;
  timestamp: string;
}

// Track pending agent requests
const pendingAgents = new Map<
  string,
  {
    taskId: string;
    attemptId: string;
    agent: AgentType;
    startedAt: string;
    backend?: 'hermes-api' | 'request-file';
    runId?: string;
    sessionKey?: string;
    lastRuntimeStatus?: string;
    monitorChecks: number;
    monitorTimer?: ReturnType<typeof setTimeout>;
    escalationReason?: string;
    emitter: EventEmitter;
  }
>();

export class HermesAgentService {
  private configService: ConfigService;
  private taskService: TaskService;
  private logsDir: string;

  constructor() {
    this.configService = new ConfigService();
    this.taskService = new TaskService();
    this.logsDir = LOGS_DIR;
    this.ensureLogsDir();
  }

  private async ensureLogsDir(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
  }

  private expandPath(p: string): string {
    return p.replace(/^~/, process.env.HOME || '');
  }

  /**
   * Start an agent on a task by delegating to Hermes
   */
  async startAgent(taskId: string, agentType?: AgentType): Promise<AgentStatus> {
    // Get task
    const task = await this.taskService.getTask(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found`);
    }

    if (task.type !== 'code') {
      throw new Error('Agents can only be started on code tasks');
    }

    if (!task.git?.worktreePath) {
      throw new Error('Task must have an active worktree to start an agent');
    }

    // Check if agent already running for this task
    if (pendingAgents.has(taskId)) {
      throw new Error('An agent is already running for this task');
    }

    // Get agent config — use routing engine when agent is "auto" or not specified
    const config = await this.configService.getConfig();
    let agent: AgentType;
    let routingReason: string | undefined;

    if (!agentType || agentType === 'auto') {
      const routing = getAgentRoutingService();
      const result = await routing.resolveAgent(task);
      agent = result.agent;
      routingReason = result.reason;
      log.info(
        `[HermesAgent] Routing resolved agent for task ${taskId}: ${agent} (${routingReason})`
      );
    } else {
      agent = agentType;
    }

    // Create attempt
    const attemptId = `attempt_${nanoid(8)}`;
    const startedAt = new Date().toISOString();
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);

    // Create event emitter for status updates
    const emitter = new EventEmitter();

    // Store pending agent
    pendingAgents.set(taskId, {
      taskId,
      attemptId,
      agent,
      startedAt,
      monitorChecks: 0,
      emitter,
    });

    // Validate path segments for log file
    validatePathSegment(taskId);
    validatePathSegment(attemptId);

    // Build the task prompt for Hermes
    const worktreePath = this.expandPath(task.git.worktreePath);
    const taskPrompt = this.buildTaskPrompt(task, worktreePath, attemptId);

    // Initialize log file (ensure it stays within logs dir)
    ensureWithinBase(this.logsDir, logPath);
    await this.initLogFile(logPath, task, agent, taskPrompt);

    // Update task with attempt info
    const attempt: TaskAttempt = {
      id: attemptId,
      agent,
      status: 'running',
      started: startedAt,
    };

    const sessionKey = `veritas:${taskId}:${attemptId}`;

    await this.taskService.updateTask(taskId, {
      status: 'in-progress',
      agent,
      attempt,
      automation: {
        ...(task.automation || {}),
        sessionKey,
        spawnedAt: startedAt,
      },
    });

    // Start a real Hermes API-server run (wrapped in circuit breaker). If the
    // Hermes API is unavailable, preserve the legacy file-backed connector as a
    // compatibility fallback so existing Veritas pollers keep working.
    const agentBreaker = getBreaker('agent');
    let dispatch: HermesDispatchResult;
    try {
      dispatch = await agentBreaker.execute(() =>
        this.sendToHermes(taskPrompt, taskId, attemptId, sessionKey)
      );
      const pending = pendingAgents.get(taskId);
      if (pending) {
        pending.backend = dispatch.backend;
        pending.runId = dispatch.runId;
        pending.sessionKey = dispatch.sessionKey;
      }
      await this.taskService.updateTask(taskId, {
        automation: {
          ...(task.automation || {}),
          sessionKey: dispatch.sessionKey,
          spawnedAt: startedAt,
          result: dispatch.runId
            ? `Hermes API run started: ${dispatch.runId}`
            : `Hermes request queued: ${dispatch.requestFile}`,
        },
      });
      if (dispatch.backend === 'hermes-api' && dispatch.runId) {
        this.scheduleRuntimeMonitor(taskId);
      }
    } catch (error: any) {
      // Clean up on failure
      pendingAgents.delete(taskId);
      await this.taskService.updateTask(taskId, {
        status: 'todo',
        attempt: { ...attempt, status: 'failed', ended: new Date().toISOString() },
        automation: {
          ...(task.automation || {}),
          sessionKey,
          spawnedAt: startedAt,
          completedAt: new Date().toISOString(),
          result: `Failed to start Hermes run: ${error.message}`,
        },
      });
      throw new Error(`Failed to start agent via Hermes: ${error.message}`);
    }

    return {
      taskId,
      attemptId,
      agent,
      status: 'running',
      startedAt,
      backend: dispatch.backend,
      runId: dispatch.runId,
      sessionKey: dispatch.sessionKey,
      requestFile: dispatch.requestFile,
      monitorChecks: 0,
    };
  }

  /**
   * Poll one Hermes API-server run and reconcile Veritas task state. This is a
   * runtime monitor and escalation path only; it never marks a task Done from a
   * runtime success because Done still requires explicit callback/QA evidence.
   */
  async reconcileRuntime(taskId: string): Promise<AgentStatus | null> {
    const pending = pendingAgents.get(taskId);
    if (!pending || !pending.runId) {
      return this.getAgentStatus(taskId);
    }

    pending.monitorChecks += 1;
    const runtime = await getGatewayRun(pending.runId, pending.sessionKey);
    pending.lastRuntimeStatus = runtime.status;
    const normalized = runtime.status.toLowerCase().replace(/[\s-]+/g, '_');

    if (RUNTIME_FAILURE_STATUSES.has(normalized)) {
      await this.escalateRuntimeFailure(taskId, pending, runtime);
      return null;
    }

    if (RUNTIME_SUCCESS_STATUSES.has(normalized)) {
      const message =
        `Hermes runtime reached terminal status "${runtime.status}"; ` +
        'awaiting explicit Veritas completion callback with QA evidence before Done.';
      const task = await this.taskService.getTask(taskId);
      await this.taskService.updateTask(taskId, {
        status: 'in-progress',
        automation: {
          ...(task?.automation || {}),
          sessionKey: pending.sessionKey,
          spawnedAt: pending.startedAt,
          result: message,
        },
      });
      await this.appendRuntimeLog(taskId, pending.attemptId, message);
    }

    return this.getAgentStatus(taskId);
  }

  private scheduleRuntimeMonitor(taskId: string): void {
    const pending = pendingAgents.get(taskId);
    if (!pending?.runId) return;

    if (pending.monitorTimer) {
      clearTimeout(pending.monitorTimer);
    }

    pending.monitorTimer = setTimeout(() => {
      void this.reconcileRuntime(taskId)
        .catch((error: any) => {
          log.warn(
            { err: error.message, taskId, runId: pending.runId },
            '[HermesAgent] Runtime monitor check failed'
          );
        })
        .finally(() => {
          const current = pendingAgents.get(taskId);
          if (!current?.runId || current.escalationReason) return;
          if (current.monitorChecks >= RUNTIME_MONITOR_MAX_CHECKS) {
            void this.escalateRuntimeFailure(taskId, current, {
              runId: current.runId,
              status: 'monitor_timeout',
              error: `No terminal Hermes callback after ${current.monitorChecks} monitor check(s)`,
            });
            return;
          }
          this.scheduleRuntimeMonitor(taskId);
        });
    }, RUNTIME_MONITOR_INTERVAL_MS);
    pending.monitorTimer.unref?.();
  }

  private async escalateRuntimeFailure(
    taskId: string,
    pending: NonNullable<ReturnType<typeof pendingAgents.get>>,
    runtime: RunStatusResponse
  ): Promise<void> {
    if (pending.monitorTimer) {
      clearTimeout(pending.monitorTimer);
    }
    const endedAt = runtime.completedAt || new Date().toISOString();
    const reason = runtime.error
      ? `Hermes runtime status "${runtime.status}": ${runtime.error}`
      : `Hermes runtime status "${runtime.status}"`;
    pending.escalationReason = reason;
    const task = await this.taskService.getTask(taskId);

    await this.taskService.updateTask(taskId, {
      status: 'blocked',
      attempt: {
        id: pending.attemptId,
        agent: pending.agent,
        status: 'failed',
        started: pending.startedAt,
        ended: endedAt,
      },
      automation: {
        ...(task?.automation || {}),
        sessionKey: pending.sessionKey,
        spawnedAt: pending.startedAt,
        completedAt: endedAt,
        result: `Escalated by Hermes runtime monitor — ${reason}`,
      },
    });

    await this.appendRuntimeLog(
      taskId,
      pending.attemptId,
      `Escalated by Hermes runtime monitor. ${reason}`
    );
    pending.emitter.emit('escalated', { status: 'failed', summary: reason });
    pendingAgents.delete(taskId);
    log.warn(
      { taskId, runId: runtime.runId, reason },
      '[HermesAgent] Runtime monitor escalated task'
    );
  }

  private async appendRuntimeLog(
    taskId: string,
    attemptId: string,
    message: string
  ): Promise<void> {
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    ensureWithinBase(this.logsDir, logPath);
    await fs.appendFile(logPath, `\n\n---\n\n## Runtime Monitor\n\n${message}\n`, 'utf-8');
  }

  /**
   * Send task request to Hermes. Prefer Hermes' API-server /v1/runs endpoint so
   * Start Agent actually starts work immediately; keep the file-backed request
   * queue only as a compatibility fallback for older Veritas/Hermes bridges.
   */
  private async sendToHermes(
    prompt: string,
    taskId: string,
    attemptId: string,
    sessionKey: string
  ): Promise<HermesDispatchResult> {
    // Validate path segments to prevent directory traversal
    validatePathSegment(taskId);
    validatePathSegment(attemptId);

    try {
      const run = await sendGatewayRun(
        prompt,
        sessionKey,
        'You are HermesAgent executing a Veritas kanban task. Follow the task prompt exactly and keep Veritas board truth updated through its API.'
      );
      log.info({ taskId, attemptId, runId: run.runId }, '[HermesAgent] Started Hermes API run');
      return {
        backend: 'hermes-api',
        runId: run.runId,
        sessionKey,
      };
    } catch (error: any) {
      if (process.env.HERMES_DISABLE_REQUEST_FILE_FALLBACK === 'true') {
        throw error;
      }
      log.warn(
        { err: error.message, taskId, attemptId },
        '[HermesAgent] Hermes API run failed; falling back to request-file connector'
      );
    }

    const requestsDir = path.join(PROJECT_ROOT, '.veritas-kanban', 'agent-requests');
    const requestFile = path.join(requestsDir, `${taskId}.json`);
    ensureWithinBase(requestsDir, requestFile);

    await fs.mkdir(path.dirname(requestFile), { recursive: true });

    await fs.writeFile(
      requestFile,
      JSON.stringify(
        {
          taskId,
          attemptId,
          sessionKey,
          prompt,
          requestedAt: new Date().toISOString(),
          callbackUrl: `http://localhost:3001/api/agents/${taskId}/complete`,
          backend: 'hermes-api-fallback',
        },
        null,
        2
      )
    );

    log.info(`[HermesAgent] Wrote fallback agent request for task ${taskId} to ${requestFile}`);
    return {
      backend: 'request-file',
      sessionKey,
      requestFile,
    };
  }

  /**
   * Handle completion callback from Hermes sub-agent
   */
  async completeAgent(
    taskId: string,
    result: { success: boolean; summary?: string; error?: string }
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      log.warn(`[HermesAgent] Received completion for unknown task ${taskId}`);
      return;
    }

    const { attemptId, emitter } = pending;
    const endedAt = new Date().toISOString();
    const status: AttemptStatus = result.success ? 'complete' : 'failed';

    // Update task
    await this.taskService.updateTask(taskId, {
      status: result.success ? 'done' : 'in-progress',
      attempt: {
        id: attemptId,
        agent: pending.agent,
        status,
        started: pending.startedAt,
        ended: endedAt,
      },
    });

    // Append to log
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const summary = result.summary || result.error || 'No summary provided';
    await fs.appendFile(logPath, `\n\n---\n\n## Result\n\n**Status:** ${status}\n\n${summary}\n`);

    // Emit completion
    emitter.emit('complete', { status, summary });

    if (pending.monitorTimer) {
      clearTimeout(pending.monitorTimer);
    }

    // Clean up
    pendingAgents.delete(taskId);

    // Remove request file
    const requestFile = path.join(
      PROJECT_ROOT,
      '.veritas-kanban',
      'agent-requests',
      `${taskId}.json`
    );
    try {
      await fs.unlink(requestFile);
    } catch {
      // Ignore if already deleted
    }

    log.info(`[HermesAgent] Task ${taskId} completed with status: ${status}`);
  }

  /**
   * Stop a running agent
   */
  async stopAgent(taskId: string): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      throw new Error('No agent running for this task');
    }

    // Mark as failed/stopped
    await this.completeAgent(taskId, {
      success: false,
      error: 'Stopped by user',
    });
  }

  /**
   * Get agent status
   */
  getAgentStatus(taskId: string): AgentStatus | null {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      return null;
    }

    return {
      taskId,
      attemptId: pending.attemptId,
      agent: pending.agent,
      status: 'running',
      startedAt: pending.startedAt,
      backend: pending.backend,
      runId: pending.runId,
      sessionKey: pending.sessionKey,
      lastRuntimeStatus: pending.lastRuntimeStatus,
      monitorChecks: pending.monitorChecks,
      escalationReason: pending.escalationReason,
    };
  }

  /**
   * Get event emitter for a running agent
   */
  getAgentEmitter(taskId: string): EventEmitter | null {
    return pendingAgents.get(taskId)?.emitter || null;
  }

  /**
   * List all pending agent requests (for Veritas to poll)
   */
  async listPendingRequests(): Promise<
    Array<{
      taskId: string;
      attemptId: string;
      prompt: string;
      requestedAt: string;
      callbackUrl: string;
    }>
  > {
    const requestsDir = path.join(PROJECT_ROOT, '.veritas-kanban', 'agent-requests');

    try {
      const files = await fs.readdir(requestsDir);
      const requests = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const content = await fs.readFile(path.join(requestsDir, f), 'utf-8');
            return JSON.parse(content);
          })
      );
      return requests;
    } catch {
      // Intentionally silent: requests directory may not exist — return empty list
      return [];
    }
  }

  async getAttemptLog(taskId: string, attemptId: string): Promise<string> {
    validatePathSegment(taskId);
    validatePathSegment(attemptId);
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    ensureWithinBase(this.logsDir, logPath);
    try {
      return await fs.readFile(logPath, 'utf-8');
    } catch {
      throw new Error('Log file not found');
    }
  }

  async listAttempts(taskId: string): Promise<string[]> {
    const files = await fs.readdir(this.logsDir);
    return files
      .filter((f) => f.startsWith(`${taskId}_`) && f.endsWith('.md'))
      .map((f) => f.replace(`${taskId}_`, '').replace('.md', ''));
  }

  private buildTaskPrompt(task: Task, worktreePath: string, attemptId: string): string {
    // Build checkpoint context if available
    let checkpointSection = '';
    if (task.checkpoint) {
      const resumeCount = task.checkpoint.resumeCount || 0;
      const checkpointAge = Math.floor(
        (Date.now() - new Date(task.checkpoint.timestamp).getTime()) / 1000 / 60
      );
      checkpointSection = `
## ⚠️ CHECKPOINT DETECTED — This is a RESUME (not a fresh start)

**Resume Count:** ${resumeCount} time(s)
**Last Checkpoint:** ${task.checkpoint.timestamp} (${checkpointAge} minutes ago)
**Last Step:** ${task.checkpoint.step}

### Saved State:
\`\`\`json
${JSON.stringify(task.checkpoint.state, null, 2)}
\`\`\`

**IMPORTANT:** Continue from where you left off. Review the saved state above to understand what was already done.
`;
    }

    return `# Agent Task Request

**Task ID:** ${task.id}
**Attempt ID:** ${attemptId}
**Worktree:** ${worktreePath}
${checkpointSection}
## Task: ${task.title}

${task.description || 'No description provided.'}

## Instructions

1. Work in the directory: \`${worktreePath}\`
2. Complete the task described above.
3. Keep Veritas board truth current while you work:
   - Append concrete evidence to \`POST http://127.0.0.1:3099/api/tasks/${task.id}/progress/append\`
   - Tick completed subtasks / criteria through the Veritas task APIs before claiming done.
   - Do **not** edit raw storage files as a substitute for API writeback.
4. Commit your changes with a descriptive message when code changes are required.
5. When finished, call the completion endpoint:
   \`\`\`bash
   curl -X POST http://127.0.0.1:3099/api/agents/${task.id}/complete \\
     -H "Content-Type: application/json" \\
     -d '{"success": true, "summary": "Brief description of what was done, tests run, and Veritas evidence appended"}'
   \`\`\`

If you encounter errors, call with \`success: false\` and include the error message.
`;
  }

  private async initLogFile(
    logPath: string,
    task: Task,
    agent: AgentType,
    prompt: string
  ): Promise<void> {
    const header = `# Agent Log: ${task.title}

**Task ID:** ${task.id}
**Agent:** ${agent} (via Hermes)
**Started:** ${new Date().toISOString()}
**Worktree:** ${task.git?.worktreePath}

## Task Prompt

\`\`\`
${prompt}
\`\`\`

## Progress

*Agent is working via Hermes sub-agent...*

`;
    await fs.writeFile(logPath, header, 'utf-8');
  }
}

// Export singleton with Hermes-native name plus legacy compatibility aliases.
export const hermesAgentService = new HermesAgentService();
export const clawdbotAgentService = hermesAgentService;
export { HermesAgentService as ClawdbotAgentService };
