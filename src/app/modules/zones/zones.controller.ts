import type { Request, Response, NextFunction } from 'express';
import * as zonesService from './zones.service';

export async function listZonesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const zones = await zonesService.getAllZones();
    res.json({ zones });
  } catch (err) {
    next(err);
  }
}