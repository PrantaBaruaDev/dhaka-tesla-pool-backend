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



export async function acceptRequestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await driverService.acceptRequest(req.user!.id, req.params.id as string);
    res.json({
      pool: result.pool,
      rideRequest: result.ride,
      created: result.created,
    });
  } catch (err) {
    next(err);
  }
}

export async function arriveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await driverService.markArrived(req.user!.id, req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function startHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await driverService.startPool(req.user!.id, req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function completeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await driverService.completePool(req.user!.id, req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function poolHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pools = await driverService.getPoolHistory(req.user!.id);
    res.json({ pools });
  } catch (err) {
    next(err);
  }
}

export async function poolAuditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const audit = await driverService.getPoolAudit(req.user!.id, req.params.id as string);
    res.json({ audit });
  } catch (err) {
    next(err);
  }
}