import { Router } from 'express';
import { listZonesHandler } from './zones.controller';

export const zonesRouter = Router();

zonesRouter.get('/', listZonesHandler);