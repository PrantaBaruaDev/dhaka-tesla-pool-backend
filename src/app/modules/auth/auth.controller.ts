import type { Request, Response, NextFunction } from 'express';
import passport from './passport.config';
import { signupSchema, loginSchema } from './auth.schema';
import * as authService from './auth.service';
import { COOKIE_NAME } from './auth.service';
import { ApiError } from '../../../middleware/error.handler';

const cookieOptions = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV !== 'production' ?  'lax' as const : 'none' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 24 * 60 * 60 * 1000,
};

export async function signupHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const input = signupSchema.parse(req.body);
    const { user, token } = await authService.signup(input);
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.status(201).json({ user, token });
  } catch (err) {
    next(err);
  }
}

export function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    loginSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  passport.authenticate('local', { session: false }, (err: unknown, user: Express.User | false) => {
    if (err) return next(err);
    if (!user) return next(new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'));

    const token = authService.signToken({
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    res.cookie(COOKIE_NAME, token, cookieOptions);
    authService
      .me(user.userId)
      .then((full) => res.json({ user: full, token }))
      .catch(next);
  })(req, res, next);
}

export function logoutHandler(_req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.status(204).send();
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authService.me(req.user!.userId);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}