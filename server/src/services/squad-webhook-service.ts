/**
 * Squad Webhook Service
 *
 * Fires HTTP webhooks when squad messages are posted.
 * Supports HMAC-SHA256 signing for verification.
 */

import crypto from 'crypto';
import type { SquadMessage, SquadWebhookSettings } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { validateWebhookUrl } from '../utils/url-validation.js';

const log = createLogger('squad-webhook');

interface WebhookPayload {
  event: 'squad.message';
  message: {
    id: string;
    agent: string;
    displayName?: string;
    message: string;
    tags?: string[];
    timestamp: string;
    card?: Record<string, unknown>;
  };
  isHuman: boolean;
}

/**
 * Fire a webhook for a squad message.
 * Fire-and-forget: doesn't block on failure, just logs.
 */
export async function fireSquadWebhook(
  message: SquadMessage,
  settings: SquadWebhookSettings
): Promise<void> {
  if (!settings.enabled) {
    return;
  }

  // Determine if this is a human message
  const isHuman = message.agent === 'Human' || message.agent.toLowerCase() === 'human';

  // Check if we should fire for this message type
  if (isHuman && !settings.notifyOnHuman) {
    log.debug({ messageId: message.id }, 'Skipping webhook: notifyOnHuman disabled');
    return;
  }

  if (!isHuman && !settings.notifyOnAgent) {
    log.debug({ messageId: message.id }, 'Skipping webhook: notifyOnAgent disabled');
    return;
  }

  // Route based on mode. Legacy/non-schema modes are intentionally fail-closed.
  if (settings.mode === 'hermes') {
    await fireHermesGatewayWake(message, settings);
  } else if (settings.mode === 'webhook' || settings.mode === 'generic' || !settings.mode) {
    await fireGenericWebhook(message, settings, isHuman);
  } else {
    log.warn({ mode: settings.mode }, 'Squad webhook mode disabled by Hermes cutover');
  }
}

/**
 * Fire a HermesAgent run wake call.
 */
async function fireHermesGatewayWake(
  message: SquadMessage,
  settings: SquadWebhookSettings
): Promise<void> {
  const gatewayUrl = settings.hermesGatewayUrl;
  const gatewayToken = settings.hermesGatewayToken;

  if (!gatewayUrl || !gatewayToken) {
    log.warn('Hermes gateway mode enabled but hermesGatewayUrl or hermesGatewayToken missing');
    return;
  }

  const displayName = message.displayName || message.agent;
  const wakeText = `🗨️ Squad chat from ${displayName}: ${message.message}`;
  const url = `${gatewayUrl.replace(/\/+$/, '')}/v1/runs`;

  const validation = validateWebhookUrl(url);
  if (!validation.valid) {
    log.warn({ url, reason: validation.reason }, 'HermesAgent URL blocked (SSRF prevention)');
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const sessionKey = `veritas:squad:${message.id}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayToken}`,
        'X-Hermes-Session-Key': sessionKey,
      },
      body: JSON.stringify({
        input: wakeText,
        session_id: sessionKey,
        instructions:
          'You are handling a Veritas squad-chat wake. Veritas is task truth; HermesAgent is runtime. Do not call non-Hermes runtime endpoints.',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log.warn(
        { status: response.status, statusText: response.statusText, url },
        'HermesAgent run wake returned non-2xx status'
      );
      return;
    }

    log.info({ messageId: message.id, displayName }, 'HermesAgent run wake fired successfully');
  } catch (err: any) {
    if (err.name === 'AbortError') {
      log.warn({ url }, 'HermesAgent run wake timed out after 5 seconds');
    } else {
      log.error({ err: err.message, url }, 'HermesAgent run wake failed');
    }
  }
}

/**
 * Fire a generic webhook (original behavior)
 */
async function fireGenericWebhook(
  message: SquadMessage,
  settings: SquadWebhookSettings,
  isHuman: boolean
): Promise<void> {
  if (!settings.url) {
    return;
  }

  const validation = validateWebhookUrl(settings.url);
  if (!validation.valid) {
    log.warn(
      { url: settings.url, reason: validation.reason },
      'Squad webhook URL blocked (SSRF prevention)'
    );
    return;
  }

  // Build payload
  const payload: WebhookPayload = {
    event: 'squad.message',
    message: {
      id: message.id,
      agent: message.agent,
      displayName: message.displayName,
      message: message.message,
      tags: message.tags,
      timestamp: message.timestamp,
      ...(message.card && { card: message.card }),
    },
    isHuman,
  };

  // Fire asynchronously (don't block)
  fireWebhookAsync(settings.url, payload, settings.secret).catch((err) => {
    log.error({ err: err.message, messageId: message.id }, 'Squad webhook failed');
  });
}

/**
 * Actually send the webhook (async, with timeout and signing)
 */
async function fireWebhookAsync(
  url: string,
  payload: WebhookPayload,
  secret?: string
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Veritas-Kanban-Squad-Webhook/1.0',
  };

  // Add HMAC signature if secret is configured
  if (secret) {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-VK-Signature'] = `sha256=${signature}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log.warn(
        { status: response.status, statusText: response.statusText, url },
        'Squad webhook returned non-2xx status'
      );
      return;
    }

    log.info({ messageId: payload.message.id, url }, 'Squad webhook fired successfully');
  } catch (err: any) {
    if (err.name === 'AbortError') {
      log.warn({ url }, 'Squad webhook timed out after 5 seconds');
      throw new Error('Webhook timeout');
    }
    log.error({ err: err.message, url }, 'Squad webhook request failed');
    throw err;
  }
}
