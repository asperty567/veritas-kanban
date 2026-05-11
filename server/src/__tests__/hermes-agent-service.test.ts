import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
  getTask: vi.fn(),
  updateTask: vi.fn().mockResolvedValue(undefined),
  getConfig: vi.fn().mockResolvedValue({}),
  resolveAgent: vi.fn(),
  sendGatewayRun: vi.fn(),
  getGatewayRun: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: mocks.mkdir,
    writeFile: mocks.writeFile,
    appendFile: mocks.appendFile,
    unlink: mocks.unlink,
    readdir: mocks.readdir,
    readFile: mocks.readFile,
  },
}));

vi.mock('../services/task-service.js', () => ({
  TaskService: vi.fn().mockImplementation(function TaskServiceMock() {
    return {
      getTask: mocks.getTask,
      updateTask: mocks.updateTask,
    };
  }),
}));

vi.mock('../services/config-service.js', () => ({
  ConfigService: vi.fn().mockImplementation(function ConfigServiceMock() {
    return {
      getConfig: mocks.getConfig,
    };
  }),
}));

vi.mock('../services/agent-routing-service.js', () => ({
  getAgentRoutingService: () => ({
    resolveAgent: mocks.resolveAgent,
  }),
}));

vi.mock('../services/gateway-chat-client.js', () => ({
  sendGatewayRun: mocks.sendGatewayRun,
  getGatewayRun: mocks.getGatewayRun,
}));

vi.mock('../services/circuit-registry.js', () => ({
  getBreaker: () => ({
    execute: (fn: () => Promise<unknown>) => fn(),
  }),
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { HermesAgentService } from '../services/hermes-agent-service.js';

function makeTask(id: string) {
  return {
    id,
    title: 'Wire Hermes connector',
    description: 'Start real Hermes work from Veritas Start Agent.',
    status: 'todo',
    type: 'code',
    priority: 'high',
    created: '2026-05-09T00:00:00.000Z',
    updated: '2026-05-09T00:00:00.000Z',
    git: {
      repo: 'veritas-kanban',
      branch: 'fix/hermes-connector',
      baseBranch: 'main',
      worktreePath: '/tmp/veritas-worktree',
    },
  };
}

describe('HermesAgentService Start Agent connector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTask.mockImplementation(async (id: string) => makeTask(id));
    mocks.resolveAgent.mockResolvedValue({
      agent: 'claude-code',
      reason: 'best available code agent',
    });
    mocks.sendGatewayRun.mockResolvedValue({ runId: 'run_123', status: 'queued' });
    mocks.getGatewayRun.mockResolvedValue({ runId: 'run_123', status: 'running' });
  });

  it('routes Auto to a concrete agent and starts a Hermes API run', async () => {
    const service = new HermesAgentService();

    const result = await service.startAgent('TASK-HERMES-API', 'auto');

    expect(mocks.resolveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'TASK-HERMES-API' })
    );
    expect(result).toEqual(
      expect.objectContaining({
        taskId: 'TASK-HERMES-API',
        agent: 'claude-code',
        status: 'running',
        backend: 'hermes-api',
        runId: 'run_123',
      })
    );
    expect(result.sessionKey).toMatch(/^veritas:TASK-HERMES-API:attempt_/);
    expect(mocks.sendGatewayRun).toHaveBeenCalledWith(
      expect.stringContaining(
        'POST http://127.0.0.1:3099/api/tasks/TASK-HERMES-API/progress/append'
      ),
      result.sessionKey,
      expect.stringContaining('Veritas kanban task')
    );
    expect(mocks.updateTask).toHaveBeenCalledWith(
      'TASK-HERMES-API',
      expect.objectContaining({
        status: 'in-progress',
        agent: 'claude-code',
        automation: expect.objectContaining({ sessionKey: result.sessionKey }),
      })
    );
    expect(mocks.updateTask).toHaveBeenLastCalledWith(
      'TASK-HERMES-API',
      expect.objectContaining({
        automation: expect.objectContaining({ result: 'Hermes API run started: run_123' }),
      })
    );
  });

  it('fails closed instead of creating a request-file queue when Hermes API is unavailable', async () => {
    mocks.sendGatewayRun.mockRejectedValue(new Error('Hermes gateway unavailable'));
    const service = new HermesAgentService();

    await expect(service.startAgent('TASK-NO-FALLBACK', 'claude-code')).rejects.toThrow(
      /Failed to start agent via Hermes: Hermes gateway unavailable/
    );

    expect(mocks.writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining('.veritas-kanban/agent-requests/TASK-NO-FALLBACK.json'),
      expect.anything()
    );
    expect(mocks.updateTask).toHaveBeenLastCalledWith(
      'TASK-NO-FALLBACK',
      expect.objectContaining({
        status: 'todo',
        attempt: expect.objectContaining({ status: 'failed' }),
        automation: expect.objectContaining({
          result: 'Failed to start Hermes run: Hermes gateway unavailable',
        }),
      })
    );
  });

  it('monitors terminal Hermes success without marking the task done before callback QA proof', async () => {
    mocks.getGatewayRun.mockResolvedValue({ runId: 'run_123', status: 'completed' });
    const service = new HermesAgentService();

    await service.startAgent('TASK-MONITOR-SUCCESS', 'claude-code');
    const status = await service.reconcileRuntime('TASK-MONITOR-SUCCESS');

    expect(status).toEqual(
      expect.objectContaining({
        taskId: 'TASK-MONITOR-SUCCESS',
        runId: 'run_123',
        lastRuntimeStatus: 'completed',
        monitorChecks: 1,
      })
    );
    expect(mocks.updateTask).toHaveBeenCalledWith(
      'TASK-MONITOR-SUCCESS',
      expect.objectContaining({
        status: 'in-progress',
        automation: expect.objectContaining({
          result: expect.stringContaining('awaiting explicit Veritas completion callback'),
        }),
      })
    );
    expect(mocks.updateTask).not.toHaveBeenCalledWith(
      'TASK-MONITOR-SUCCESS',
      expect.objectContaining({ status: 'done' })
    );
  });

  it('escalates failed Hermes runtime state to blocked and clears the pending monitor', async () => {
    mocks.sendGatewayRun.mockResolvedValue({ runId: 'run_failed', status: 'queued' });
    mocks.getGatewayRun.mockResolvedValue({
      runId: 'run_failed',
      status: 'failed',
      error: 'model process exited',
      completedAt: '2026-05-09T00:05:00.000Z',
    });
    const service = new HermesAgentService();

    await service.startAgent('TASK-MONITOR-FAIL', 'claude-code');
    const status = await service.reconcileRuntime('TASK-MONITOR-FAIL');

    expect(status).toBeNull();
    expect(mocks.updateTask).toHaveBeenCalledWith(
      'TASK-MONITOR-FAIL',
      expect.objectContaining({
        status: 'blocked',
        attempt: expect.objectContaining({
          status: 'failed',
          ended: '2026-05-09T00:05:00.000Z',
        }),
        automation: expect.objectContaining({
          result: expect.stringContaining('Escalated by Hermes runtime monitor'),
        }),
      })
    );
    expect(service.getAgentStatus('TASK-MONITOR-FAIL')).toBeNull();
  });
});
