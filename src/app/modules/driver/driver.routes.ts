import { Router } from 'express';
import { requireAuth, requireRole } from '../../../middleware/auth.guard';
import {
  toggleStatusHandler,
  listRequestsHandler,
  getActivePoolHandler,
} from './driver.controller';

export const driverRouter = Router();

driverRouter.use(requireAuth);
driverRouter.use(requireRole('DRIVER'));

driverRouter.post('/status', toggleStatusHandler);
driverRouter.get('/requests', listRequestsHandler);
driverRouter.get('/pools/active', getActivePoolHandler);
