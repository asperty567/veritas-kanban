import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Task } from '@veritas-kanban/shared';
import {
  buildBlockedTaskAlertMessage,
  buildTelegramApprovalKeyboard,
} from '../services/blocked-alert-service.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(serverRoot, relativePath), 'utf8');
}

describe('blocked task alerts', () => {
  const baseTask: Task = {
    id: 'task_20260515_wVhU0M',
    title: 'Relay UX browser QA',
    description: 'Ready at commit e0632c354 for approval.',
    type: 'code',
    status: 'blocked',
    priority: 'high',
    created: '2026-05-15T00:00:00.000Z',
    updated: '2026-05-15T00:00:00.000Z',
    agent: 'hawk',
    blockedReason: {
      category: 'waiting-on-feedback',
      note: 'Needs deploy approval before runtime changes.',
    },
    git: {
      repo: 'hermes-agent',
      branch: 'fix/hawk-context-bulk',
      baseBranch: 'main',
    },
  };

  it('fires an alert when TaskService transitions a task into blocked', () => {
    const source = read('services/task-service.ts');

    expect(source).toContain("import { alertTaskBlocked } from './blocked-alert-service.js';");
    expect(source).toContain("updatedTask.status === 'blocked' && previousStatus !== 'blocked'");
    expect(source).toContain('alertTaskBlocked(updatedTask, previousStatus)');
  });

  it('persists Veritas notifications and sends Telegram without exposing secrets', () => {
    const source = read('services/blocked-alert-service.ts');

    expect(source).toContain("new Set<string>(['hawk'])");
    expect(source).toContain('notifyStatusChange');
    expect(source).toContain('https://api.telegram.org/bot${token}/sendMessage');
    expect(source).toContain('reply_markup');
    expect(source).toContain('DISCORD_BLOCKED_ALERT_WEBHOOK_URL');
    expect(source).toContain('DISCORD_WEBHOOK_URL');
    expect(source).toContain('DISCORD_BOT_TOKEN');
    expect(source).toContain('DISCORD_HOME_CHANNEL');
    expect(source).toContain('https://discord.com/api/v10/channels/${channelId}/messages');
    expect(source).toContain('allowed_mentions');
    expect(source).toContain('TELEGRAM_BOT_TOKEN_HAWK');
    expect(source).toContain('/Users/admin/.hermes/profiles/hawk/.env');
    expect(source).not.toMatch(/console\.log\([^)]*token/i);
  });

  it('formats approval blockers with clear context, evidence, and explicit callback payloads', () => {
    const message = buildBlockedTaskAlertMessage(baseTask, 'in-progress');

    expect(message).toContain('🚨 NEEDS YOUR APPROVAL: Relay UX browser QA');
    expect(message).toContain('Task: task_20260515_wVhU0M (wVhU0M)');
    expect(message).toContain('Blocker type: waiting-on-feedback');
    expect(message).toContain('Needs deploy approval before runtime changes.');
    expect(message).toContain('Commit: e0632c354');
    expect(message).toContain('Approve = ea:wVhU0M:approve');
    expect(message).toContain('Deny = ea:wVhU0M:deny');
    expect(message).toContain('does not auto-close the blocker or restart/deploy anything');
  });

  it('attaches Telegram approval and denial buttons only to human-approval blocker categories', () => {
    expect(buildTelegramApprovalKeyboard(baseTask)).toEqual({
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: 'ea:wVhU0M:approve' },
          { text: '❌ Deny', callback_data: 'ea:wVhU0M:deny' },
        ],
      ],
    });

    expect(
      buildTelegramApprovalKeyboard({
        ...baseTask,
        id: 'task_20260515_other',
        blockedReason: { category: 'technical-snag', note: 'Worker crashed.' },
      })
    ).toBeUndefined();
  });

  it('stores notifications under the live Veritas data root when configured', () => {
    const source = read('services/notification-service.ts');

    expect(source).toContain('process.env.VERITAS_DATA_DIR');
    expect(source).toContain('async notifyStatusChange');
    expect(source).toContain("type: 'status_change'");
  });
});
