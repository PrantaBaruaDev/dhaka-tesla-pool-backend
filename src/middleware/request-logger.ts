import type { Request, Response, NextFunction } from 'express';
import { logger } from '@/app/lib/logger';

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

declare global {
  namespace Express {
    interface Request {
      rid?: string;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const rid = shortId();
  req.rid = rid;
  res.setHeader('X-Request-Id', rid);

  const start = performance.now();
  const method = req.method;
  const url = req.originalUrl;

  logger.debug('http', `→ ${method} ${url}`, { rid });

  res.on('finish', () => {
    const ms = Math.round(performance.now() - start);
    const status = res.statusCode;
    const arrow = status >= 500 ? '✗' : status >= 400 ? '⚠' : '←';
    const line = `${arrow} ${status} ${method} ${url} ${ms}ms`;
    const data = { rid };

    if (status >= 500) logger.error('http', line, data);
    else if (status >= 400) logger.warn('http', line, data);
    else logger.debug('http', line, data);
  });

  next();
}