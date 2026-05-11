/**
 * Gateway Chat Client
 *
 * Starts Hermes API-server runs for Veritas chat messages.
 * Legacy non-Hermes runtime aliases are intentionally not accepted.
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../lib/logger.js';

const log = createLogger('gateway-chat');

const GATEWAY_URL =
  process.env.HERMES_API_SERVER_URL ||
  process.env.HERMES_GATEWAY ||
  process.env.HERMES_GATEWAY_URL ||
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
 * Legacy WebSocket chat is disabled. Veritas must use HermesAgent HTTP runs via sendGatewayRun().
 */
export async function sendGatewayChat(
  _message: string,
  _sessionKey: string,
  _callbacks?: StreamCallbacks
): Promise<ChatResponse> {
  throw new Error(
    'Legacy gateway chat WebSocket is disabled; use sendGatewayRun() via HermesAgent /v1/runs'
  );
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
              line.startsWith('HERMES_GATEWAY_TOKEN=')
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
  } catch (err: any) {
    log.warn({ err: err.message }, 'Failed to load gateway token from config');
  }

  return '';
}
