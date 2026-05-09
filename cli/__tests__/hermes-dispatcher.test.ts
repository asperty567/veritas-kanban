import { describe, expect, it } from 'vitest';
import {
  buildHermesArgs,
  buildHermesPrompt,
  DEFAULT_VERITAS_API_BASE,
  dispatchAgentRequest,
  loadPendingAgentRequests,
  parseWorktreeFromPrompt,
  resolveHermesRoute,
  type ApiClient,
  type ProcessRunner,
} from '../src/commands/hermes-dispatcher.js';

describe('Hermes dispatcher adapter', () => {
  it('builds a Hermes oneshot prompt without OpenClaw runtime dispatch', () => {
    const args = buildHermesArgs(
      {
        taskId: 'task_1',
        attemptId: 'attempt_1',
        prompt: '# Agent Task Request\n\n**Worktree:** `/tmp/worktree`',
        requestedAt: '2026-05-09T00:00:00.000Z',
      },
      { apiBase: 'http://veritas.local', toolsets: 'terminal,file' }
    );

    expect(args[0]).toBe('-z');
    expect(args).toEqual(
      expect.arrayContaining(['--provider', 'openai-codex', '--model', 'gpt-5.5'])
    );
    expect(args).toContain('--toolsets');
    expect(args).toContain('terminal,file');
    expect(args[1]).toContain('HermesAgent is canonical');
    expect(args[1]).toContain('do not invoke OpenClaw runtime or sessions_spawn');
    expect(args[1]).toContain('http://veritas.local');
    expect(args[1]).toContain('Hermes model target: openai-codex:gpt-5.5');
  });

  it('keeps openai-codex:gpt-5.5 as the default Hermes route', () => {
    expect(resolveHermesRoute()).toEqual({ provider: 'openai-codex', model: 'gpt-5.5' });
    expect(resolveHermesRoute({ provider: ' ', model: '' })).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.5',
    });
  });

  it('defaults the prompt API base to the local Veritas API', () => {
    const prompt = buildHermesPrompt({
      taskId: 'task_1',
      attemptId: 'attempt_1',
      prompt: 'Do work',
      requestedAt: '2026-05-09T00:00:00.000Z',
    });

    expect(prompt).toContain(`Veritas API base: ${DEFAULT_VERITAS_API_BASE}`);
  });

  it('passes explicit Hermes provider and model overrides to the CLI execution path', () => {
    const args = buildHermesArgs(
      {
        taskId: 'task_1',
        attemptId: 'attempt_1',
        prompt: 'Do work',
        requestedAt: '2026-05-09T00:00:00.000Z',
      },
      { provider: 'openai-codex', model: 'gpt-5.5' }
    );

    expect(args.slice(2, 6)).toEqual(['--provider', 'openai-codex', '--model', 'gpt-5.5']);
  });

  it('parses worktree paths from existing Veritas prompts', () => {
    expect(parseWorktreeFromPrompt('**Worktree:** `/tmp/veritas-worktree`')).toBe(
      '/tmp/veritas-worktree'
    );
    expect(parseWorktreeFromPrompt('Worktree: /tmp/plain')).toBe('/tmp/plain');
  });

  it('loads and deduplicates pending API requests', async () => {
    const api: ApiClient = async (apiPath) => {
      expect(apiPath).toBe('/api/agents/pending');
      return [
        {
          taskId: 'task_1',
          attemptId: 'attempt_1',
          prompt: 'do work',
          requestedAt: '2026-05-09T00:00:00.000Z',
          callbackUrl: 'http://localhost:3001/api/agents/task_1/complete',
        },
      ] as never;
    };

    await expect(loadPendingAgentRequests(api)).resolves.toEqual([
      expect.objectContaining({ taskId: 'task_1', attemptId: 'attempt_1', source: 'api' }),
    ]);
  });

  it('dry-run has no Veritas write side effects', async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const api: ApiClient = async (apiPath, options) => {
      calls.push({ path: apiPath, body: options?.body ? JSON.parse(options.body) : undefined });
      return {} as never;
    };
    const runner: ProcessRunner = async () => {
      throw new Error('runner should not be called in dry-run');
    };

    const result = await dispatchAgentRequest(
      api,
      {
        taskId: 'task_1',
        attemptId: 'attempt_1',
        prompt: '# Agent Task Request\n\nDo work',
        requestedAt: '2026-05-09T00:00:00.000Z',
        source: 'api',
      },
      { dryRun: true },
      runner
    );

    expect(result.status).toBe('dry-run');
    expect(calls).toEqual([]);
  });

  it('spawns Hermes and appends Veritas evidence before completing the agent request', async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const api: ApiClient = async (apiPath, options) => {
      calls.push({
        path: apiPath,
        body: options?.body ? JSON.parse(options.body) : undefined,
      });
      if (apiPath.endsWith('/subtasks') && options?.method === 'POST') {
        return { subtasks: [{ id: 'subtask_1' }] } as never;
      }
      return {} as never;
    };
    const runnerCalls: Array<{ command: string; args: string[] }> = [];
    const runner: ProcessRunner = async (command, args) => {
      runnerCalls.push({ command, args });
      return { exitCode: 0, stdout: 'changed files: src/example.ts\ntests: passed', stderr: '' };
    };

    const result = await dispatchAgentRequest(
      api,
      {
        taskId: 'task_1',
        attemptId: 'attempt_1',
        prompt: '# Agent Task Request\n\nDo work',
        requestedAt: '2026-05-09T00:00:00.000Z',
        source: 'api',
      },
      { hermesCommand: 'hermes-test', apiBase: 'http://localhost:3001' },
      runner
    );

    expect(result.status).toBe('complete');
    expect(runnerCalls[0]?.command).toBe('hermes-test');
    expect(runnerCalls[0]?.args[0]).toBe('-z');
    expect(runnerCalls[0]?.args).toEqual(
      expect.arrayContaining(['--provider', 'openai-codex', '--model', 'gpt-5.5'])
    );
    expect(calls.map((call) => call.path)).toEqual([
      '/api/tasks/task_1/subtasks',
      '/api/tasks/task_1/progress/append',
      '/api/tasks/task_1/progress/append',
      '/api/tasks/task_1/subtasks/subtask_1',
      '/api/agents/task_1/complete',
    ]);
    expect(calls[1]?.body).toMatchObject({
      section: 'Progress',
      content: expect.stringContaining('Route: openai-codex:gpt-5.5'),
    });
    expect(calls.at(-1)?.body).toMatchObject({ success: true });
  });
});
