import type { Task } from '@veritas-kanban/shared';
import { readFileSync } from 'node:fs';
import { createLogger } from '../lib/logger.js';
import { getNotificationService } from './notification-service.js';

const log = createLogger('blocked-alerts');
const DEFAULT_ANDY_CHAT_ID = '8601358413';
const BLOCKED_ALERT_LOCK_TTL_MS = 5 * 60_000;
const APPROVAL_BLOCKED_CATEGORIES = new Set(['waiting-on-feedback', 'prerequisite']);

const ENV_CANDIDATE_PATHS = [
  '/Users/admin/.hermes/profiles/hawk/.env',
  '/Users/admin/Projects/mission-control-production/.env.local',
  '/Users/admin/Projects/mission-control/.env.local',
  '/Users/admin/Projects/veritas-kanban/server/.env',
] as const;

const activeBlockedAlerts = new Map<string, number>();

function stripEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFromFiles(key: string): string {
  for (const filePath of ENV_CANDIDATE_PATHS) {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const line = raw
        .split(/\r?\n/)
        .find((entry) => entry.startsWith(`${key}=`) || entry.startsWith(`export ${key}=`));
      if (!line) continue;
      const value = line.slice(line.indexOf('=') + 1);
      const parsed = stripEnvValue(value);
      if (parsed) return parsed;
    } catch {
      // Keep trying fallback files. Never log env file contents.
    }
  }
  return '';
}

function resolveTelegramBotToken(): string {
  return (
    process.env.TELEGRAM_BOT_TOKEN_HAWK ||
    process.env.TELEGRAM_BOT_TOKEN_LINK ||
    process.env.TELEGRAM_BOT_TOKEN ||
    readEnvFromFiles('TELEGRAM_BOT_TOKEN_HAWK') ||
    readEnvFromFiles('TELEGRAM_BOT_TOKEN_LINK') ||
    readEnvFromFiles('TELEGRAM_BOT_TOKEN') ||
    ''
  ).trim();
}

function resolveTelegramChatId(): string {
  return (
    process.env.TELEGRAM_CHAT_ID_HAWK ||
    process.env.TELEGRAM_CHAT_ID_LINK ||
    process.env.TELEGRAM_CHAT_ID ||
    readEnvFromFiles('TELEGRAM_CHAT_ID_HAWK') ||
    readEnvFromFiles('TELEGRAM_CHAT_ID_LINK') ||
    readEnvFromFiles('TELEGRAM_CHAT_ID') ||
    DEFAULT_ANDY_CHAT_ID
  ).trim();
}

function resolveDiscordWebhookUrl(): string {
  return (
    process.env.DISCORD_BLOCKED_ALERT_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL ||
    readEnvFromFiles('DISCORD_BLOCKED_ALERT_WEBHOOK_URL') ||
    readEnvFromFiles('DISCORD_WEBHOOK_URL') ||
    ''
  ).trim();
}

function resolveDiscordBotToken(): string {
  return (process.env.DISCORD_BOT_TOKEN || readEnvFromFiles('DISCORD_BOT_TOKEN') || '').trim();
}

function resolveDiscordChannelId(): string {
  return (
    process.env.DISCORD_HOME_CHANNEL ||
    readEnvFromFiles('DISCORD_HOME_CHANNEL') ||
    ''
  ).trim();
}

function truncate(value: string, max = 1200): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function taskShortId(taskId: string): string {
  return taskId.split('_').filter(Boolean).pop() || taskId;
}

function blockedCategory(task: Task): string {
  const reason = task.blockedReason;
  if (reason && typeof reason === 'object' && 'category' in reason) {
    const category = String((reason as unknown as Record<string, unknown>).category || '').trim();
    if (category) return category;
  }
  return 'other';
}

function extractEvidence(task: Task, reasonText: string): string[] {
  const evidence: string[] = [];
  const git = task.git;
  if (git?.repo) evidence.push(`Repo: ${git.repo}`);
  if (git?.branch) evidence.push(`Branch: ${git.branch}`);
  if (git?.prUrl) evidence.push(`PR: ${git.prUrl}`);

  const searchable = [
    reasonText,
    task.description || '',
    task.automation?.result || '',
    ...(task.comments || []).map((comment) => comment.text || ''),
    ...(task.observations || []).map((observation) => observation.content || ''),
  ].join('\n');
  const commit = searchable.match(/\b[0-9a-f]{7,40}\b/i)?.[0];
  evidence.push(`Commit: ${commit || 'not attached'}`);

  return evidence;
}

function approvalConsequence(category: string): string {
  if (category === 'waiting-on-feedback') {
    return 'Approve = human sign-off to proceed with the requested feedback/deploy/runtime action. Deny = keep blocked and record that the requested action is not approved.';
  }
  if (category === 'prerequisite') {
    return 'Approve = prerequisite is accepted and Hawk may continue the merge/deploy/live-verification path. Deny = keep blocked until prerequisite evidence changes.';
  }
  return 'Approve = human sign-off to continue. Deny = keep blocked for follow-up.';
}

function evictExpiredBlockedAlertLocks(): void {
  const cutoff = Date.now() - BLOCKED_ALERT_LOCK_TTL_MS;
  for (const [taskId, timestamp] of activeBlockedAlerts.entries()) {
    if (timestamp < cutoff) {
      activeBlockedAlerts.delete(taskId);
    }
  }
}

function tryAcquireBlockedAlertLock(taskId: string): boolean {
  evictExpiredBlockedAlertLocks();
  if (activeBlockedAlerts.has(taskId)) return false;
  activeBlockedAlerts.set(taskId, Date.now());
  return true;
}

function releaseBlockedAlertLock(taskId: string): void {
  activeBlockedAlerts.delete(taskId);
}

function describeBlockedReason(task: Task): string {
  const reason = task.blockedReason;
  if (!reason) return 'No blocked reason attached.';
  if (typeof reason === 'string') return reason;

  const parts: string[] = [];
  const shaped = reason as unknown as Record<string, unknown>;
  for (const key of ['category', 'note', 'reason', 'message', 'details', 'source']) {
    const value = shaped[key];
    if (typeof value === 'string' && value.trim()) {
      parts.push(`${key}: ${value.trim()}`);
    }
  }
  return parts.length ? parts.join(' · ') : JSON.stringify(reason).slice(0, 400);
}

function notificationTargets(task: Task): string[] {
  const targets = new Set<string>(['hawk']);
  const agent = String(task.agent || '')
    .trim()
    .toLowerCase();
  if (agent && agent !== 'auto' && agent !== 'veritas') {
    targets.add(agent);
  }
  return Array.from(targets);
}

export function buildBlockedTaskAlertMessage(task: Task, previousStatus: string): string {
  const title = String(task.title || task.id || 'Untitled task');
  const agent = String(task.agent || 'unassigned');
  const category = blockedCategory(task);
  const reason = truncate(describeBlockedReason(task), 900);
  const evidence = extractEvidence(task, reason);
  const shortId = taskShortId(task.id);

  return [
    APPROVAL_BLOCKED_CATEGORIES.has(category)
      ? `🚨 NEEDS YOUR APPROVAL: ${title}`
      : `🚨 VERITAS BLOCKED: ${title}`,
    `Task: ${task.id} (${shortId})`,
    `Blocker type: ${category}`,
    `Agent: ${agent}`,
    `Transition: ${previousStatus} → blocked`,
    '',
    'Why it needs attention:',
    reason,
    '',
    'Evidence:',
    ...evidence.map((entry) => `- ${entry}`),
    '',
    'Approval consequence:',
    approvalConsequence(category),
    '',
    `Buttons: Approve = ea:${shortId}:approve · Deny = ea:${shortId}:deny`,
    '',
    'Safety: this alert does not auto-close the blocker or restart/deploy anything. It only records your decision for Hawk to act on.',
  ].join('\n');
}

export function buildTelegramApprovalKeyboard(task: Task): Record<string, unknown> | undefined {
  const category = blockedCategory(task);
  if (!APPROVAL_BLOCKED_CATEGORIES.has(category)) return undefined;
  const shortId = taskShortId(task.id);
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `ea:${shortId}:approve` },
        { text: '❌ Deny', callback_data: `ea:${shortId}:deny` },
      ],
    ],
  };
}

async function sendTelegramAlert(message: string, task: Task): Promise<void> {
  const token = resolveTelegramBotToken();
  if (!token) {
    log.warn('Telegram bot token not configured; blocked alert kept as Veritas notification only');
    return;
  }

  const replyMarkup = buildTelegramApprovalKeyboard(task);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: resolveTelegramChatId(),
      text: message,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await response.json().catch(() => ({ ok: false }))) as { ok?: boolean };
  if (!response.ok || data.ok !== true) {
    throw new Error(`Telegram blocked alert failed: ${JSON.stringify(data)}`);
  }
}

async function sendDiscordAlert(message: string): Promise<void> {
  const payload = {
    content: truncate(message, 1900),
    allowed_mentions: { parse: [] },
  };
  const webhookUrl = resolveDiscordWebhookUrl();
  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Discord blocked alert failed: HTTP ${response.status} ${body.slice(0, 300)}`
      );
    }
    return;
  }

  const botToken = resolveDiscordBotToken();
  const channelId = resolveDiscordChannelId();
  if (!botToken || !channelId) {
    log.warn(
      'Discord webhook/bot channel not configured; blocked alert kept on Telegram and Veritas notifications'
    );
    return;
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Discord bot blocked alert failed: HTTP ${response.status} ${body.slice(0, 300)}`
    );
  }
}

export async function alertTaskBlocked(task: Task, previousStatus: string): Promise<void> {
  if (task.status !== 'blocked') return;
  if (!tryAcquireBlockedAlertLock(task.id)) return;

  try {
    const message = buildBlockedTaskAlertMessage(task, previousStatus);
    const notificationService = getNotificationService();
    await notificationService.notifyStatusChange({
      taskId: task.id,
      targetAgents: notificationTargets(task),
      fromAgent: 'veritas',
      content: message,
    });

    try {
      await sendTelegramAlert(message, task);
    } catch (err) {
      log.warn({ taskId: task.id, err }, 'Telegram blocked alert delivery failed');
    }

    try {
      await sendDiscordAlert(message);
    } catch (err) {
      log.warn({ taskId: task.id, err }, 'Discord blocked alert delivery failed');
    }
  } finally {
    releaseBlockedAlertLock(task.id);
  }
}
