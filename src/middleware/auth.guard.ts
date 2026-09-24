import type { Request, Response, NextFunction } from 'express';
import passport from '../app/modules/auth/passport.config';
import { ApiError } from './error.handler';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  passport.authenticate('jwt', { session: false }, (err: unknown, user: Express.User | false) => {
    if (err) return next(err);
    if (!user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Login required.'));
    req.user = user;
    next();
  })(req, res, next);
}

export function requireRole(role: 'PASSENGER' | 'DRIVER') {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Login required.'));
    if (req.user.role !== role) {
      return next(new ApiError(403, 'FORBIDDEN', `Requires role ${role}.`));
    }
    next();
  };
}