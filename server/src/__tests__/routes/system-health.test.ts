/**
 * System Health Routes — test coverage for #250
 *
 * Tests HTTP status codes and response shape for /api/v1/system/health.
 * Note: This route is mounted BEFORE auth middleware (no auth required).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockGetStatus, mockLogger } = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../services/system-health-service.js', () => ({
  getSystemHealthService: () => ({ getStatus: mockGetStatus }),
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: () => mockLogger,
}));

import { systemHealthRouter } from '../../routes/system-health.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  // No auth middleware — system-health is public by design.
  app.use('/', systemHealthRouter);
  return app;
}

const healthyStatus = {
  timestamp: '2026-05-14T11:50:49.085Z',
  status: 'stable',
  signals: {
    system: { status: 'ok', storage: true, disk: true, memory: true },
    agents: { status: 'ok', total: 10, online: 4, offline: 6 },
    operations: { status: 'ok', recentRuns: 27, successRate: 100, failedRuns: 0 },
  },
};

describe('System Health Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockResolvedValue(healthyStatus);
    app = buildApp();
  });

  describe('auth enforcement', () => {
    it('returns 200 without any authentication token', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('returns 200 with no Authorization header', async () => {
      const res = await request(app).get('/').set('Authorization', '');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /', () => {
    it('delegates health aggregation to SystemHealthService', async () => {
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(mockGetStatus).toHaveBeenCalledTimes(1);
      expect(res.body).toEqual(healthyStatus);
    });

    it('returns valid health response structure', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        timestamp: expect.any(String),
        status: expect.any(String),
        signals: {
          system: expect.objectContaining({
            status: expect.any(String),
            storage: expect.any(Boolean),
            disk: expect.any(Boolean),
            memory: expect.any(Boolean),
          }),
          agents: expect.objectContaining({
            status: expect.any(String),
            total: expect.any(Number),
            online: expect.any(Number),
            offline: expect.any(Number),
          }),
          operations: expect.objectContaining({
            status: expect.any(String),
            recentRuns: expect.any(Number),
            successRate: expect.any(Number),
            failedRuns: expect.any(Number),
          }),
        },
      });
    });

    it('keeps off-shift profiles in the payload without forcing a drifting status', async () => {
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('stable');
      expect(res.body.signals.agents).toMatchObject({
        status: 'ok',
        total: 10,
        online: 4,
        offline: 6,
      });
    });

    it('returns 500 when aggregation fails', async () => {
      mockGetStatus.mockRejectedValue(new Error('aggregation failed'));

      const res = await request(app).get('/');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ status: 'unknown', error: 'Failed to aggregate health' });
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
