import { beforeEach, describe, expect, it, vi } from 'vitest';

const makeResponse = (
  overrides: Partial<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  }> = {}
) => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({ run_id: 'run_123', status: 'queued' }),
  text: vi.fn().mockResolvedValue(''),
  ...overrides,
});

describe('gateway-chat-client Hermes run connector', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env.HERMES_GATEWAY = 'http://hermes.local';
    process.env.HERMES_API_SERVER_KEY = 'test-token';
    delete process.env.API_SERVER_KEY;
    delete process.env.HERMES_GATEWAY_TOKEN;
    delete process.env.CLAWDBOT_GATEWAY_TOKEN;
  });

  it('starts a non-blocking Hermes /v1/runs request with session metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { sendGatewayRun } = await import('../services/gateway-chat-client.js');
    const result = await sendGatewayRun(
      'do the task',
      'veritas:TASK-1:attempt_123',
      'system instructions'
    );

    expect(result).toEqual({ runId: 'run_123', status: 'queued' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://hermes.local/v1/runs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
          'X-Hermes-Session-Key': 'veritas:TASK-1:attempt_123',
        }),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      input: 'do the task',
      session_id: 'veritas:TASK-1:attempt_123',
      instructions: 'system instructions',
    });
  });

  it('surfaces Hermes API errors with response detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeResponse({ ok: false, status: 503, text: vi.fn().mockResolvedValue('gateway down') })
        )
    );

    const { sendGatewayRun } = await import('../services/gateway-chat-client.js');

    await expect(sendGatewayRun('do the task', 'veritas:TASK-2:attempt_123')).rejects.toThrow(
      'Hermes API run request failed (503): gateway down'
    );
  });
});
