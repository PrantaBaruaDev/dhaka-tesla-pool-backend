import type { Request, Response, NextFunction } from 'express';
import { createRideSchema } from './rides.schema';
import * as ridesService from './rides.service';

export async function createRideHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const input = createRideSchema.parse(req.body);
    const ride = await ridesService.createRide(req.user!.id, input);
    res.status(201).json({ rideRequest: ride });
  } catch (err) {
    next(err);
  }
}

export async function listMyRidesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rides = await ridesService.getMyRides(req.user!.id);
    res.json({ rides });
  } catch (err) {
    next(err);
  }
}

export async function getRideHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ride = await ridesService.getRideById(req.params.id as string, req.user!.id, req.user!.role);
    res.json({ rideRequest: ride });
  } catch (err) {
    next(err);
  }
}

export async function cancelRideHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ride = await ridesService.cancelRide(req.params.id as string, req.user!.id);
    res.json({ rideRequest: ride });
  } catch (err) {
    next(err);
  }
}