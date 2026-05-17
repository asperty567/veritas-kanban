/**
 * System Health Aggregator Route
 *
 * GET /api/v1/system/health
 *
 * Aggregates system health signals (infrastructure, agents, operations)
 * into a single response for the frontend status bar.
 *
 * No auth required — mounted before auth middleware, same pattern as /health/ready.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { createLogger } from '../lib/logger.js';
import { getSystemHealthService } from '../services/system-health-service.js';

const log = createLogger('system-health');

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const response = await getSystemHealthService().getStatus();
    res.json(response);
  } catch (err) {
    log.error({ err }, 'Failed to aggregate system health');
    res.status(500).json({ status: 'unknown', error: 'Failed to aggregate health' });
  }
});

export { router as systemHealthRouter };
