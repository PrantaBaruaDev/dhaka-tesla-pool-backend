import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import type { Request } from 'express';
import config from '../../../config';
import { COOKIE_NAME } from '../auth.service';

const cookieExtractor = (req: Request): string | null =>
  (req?.cookies?.[COOKIE_NAME] as string | undefined) ?? null;

export const jwtStrategy = new JwtStrategy(
  {
    jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
    secretOrKey: config.jwt_access_secret,
  },
  async (payload: { sub: string; role: string }, done) => {
    return done(null, { id: payload.sub, role: payload.role });
  },
);