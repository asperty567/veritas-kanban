import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { getRepoHygieneService } from '../services/repo-hygiene-service.js';

const router: RouterType = Router();
const repoHygieneService = getRepoHygieneService();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const fresh = req.query.fresh === 'true';
    const state = fresh
      ? await repoHygieneService.scanAll()
      : await repoHygieneService.getOrScanLatest();
    res.json(state);
  })
);

router.post(
  '/scan',
  asyncHandler(async (_req, res) => {
    const state = await repoHygieneService.scanAll();
    res.json(state);
  })
);

export const repoHygieneRoutes = router;
