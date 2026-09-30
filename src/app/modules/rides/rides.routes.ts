import { Router } from 'express';
import { auth } from '../../../middleware/auth';
import {
  createRideHandler,
  listMyRidesHandler,
  getRideHandler,
  cancelRideHandler,
  previewRideHandler,
  getRideHistoryHandler,
} from './rides.controller';
import { Role } from '@/../prisma/generated/prisma/enums';

export const ridesRouter = Router();

ridesRouter.post('/preview', auth(Role.PASSENGER), previewRideHandler);
ridesRouter.post('/', auth(Role.PASSENGER), createRideHandler);
ridesRouter.get('/me', auth(Role.PASSENGER), listMyRidesHandler);
ridesRouter.get('/:id/history', auth(Role.PASSENGER), getRideHistoryHandler);
ridesRouter.get('/:id', auth(Role.PASSENGER), getRideHandler);
ridesRouter.post('/:id/cancel', auth(Role.PASSENGER), cancelRideHandler);

