import { Router } from 'express';
import { requireAuth, requireRole } from '../../../middleware/auth.guard';
import {
  createRideHandler,
  listMyRidesHandler,
  getRideHandler,
  cancelRideHandler,
  getRideHistoryHandler,
} from './rides.controller';
import { Role } from '@/generated/prisma/enums';

export const ridesRouter = Router();

ridesRouter.use(requireAuth);
ridesRouter.use(requireRole(Role.PASSENGER));

ridesRouter.post('/', createRideHandler);
ridesRouter.get('/me', listMyRidesHandler);
ridesRouter.get('/:id', getRideHandler);
ridesRouter.post('/:id/cancel', cancelRideHandler);


ridesRouter.post('/', createRideHandler);
ridesRouter.get('/me', listMyRidesHandler);
ridesRouter.get('/:id/history', getRideHistoryHandler);  
ridesRouter.get('/:id', getRideHandler);
ridesRouter.post('/:id/cancel', cancelRideHandler);