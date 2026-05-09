import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Task } from '../utils/types.js';

export interface AgentRequest {
  taskId: string;
  attemptId: string;
  prompt: string;
  requestedAt: string;
  callbackUrl?: string;
  provider?: string;
  model?: string;
  source?: 'api' | 'file' | 'automation';
}

export interface DispatchResult {
  taskId: string;
  attemptId: string;
  source: AgentRequest['source'];
  status: 'dry-run' | 'complete' | 'failed';
  exitCode?: number;
  summary?: string;
  error?: string;
}

type ApiOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

export type ApiClient = <T>(apiPath: string, options?: ApiOptions) => Promise<T>;

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
) => Promise<ProcessResult>;

export interface DispatchOptions {
  source?: 'api' | 'files' | 'automation' | 'all';
  requestsDir?: string;
  hermesCommand?: string;
  toolsets?: string;
  provider?: string;
  model?: string;
  limit?: number;
  dryRun?: boolean;
  timeoutMs?: number;
  apiBase?: string;
}

const DEFAULT_TIMEOUT_MS = 1000 * 60 * 60 * 2;
const DEFAULT_TOOLSETS = 'terminal,file,web';
const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.5';
export const DEFAULT_VERITAS_API_BASE = 'http://127.0.0.1:3099';

export async function loadPendingAgentRequests(
  apiClient: ApiClient,
  options: DispatchOptions = {}
): Promise<AgentRequest[]> {
  const source = options.source || 'api';
  const batches: AgentRequest[][] = [];

  if (source === 'api' || source === 'all') {
    const apiRequests = await apiClient<Omit<AgentRequest, 'source'>[]>('/api/agents/pending');
    batches.push(apiRequests.map((request) => ({ ...request, source: 'api' as const })));
  }

  if (source === 'files' || source === 'all') {
    batches.push(await loadFileRequests(options.requestsDir || defaultRequestsDir()));
  }

  if (source === 'automation' || source === 'all') {
    batches.push(await loadAutomationRequests(apiClient));
  }

  const seen = new Set<string>();
  return batches
    .flat()
    .filter(isValidRequest)
    .filter((request) => {
      const key = `${request.taskId}:${request.attemptId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

export async function dispatchPendingToHermes(
  apiClient: ApiClient,
  options: DispatchOptions = {},
  runner: ProcessRunner = runProcess
): Promise<DispatchResult[]> {
  const requests = await loadPendingAgentRequests(apiClient, options);
  const selected =
    typeof options.limit === 'number' ? requests.slice(0, Math.max(0, options.limit)) : requests;
  const results: DispatchResult[] = [];

  for (const request of selected) {
    results.push(await dispatchAgentRequest(apiClient, request, options, runner));
  }

  return results;
}

export async function dispatchAgentRequest(
  apiClient: ApiClient,
  request: AgentRequest,
  options: DispatchOptions = {},
  runner: ProcessRunner = runProcess
): Promise<DispatchResult> {
  const source = request.source || 'api';

  if (options.dryRun) {
    return {
      taskId: request.taskId,
      attemptId: request.attemptId,
      source,
      status: 'dry-run',
      summary: 'Hermes spawn skipped by --dry-run',
    };
  }

  const subtaskId = await createEvidenceSubtask(apiClient, request).catch(() => undefined);
  const route = resolveHermesRoute(request, options);
  await appendProgressEvidence(
    apiClient,
    request.taskId,
    `Hermes dispatcher accepted attempt ${request.attemptId} from ${source}. Route: ${route.provider}:${route.model}.`
  ).catch(() => undefined);

  const command = options.hermesCommand || process.env.HERMES_COMMAND || 'hermes';
  const args = buildHermesArgs(request, options);
  const cwd = (await resolveCwd(request.prompt)) || process.cwd();

  let result: ProcessResult;
  try {
    result = await runner(command, args, {
      cwd,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    });
  } catch (error: any) {
    result = {
      exitCode: 1,
      stdout: '',
      stderr: error?.message || String(error),
    };
  }

  const summary = summarizeHermesOutput(result.stdout, result.stderr);
  const success = result.exitCode === 0;

  await appendProgressEvidence(
    apiClient,
    request.taskId,
    `Hermes dispatcher finished attempt ${request.attemptId}: ${success ? 'success' : 'failed'}\n\n${summary}`
  ).catch(() => undefined);

  if (subtaskId) {
    await completeEvidenceSubtask(apiClient, request.taskId, subtaskId, success).catch(
      () => undefined
    );
  }

  if (source !== 'automation') {
    await apiClient(`/api/agents/${encodeURIComponent(request.taskId)}/complete`, {
      method: 'POST',
      body: JSON.stringify(success ? { success, summary } : { success, error: summary }),
    });
  }

  return {
    taskId: request.taskId,
    attemptId: request.attemptId,
    source,
    status: success ? 'complete' : 'failed',
    exitCode: result.exitCode,
    summary: success ? summary : undefined,
    error: success ? undefined : summary,
  };
}

export function buildHermesArgs(request: AgentRequest, options: DispatchOptions = {}): string[] {
  const route = resolveHermesRoute(request, options);
  const args = [
    '-z',
    buildHermesPrompt(request, options.apiBase, route),
    '--provider',
    route.provider,
    '--model',
    route.model,
  ];
  const toolsets = options.toolsets || DEFAULT_TOOLSETS;
  if (toolsets) {
    args.push('--toolsets', toolsets);
  }
  return args;
}

export function buildHermesPrompt(
  request: AgentRequest,
  apiBase?: string,
  route = resolveHermesRoute(request)
): string {
  const base = apiBase || DEFAULT_VERITAS_API_BASE;
  return `${request.prompt}

---

Veritas/Hermes dispatcher context:
- Task ID: ${request.taskId}
- Attempt ID: ${request.attemptId}
- Veritas API base: ${base}
- Hermes model target: ${route.provider}:${route.model}
- HermesAgent is canonical in this deployment; do not invoke OpenClaw runtime or sessions_spawn.
- Work only in the task worktree when one is provided.
- Do not print or persist secrets.
- Return a concise final summary with changed files, tests run, and blockers.
- The dispatcher will append Veritas progress evidence and post the completion callback after this Hermes session exits.`;
}

export function resolveHermesRoute(
  request: Pick<AgentRequest, 'provider' | 'model'> = {},
  options: Pick<DispatchOptions, 'provider' | 'model'> = {}
): { provider: string; model: string } {
  return {
    provider:
      cleanRoutePart(options.provider) || cleanRoutePart(request.provider) || DEFAULT_PROVIDER,
    model: cleanRoutePart(options.model) || cleanRoutePart(request.model) || DEFAULT_MODEL,
  };
}

export function parseWorktreeFromPrompt(prompt: string): string | undefined {
  const line = prompt
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => /Worktree/i.test(candidate));
  if (!line) return undefined;
  const raw = line.replace(/^.*?Worktree/i, '');
  const cleaned = raw.replace(/^[\s:*`]+|[`\s]+$/g, '');
  return cleaned || undefined;
}

function defaultRequestsDir(): string {
  return path.join(process.cwd(), '.veritas-kanban', 'agent-requests');
}

async function loadFileRequests(requestsDir: string): Promise<AgentRequest[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(requestsDir);
  } catch {
    return [];
  }

  const requests: AgentRequest[] = [];
  for (const entry of entries.filter((file) => file.endsWith('.json'))) {
    const filePath = path.join(requestsDir, entry);
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Omit<
        AgentRequest,
        'source'
      >;
      requests.push({ ...parsed, source: 'file' });
    } catch {
      // Ignore malformed request files; server-side pending endpoint remains source of truth.
    }
  }
  return requests;
}

async function loadAutomationRequests(apiClient: ApiClient): Promise<AgentRequest[]> {
  const tasks = await apiClient<Task[]>('/api/automation/pending');
  return tasks
    .filter((task) => Boolean(task.id && task.title))
    .map((task) => ({
      taskId: task.id,
      attemptId: `automation_${task.id}`,
      requestedAt: new Date().toISOString(),
      source: 'automation' as const,
      prompt: buildAutomationPrompt(task),
    }));
}

function buildAutomationPrompt(task: Task): string {
  const worktree = task.git?.worktreePath ? `\n**Worktree:** ${task.git.worktreePath}` : '';
  return `# Runnable Veritas Auto Task

**Task ID:** ${task.id}${worktree}

## Task: ${task.title}

${task.description || 'No description provided.'}

Complete the runnable task safely and report concise evidence.`;
}

function isValidRequest(request: AgentRequest): boolean {
  return Boolean(request.taskId && request.attemptId && request.prompt && request.requestedAt);
}

function cleanRoutePart(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

async function resolveCwd(prompt: string): Promise<string | undefined> {
  const worktree = parseWorktreeFromPrompt(prompt);
  if (!worktree) return undefined;
  const expanded = worktree.replace(/^~/, process.env.HOME || '');
  try {
    const stat = await fs.stat(expanded);
    return stat.isDirectory() ? expanded : undefined;
  } catch {
    return undefined;
  }
}

async function createEvidenceSubtask(
  apiClient: ApiClient,
  request: AgentRequest
): Promise<string | undefined> {
  const updatedTask = await apiClient<Task>(
    `/api/tasks/${encodeURIComponent(request.taskId)}/subtasks`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: `Hermes dispatch evidence: ${request.attemptId}`,
        acceptanceCriteria: [
          'Hermes CLI session spawned',
          'Hermes final response captured',
          'Veritas progress evidence appended',
        ],
      }),
    }
  );
  return updatedTask.subtasks?.at(-1)?.id;
}

async function completeEvidenceSubtask(
  apiClient: ApiClient,
  taskId: string,
  subtaskId: string,
  success: boolean
): Promise<void> {
  await apiClient(
    `/api/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        completed: success,
        criteriaChecked: success ? [true, true, true] : [true, true, false],
      }),
    }
  );
}

async function appendProgressEvidence(
  apiClient: ApiClient,
  taskId: string,
  text: string
): Promise<void> {
  await apiClient(`/api/tasks/${encodeURIComponent(taskId)}/progress/append`, {
    method: 'POST',
    body: JSON.stringify({
      section: 'Progress',
      content: clamp(text, 1900),
    }),
  });
}

function summarizeHermesOutput(stdout: string, stderr: string): string {
  const combined = [stdout.trim(), stderr.trim() ? `stderr:\n${stderr.trim()}` : '']
    .filter(Boolean)
    .join('\n\n');
  return clamp(redactSensitive(combined || 'Hermes exited without output.'), 1800);
}

function redactSensitive(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s'"`]+/gi, '$1[REDACTED]');
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 16)}\n…[truncated]`;
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Hermes command timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
