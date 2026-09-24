import { Router } from 'express';
import { listZonesHandler } from './zones.controller';

export const zonesRouter = Router();

// GET /api/v1/zones — public reference data, no auth required
zonesRouter.get('/', listZonesHandler);