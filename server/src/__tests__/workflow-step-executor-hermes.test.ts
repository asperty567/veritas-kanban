import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const mockSendGatewayRun = vi.fn();

vi.mock('../services/gateway-chat-client.js', () => ({
  sendGatewayRun: mockSendGatewayRun,
}));

vi.mock('../services/tool-policy-service.js', () => ({
  getToolPolicyService: () => ({
    getPolicy: vi.fn().mockResolvedValue({ allowed: ['terminal'], denied: ['browser'] }),
    getToolFilterForRole: vi.fn().mockResolvedValue({ allowed: ['terminal'], denied: ['browser'] }),
  }),
}));

describe('WorkflowStepExecutor HermesAgent runtime', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-step-hermes-'));
    mockSendGatewayRun.mockReset();
    mockSendGatewayRun.mockResolvedValue({ runId: 'run-hermes-123', status: 'queued' });
  });

  it('starts HermesAgent runs for agent workflow steps and records observable handles', async () => {
    const { WorkflowStepExecutor } = await import('../services/workflow-step-executor.js');
    const executor = new WorkflowStepExecutor(tmpDir);
    const run: any = {
      id: 'run_1234567890_abcdef',
      workflowId: 'wf-prod',
      workflowVersion: 1,
      taskId: 'task-1',
      status: 'running',
      context: {
        workflow: {
          id: 'wf-prod',
          version: 1,
          agents: [
            { id: 'hawk', name: 'Hawk', role: 'orchestrator', model: 'openai-codex/gpt-5.5' },
          ],
        },
        run: { id: 'run_1234567890_abcdef' },
        _sessions: {},
      },
      startedAt: new Date().toISOString(),
      steps: [],
    };

    const result = await executor.executeStep(
      {
        id: 'triage',
        name: 'Triage task',
        type: 'agent',
        agent: 'hawk',
        input: 'Investigate {{task.title}}',
        acceptance_criteria: ['HermesAgent run'],
      } as any,
      run
    );

    expect(mockSendGatewayRun).toHaveBeenCalledTimes(1);
    expect(mockSendGatewayRun.mock.calls[0][0]).toContain('Investigate');
    expect(mockSendGatewayRun.mock.calls[0][1]).toMatch(/^veritas-workflow:/);
    expect(mockSendGatewayRun.mock.calls[0][2]).toContain(
      'Write completion evidence back to Veritas'
    );
    expect(result).toMatchObject({
      sessionKey: expect.stringMatching(/^veritas-workflow:/),
      runId: 'run-hermes-123',
      status: 'queued',
    });
    expect(run.context._sessions.hawk).toBe(result.sessionKey);

    const output = await fs.readFile(result.outputPath, 'utf8');
    expect(output).toContain('Hermes Run: run-hermes-123');
    expect(output).toContain('STATUS: done');
  });
});
