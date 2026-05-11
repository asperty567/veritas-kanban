import { describe, expect, it } from 'vitest';
import {
  buildHermesArgs,
  buildHermesPrompt,
  DEFAULT_VERITAS_API_BASE,
  dispatchAgentRequest,
  dispatchPendingToHermes,
  loadPendingAgentRequests,
  parseWorktreeFromPrompt,
  resolveHermesRoute,
} from '../src/commands/hermes-dispatcher.js';

describe('Hermes dispatcher adapter retirement', () => {
  it('keeps default Veritas API constant and Hermes model route for compatibility', () => {
    expect(DEFAULT_VERITAS_API_BASE).toBe('http://127.0.0.1:3099');
    expect(resolveHermesRoute()).toEqual({ provider: 'openai-codex', model: 'gpt-5.5' });
    expect(resolveHermesRoute({}, { provider: 'openai-codex', model: 'gpt-5.5' })).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.5',
    });
  });

  it('fails closed instead of polling pending API or request-file queues', async () => {
    await expect(loadPendingAgentRequests()).rejects.toThrow(
      /Legacy CLI pending\/request-file dispatch is retired/
    );
    await expect(dispatchPendingToHermes()).rejects.toThrow(/Veritas runnable\/claim APIs/);
    await expect(dispatchAgentRequest()).rejects.toThrow(/do not poll \/api\/agents\/pending/);
  });

  it('retired helper surfaces cannot build local Hermes CLI spawns', () => {
    expect(() => buildHermesArgs()).toThrow(/request-file dispatch is retired/);
    expect(() => buildHermesPrompt()).toThrow(/request-file dispatch is retired/);
    expect(parseWorktreeFromPrompt('**Worktree:** `/tmp/veritas-worktree`')).toBeUndefined();
  });
});
