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
  passengerProfileHandler,
} from './driver.controller';

export const driverRouter = Router();

driverRouter.use(requireAuth);
driverRouter.use(requireRole('DRIVER'));

driverRouter.post('/status', toggleStatusHandler);
driverRouter.get('/requests', listRequestsHandler);
driverRouter.get('/pools/active', getActivePoolHandler);
driverRouter.get('/pools/history', poolHistoryHandler);
driverRouter.get('/pools/:id/history', poolAuditHandler); 
driverRouter.post('/pools/:id/arrive', arriveHandler);
driverRouter.post('/pools/:id/start', startHandler);
driverRouter.post('/pools/:id/complete', completeHandler);
driverRouter.get('/passengers/:id', passengerProfileHandler); 
