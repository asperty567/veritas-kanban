import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRepoHygieneService = vi.hoisted(() => ({
  getOrScanLatest: vi.fn(),
  scanAll: vi.fn(),
}));

vi.mock('../../services/repo-hygiene-service.js', () => ({
  getRepoHygieneService: () => mockRepoHygieneService,
}));

import { repoHygieneRoutes } from '../../routes/repo-hygiene.js';
import { errorHandler } from '../../middleware/error-handler.js';

const healthyState = {
  scannedAt: '2026-01-26T12:00:00.000Z',
  summary: {
    healthy: true,
    blockingRepos: 0,
    warningRepos: 0,
    totalRepos: 1,
  },
  repos: [
    {
      repoName: 'veritas',
      path: '/tmp/veritas',
      branch: 'main',
      expectedBranch: 'main',
      dirty: false,
      untrackedCount: 0,
      modifiedCount: 0,
      ahead: 0,
      behind: 0,
      detachedHead: false,
      hasUpstream: true,
      healthy: true,
      blocking: false,
      scannedAt: '2026-01-26T12:00:00.000Z',
      issues: [],
    },
  ],
};

describe('Repo Hygiene Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/v1/repo-hygiene', repoHygieneRoutes);
    app.use(errorHandler);
  });

  it('GET / returns latest repo hygiene state', async () => {
    mockRepoHygieneService.getOrScanLatest.mockResolvedValue(healthyState);

    const res = await request(app).get('/api/v1/repo-hygiene');

    expect(res.status).toBe(200);
    expect(res.body.summary.healthy).toBe(true);
    expect(res.body.repos[0].repoName).toBe('veritas');
    expect(mockRepoHygieneService.getOrScanLatest).toHaveBeenCalledTimes(1);
  });

  it('POST /scan forces a fresh repo hygiene scan', async () => {
    mockRepoHygieneService.scanAll.mockResolvedValue(healthyState);

    const res = await request(app).post('/api/v1/repo-hygiene/scan');

    expect(res.status).toBe(200);
    expect(res.body.scannedAt).toBe(healthyState.scannedAt);
    expect(mockRepoHygieneService.scanAll).toHaveBeenCalledTimes(1);
  });
});
