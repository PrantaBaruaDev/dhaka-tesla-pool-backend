import { Router } from 'express';
import { auth } from '../../../middleware/auth';
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
import { Role } from '@/../prisma/generated/prisma/enums';

export const driverRouter = Router();

driverRouter.post('/status', auth(Role.DRIVER), toggleStatusHandler);
driverRouter.get('/requests', auth(Role.DRIVER), listRequestsHandler);
driverRouter.post('/requests/:id/accept', auth(Role.DRIVER), acceptRequestHandler);

driverRouter.get('/pools/active', auth(Role.DRIVER), getActivePoolHandler);
driverRouter.get('/pools/history', auth(Role.DRIVER), poolHistoryHandler);
driverRouter.get('/pools/:id/history', auth(Role.DRIVER), poolAuditHandler); 
driverRouter.post('/pools/:id/arrive', auth(Role.DRIVER), arriveHandler);
driverRouter.post('/pools/:id/start', auth(Role.DRIVER), startHandler);
driverRouter.post('/pools/:id/complete', auth(Role.DRIVER), completeHandler);
driverRouter.get('/passengers/:id', auth(Role.DRIVER), passengerProfileHandler); 
