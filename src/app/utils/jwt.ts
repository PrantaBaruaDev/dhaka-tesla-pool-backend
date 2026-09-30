import jwt, { type JwtPayload } from 'jsonwebtoken';
import config from '../config';

export interface JwtUserPayload extends JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: 'PASSENGER' | 'DRIVER';
}

export const jwtUtils = {
  signToken(payload: Omit<JwtUserPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, config.jwt_access_secret, {
      expiresIn: config.jwt_access_expires_in as any,
    });
  },

  verifyToken(token: string):
    | { success: true; data: JwtUserPayload }
    | { success: false; error: string } {
    try {
      const decoded = jwt.verify(token, config.jwt_access_secret) as JwtUserPayload;
      return { success: true, data: decoded };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Invalid token',
      };
    }
  },
};