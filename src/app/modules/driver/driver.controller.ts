import type { Request, Response, NextFunction } from 'express';
import { toggleStatusSchema } from './driver.schema';
import * as driverService from './driver.service';

export async function toggleStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const input = toggleStatusSchema.parse(req.body);
    const tesla = await driverService.setOnlineStatus(req.user!.id, input);
    res.json({ tesla });
  } catch (err) {
    next(err);
  }
}

export async function listRequestsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await driverService.getMatchingRequests(req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getActivePoolHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await driverService.getActivePool(req.user!.id);
    res.json({ pool });
  } catch (err) {
    next(err);
  }
}