import { Router } from 'express';
import * as configService from '../services/config';

const router = Router();

// GET /api/config
router.get('/', (_req, res) => {
  const config = configService.getConfig();
  res.json(config);
});

// PUT /api/config
router.put('/', (req, res) => {
  const updated = configService.updateConfig(req.body);
  res.json(updated);
});

export default router;
