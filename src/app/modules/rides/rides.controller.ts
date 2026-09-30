import type { Request, Response, NextFunction } from 'express';
import { createRideSchema, previewRideSchema } from './rides.schema';
import * as ridesService from './rides.service';

export async function createRideHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const input = createRideSchema.parse(req.body);
    const ride = await ridesService.createRide(req.user!.userId, input);
    res.status(201).json({ rideRequest: ride });
  } catch (err) {
    next(err);
  }
}

export async function listMyRidesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rides = await ridesService.getMyRides(req.user!.userId);
    res.json({ rides });
  } catch (err) {
    next(err);
  }
}

export async function getRideHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ride = await ridesService.getRideById(req.params.id as string, req.user!.userId, req.user!.role);
    res.json({ rideRequest: ride });
  } catch (err) {
    next(err);
  }
}

export async function cancelRideHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ride = await ridesService.cancelRide(req.params.id as string, req.user!.userId);
    res.json({ rideRequest: ride });
  } catch (err) {
    next(err);
  }
}

export async function getRideHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const history = await ridesService.getRideHistory(
      req.params.id as string,
      req.user!.userId,
      req.user!.role,
    );
    res.json({ history });
  } catch (err) {
    next(err);
  }
}

export async function previewRideHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const input = previewRideSchema.parse(req.body);
    const preview = await ridesService.previewRide(input);
    res.json({ preview });
  } catch (err) {
    next(err);
  }
}
