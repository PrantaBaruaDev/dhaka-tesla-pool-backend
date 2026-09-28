import { Router } from 'express';
import { requireAuth, requireRole } from '../../../middleware/auth.guard';
import {
  toggleStatusHandler,
  listRequestsHandler,
  getActivePoolHandler,
  acceptRequestHandler,
  arriveHandler,
  startHandler,
  completeHandler,
  poolHistoryHandler,
  poolAuditHandler,
} from './driver.controller';
import { Role } from '@/../prisma/generated/prisma/enums';

export const driverRouter = Router();

driverRouter.use(requireAuth);
driverRouter.use(requireRole(Role.DRIVER));

driverRouter.post('/status', toggleStatusHandler);
driverRouter.get('/requests', listRequestsHandler);
driverRouter.post('/requests/:id/accept', acceptRequestHandler);

driverRouter.get('/pools/active', getActivePoolHandler);
driverRouter.get('/pools/history', poolHistoryHandler);
driverRouter.get('/pools/:id/history', poolAuditHandler); 
driverRouter.post('/pools/:id/arrive', arriveHandler);
driverRouter.post('/pools/:id/start', startHandler);
driverRouter.post('/pools/:id/complete', completeHandler);
