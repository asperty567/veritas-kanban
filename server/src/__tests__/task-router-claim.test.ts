import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { TaskService } from '../services/task-service.js';

const agent = 'veritas';
const model = 'openai-codex:gpt-5.5';

describe('TaskService router selector/claim', () => {
  let rootDir: string;
  let service: TaskService;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-router-claim-'));
    service = new TaskService({
      tasksDir: path.join(rootDir, 'active'),
      archiveDir: path.join(rootDir, 'archive'),
    });
  });

  afterEach(async () => {
    service.dispose();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('selects runnable leaf tasks and excludes blocked/done/in-progress with active leases', async () => {
    const high = await service.createTask({ title: 'High runnable', priority: 'high' });
    const low = await service.createTask({ title: 'Low runnable', priority: 'low' });
    const done = await service.createTask({
      title: 'Done task',
      type: 'research',
      priority: 'high',
    });
    const blocked = await service.createTask({ title: 'Blocked task', priority: 'high' });
    const parent = await service.createTask({
      title: 'Parent task with open subtask',
      priority: 'high',
      subtasks: [
        { id: 'sub_1', title: 'child work', completed: false, created: new Date().toISOString() },
      ],
    });
    const activeClaim = await service.createTask({ title: 'Already leased', priority: 'high' });
    const expiredClaim = await service.createTask({
      title: 'Expired leased task',
      priority: 'medium',
    });

    await service.updateTask(done.id, {
      status: 'done',
      reviewComments: [
        {
          id: 'review-router-claim-done',
          file: 'server/src/__tests__/task-router-claim.test.ts',
          line: 49,
          content: 'Router selector fixture completed with required deliverable evidence.',
          created: new Date().toISOString(),
        },
      ],
      deliverables: [
        {
          id: 'deliverable-router-claim-done',
          title: 'Router selector completion evidence',
          type: 'report',
          path: 'file:///tmp/veritas-router-claim/done-task.md',
          status: 'attached',
          created: new Date().toISOString(),
          description: 'Test deliverable required by completion gate',
        },
      ],
    });
    await service.updateTask(blocked.id, {
      status: 'blocked',
      blockedReason: { category: 'prerequisite', note: 'waiting on dependency' },
    });
    await service.updateTask(activeClaim.id, {
      status: 'in-progress',
      claim: {
        agent,
        sessionId: 'active-session',
        claimedAt: new Date(Date.now() - 60_000).toISOString(),
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        model,
      },
    });
    await service.updateTask(expiredClaim.id, {
      status: 'in-progress',
      claim: {
        agent,
        sessionId: 'expired-session',
        claimedAt: new Date(Date.now() - 120_000).toISOString(),
        leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        model,
      },
    });

    const runnable = await service.selectRunnableTasks({ limit: 10 });
    const ids = runnable.map((task) => task.id);

    expect(ids.slice(0, 3)).toEqual([high.id, expiredClaim.id, low.id]);
    expect(ids).not.toContain(done.id);
    expect(ids).not.toContain(blocked.id);
    expect(ids).not.toContain(parent.id);
    expect(ids).not.toContain(activeClaim.id);
  });

  it('claims concrete agent/session/model identity and is idempotent for the same session', async () => {
    const task = await service.createTask({ title: 'Claim me', priority: 'high' });

    const first = await service.claimRunnableTask({
      agent,
      sessionId: 'session-a',
      model,
      leaseMinutes: 15,
    });

    expect(first.claimed).toBe(true);
    expect(first.idempotent).toBe(false);
    expect(first.task?.id).toBe(task.id);
    expect(first.task?.status).toBe('in-progress');
    expect(first.task?.attempt).toMatchObject({ agent, status: 'running' });
    expect(first.task?.automation?.sessionKey).toBe('session-a');
    expect(first.task?.claim).toMatchObject({ agent, sessionId: 'session-a', model });
    expect(Date.parse(first.task?.claim?.leaseExpiresAt ?? '')).toBeGreaterThan(Date.now());

    const second = await service.claimRunnableTask({
      agent,
      sessionId: 'session-a',
      model,
      leaseMinutes: 15,
    });

    expect(second.claimed).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.task?.id).toBe(task.id);
  });
});
