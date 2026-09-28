import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../app/lib/logger';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const rid = req.rid ?? 'no-rid';

  if (err instanceof ZodError) {
    logger.warn('error', `Validation failed: ${req.method} ${req.originalUrl}`, {
      rid,
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: err.issues[0]?.message ?? 'Invalid input.',
      issues: err.issues,
    });
  }

  if (err instanceof ApiError) {
    logger.warn('error', `${err.code}: ${err.message}`, {
      rid,
      status: err.status,
      method: req.method,
      url: req.originalUrl,
      ...(err.details ? { details: err.details } : {}),
    });
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name: unknown }).name);
    if (name.startsWith('PrismaClient')) {
      const prismaErr = err as unknown as {
        code?: string;
        meta?: unknown;
        message?: string;
      };
      logger.error(
        'error',
        `Prisma error: ${name}`,
        {
          rid,
          code: prismaErr.code,
          meta: prismaErr.meta,
        },
        err,
      );
      return res.status(500).json({
        error: 'DATABASE_ERROR',
        message: 'A database error occurred.',
      });
    }
  }

  logger.error('error', `Unhandled error on ${req.method} ${req.originalUrl}`, { rid }, err);

  const isTest = process.env.NODE_ENV === 'test';
  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: isTest && err instanceof Error ? err.message : 'Something went wrong.',
    ...(isTest && err instanceof Error ? { stack: err.stack } : {}),
  });
}