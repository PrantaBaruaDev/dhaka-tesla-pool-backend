import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@/../prisma/generated/prisma/enums';
import config from '../app/config';
import { prisma } from '../app/lib/prisma';
import { catchAsync } from '../app/utils/catchAsync';
import { jwtUtils } from '../app/utils/jwt';
import { ApiError } from './error.handler';

const COOKIE_NAME = 'access_token';

declare global {
  namespace Express {
    interface User {
      userId: string;
      email: string;
      name: string;
      role: Role;
    }
    interface Request {
      user?: User;
    }
  }
}

export const auth = (...requiredRoles: Role[]) =>
  catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
    let token: string | undefined;

    const cookieToken = (req.cookies?.[COOKIE_NAME] as string | undefined)?.trim();
    if (cookieToken) {
      token = cookieToken;
    } else {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        token = header.slice(7).trim();
      }
    }

    if (!token) {
      throw new ApiError(
        401,
        'UNAUTHENTICATED',
        'You are not logged in. Please log in to access this resource.',
      );
    }

    const verified = jwtUtils.verifyToken(token);
    if (!verified.success) {
      if (config.node_env === 'development') {
        throw new ApiError(401, 'UNAUTHENTICATED', verified.error);
      }
      throw new ApiError(
        401,
        'UNAUTHENTICATED',
        'Invalid or expired session. Please log in again.',
      );
    }

    const { userId, role } = verified.data;

    if (requiredRoles.length > 0 && !requiredRoles.includes(role)) {
      throw new ApiError(
        403,
        'FORBIDDEN',
        `Requires role: ${requiredRoles.join(' or ')}.`,
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'User account no longer exists.');
    }

    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    next();
  });