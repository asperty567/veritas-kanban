/**
 * Gateway Chat Client
 *
 * Starts Hermes API-server runs for Veritas chat messages.
 * Legacy Clawdbot/OpenClaw env names remain compatibility aliases only.
 * The legacy WebSocket client remains for old callers only.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { createLogger } from '../lib/logger.js';

const log = createLogger('gateway-chat');

const GATEWAY_URL =
  process.env.HERMES_API_SERVER_URL ||
  process.env.HERMES_GATEWAY ||
  process.env.HERMES_GATEWAY_URL ||
  process.env.CLAWDBOT_GATEWAY ||
  'http://127.0.0.1:8642';
const PROTOCOL_VERSION = 3;
const CONNECT_TIMEOUT_MS = 10_000;
const RESPONSE_TIMEOUT_MS = 120_000; // 2 minutes for AI response

// Cached token — populated lazily
let cachedToken: string | null = null;

function getToken(): string {
  if (cachedToken) return cachedToken;
  return (
    process.env.HERMES_API_SERVER_KEY ||
    process.env.API_SERVER_KEY ||
    process.env.HERMES_GATEWAY_TOKEN ||
    process.env.CLAWDBOT_GATEWAY_TOKEN ||
    ''
  );
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${pathname}`;
}

/**
 * Start a non-blocking Hermes API-server run and return its run id immediately.
 * This is the durable backend for Veritas Start Agent / Auto routing: Hermes owns
 * execution, while Veritas records the run id/session key for progress tracking.
 */
export async function sendGatewayRun(
  message: string,
  sessionKey: string,
  instructions?: string
): Promise<RunResponse> {
  await loadGatewayToken();
  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hermes-Session-Key': sessionKey,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(joinUrl(GATEWAY_URL, '/v1/runs'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: message,
        session_id: sessionKey,
        instructions,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // ignore unreadable bodies
      }
      throw new Error(
        `Hermes API run request failed (${response.status})${detail ? `: ${detail}` : ''}`
      );
    }

    const payload = (await response.json()) as { run_id?: string; runId?: string; status?: string };
    const runId = payload.run_id || payload.runId;
    if (!runId) {
      throw new Error('Hermes API run response did not include run_id');
    }

    log.info({ sessionKey, runId, status: payload.status }, 'Hermes run started');
    return { runId, status: payload.status || 'started' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read Hermes API-server runtime state for a previously-started run. Veritas uses
 * this as a monitor only: terminal success is not enough to mark a task done;
 * the agent still has to call back with board/QA evidence.
 */
export async function getGatewayRun(
  runId: string,
  sessionKey?: string
): Promise<RunStatusResponse> {
  await loadGatewayToken();
  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (sessionKey) {
      headers['X-Hermes-Session-Key'] = sessionKey;
    }

    const response = await fetch(joinUrl(GATEWAY_URL, `/v1/runs/${encodeURIComponent(runId)}`), {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // ignore unreadable bodies
      }
      throw new Error(
        `Hermes API run status failed (${response.status})${detail ? `: ${detail}` : ''}`
      );
    }

    const payload = (await response.json()) as {
      id?: string;
      run_id?: string;
      runId?: string;
      status?: string;
      state?: string;
      error?: string | { message?: string };
      last_error?: string | { message?: string };
      completed_at?: string;
      completedAt?: string;
    };
    const resolvedRunId = payload.run_id || payload.runId || payload.id || runId;
    const status = payload.status || payload.state;
    if (!status) {
      throw new Error('Hermes API run status response did not include status/state');
    }
    const rawError = payload.error || payload.last_error;
    const error =
      typeof rawError === 'string' ? rawError : rawError?.message ? rawError.message : undefined;

    return {
      runId: resolvedRunId,
      status,
      error,
      completedAt: payload.completed_at || payload.completedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface ChatResponse {
  text: string;
  usage?: Record<string, unknown>;
  error?: string;
}

export interface RunResponse {
  runId: string;
  status: string;
}

export interface RunStatusResponse {
  runId: string;
  status: string;
  error?: string;
  completedAt?: string;
}

interface StreamCallbacks {
  onDelta?: (text: string) => void;
  onFinal?: (response: ChatResponse) => void;
  onError?: (error: string) => void;
}

/**
 * Send a message to the Hermes Gateway and collect the response.
 * Opens a temporary WebSocket connection for each request.
 */
export async function sendGatewayChat(
  message: string,
  sessionKey: string,
  callbacks?: StreamCallbacks
): Promise<ChatResponse> {
  const wsUrl = GATEWAY_URL.replace(/^http/, 'ws');

  return new Promise((resolve, reject) => {
    let connected = false;
    let settled = false;
    let responseText = '';
    let responseUsage: Record<string, unknown> | undefined;
    let connectTimer: ReturnType<typeof setTimeout>;
    let responseTimer: ReturnType<typeof setTimeout>;

    const ws = new WebSocket(wsUrl);

    const cleanup = () => {
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    const safeReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const safeResolve = (value: ChatResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    connectTimer = setTimeout(() => {
      if (!connected) {
        const err = 'Gateway connection timeout';
        callbacks?.onError?.(err);
        safeReject(new Error(err));
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on('error', (err) => {
      log.error({ err: err.message }, 'Gateway WebSocket error');
      const errMsg = `Gateway connection failed: ${err.message}`;
      callbacks?.onError?.(errMsg);
      safeReject(new Error(errMsg));
    });

    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // Step 1: Handle challenge → send connect
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        ws.send(
          JSON.stringify({
            type: 'req',
            id: randomUUID(),
            method: 'connect',
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: 'gateway-client',
                version: '1.0.0',
                platform: 'node',
                mode: 'backend',
              },
              auth: { token: getToken() },
            },
          })
        );
        return;
      }

      // Step 2: Handle connect response → send chat.send
      if (msg.type === 'res' && msg.ok && msg.payload?.type === 'hello-ok') {
        connected = true;
        clearTimeout(connectTimer);

        log.info({ sessionKey }, 'Connected to gateway, sending chat message');

        // Start response timeout
        responseTimer = setTimeout(() => {
          const err = 'Gateway response timeout';
          callbacks?.onError?.(err);
          safeReject(new Error(err));
        }, RESPONSE_TIMEOUT_MS);

        ws.send(
          JSON.stringify({
            type: 'req',
            id: randomUUID(),
            method: 'chat.send',
            params: {
              sessionKey,
              message,
              idempotencyKey: randomUUID(),
            },
          })
        );
        return;
      }

      // Handle chat.send ack
      if (msg.type === 'res' && msg.ok && msg.payload?.runId) {
        log.debug({ runId: msg.payload.runId }, 'Chat run started');
        return;
      }

      // Handle errors
      if (msg.type === 'res' && !msg.ok) {
        const errMsg = msg.error?.message || 'Unknown gateway error';
        log.error({ error: msg.error }, 'Gateway error');
        callbacks?.onError?.(errMsg);
        safeReject(new Error(errMsg));
        return;
      }

      // Step 3: Handle streaming chat events
      if (msg.type === 'event' && msg.event === 'chat') {
        const payload = msg.payload || {};

        if (payload.state === 'delta') {
          // Gateway sends full accumulated text in each delta, not incremental chunks
          const content = payload.message?.content;
          if (Array.isArray(content)) {
            let fullText = '';
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
              }
            }
            // Calculate the new chunk (what was added since last delta)
            const newChunk = fullText.slice(responseText.length);
            responseText = fullText;
            if (newChunk) {
              callbacks?.onDelta?.(newChunk);
            }
          }
        }

        if (payload.state === 'final') {
          // Extract final text if we didn't get it from deltas
          if (!responseText && payload.message?.content) {
            const content = payload.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  responseText += block.text;
                }
              }
            } else if (typeof content === 'string') {
              responseText = content;
            }
          }

          responseUsage = payload.usage;

          const response: ChatResponse = {
            text: responseText,
            usage: responseUsage,
          };

          log.info({ sessionKey, textLength: responseText.length }, 'Chat response complete');
          callbacks?.onFinal?.(response);
          safeResolve(response);
          return;
        }

        if (payload.state === 'error') {
          const errMsg = payload.errorMessage || 'Chat error';
          callbacks?.onError?.(errMsg);
          safeReject(new Error(errMsg));
          return;
        }

        if (payload.state === 'aborted') {
          const response: ChatResponse = {
            text: responseText || '(response aborted)',
          };
          callbacks?.onFinal?.(response);
          safeResolve(response);
          return;
        }
      }
    });

    ws.on('close', () => {
      if (!connected) {
        safeReject(new Error('Gateway WebSocket closed before connecting'));
      }
    });
  });
}

/**
 * Load the gateway token from config file if not in env
 */
export async function loadGatewayToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (process.env.HERMES_API_SERVER_KEY) {
    cachedToken = process.env.HERMES_API_SERVER_KEY;
    return cachedToken;
  }
  if (process.env.API_SERVER_KEY) {
    cachedToken = process.env.API_SERVER_KEY;
    process.env.HERMES_API_SERVER_KEY = cachedToken;
    return cachedToken;
  }
  if (process.env.HERMES_GATEWAY_TOKEN) {
    cachedToken = process.env.HERMES_GATEWAY_TOKEN;
    return cachedToken;
  }
  if (process.env.CLAWDBOT_GATEWAY_TOKEN) {
    cachedToken = process.env.CLAWDBOT_GATEWAY_TOKEN;
    process.env.HERMES_GATEWAY_TOKEN = cachedToken;
    return cachedToken;
  }

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const envPaths = [
      path.join(process.env.HOME || '', '.hermes', '.env'),
      path.join(process.env.HOME || '', '.hermes', 'profiles', 'default', '.env'),
    ];
    for (const envPath of envPaths) {
      try {
        const rawEnv = await fs.readFile(envPath, 'utf-8');
        const token = rawEnv
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(
            (line) =>
              line.startsWith('HERMES_API_SERVER_KEY=') ||
              line.startsWith('API_SERVER_KEY=') ||
              line.startsWith('HERMES_GATEWAY_TOKEN=') ||
              line.startsWith('CLAWDBOT_GATEWAY_TOKEN=')
          )
          ?.replace(/^[^=]+=/, '')
          .replace(/^['"]|['"]$/g, '');
        if (token) {
          cachedToken = token;
          process.env.HERMES_GATEWAY_TOKEN = token;
          return token;
        }
      } catch {
        // Try the next Hermes env path before falling back to legacy config.
      }
    }

    const configPath = path.join(process.env.HOME || '', '.clawdbot', 'clawdbot.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const token = config?.gateway?.auth?.token;
    if (token) {
      cachedToken = token;
      process.env.HERMES_GATEWAY_TOKEN = token;
      return token;
    }
  } catch (err: any) {
    log.warn({ err: err.message }, 'Failed to load gateway token from config');
  }

  return '';
}
