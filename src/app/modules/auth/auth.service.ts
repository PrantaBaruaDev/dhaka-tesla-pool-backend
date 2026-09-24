import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../../middleware/error.handler';
import config from '../../config';
import type { SignupInput, LoginInput } from './auth.schema';

export const COOKIE_NAME = 'access_token';

export function signToken(payload: { sub: string; role: string }): string {
  return jwt.sign(payload, config.jwt_access_secret, { expiresIn: config.jwt_access_expires_in as any });
}

export async function signup(input: SignupInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ApiError(409, 'EMAIL_TAKEN', 'Email is already registered.');

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash, role: input.role },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  if (user.role === 'DRIVER') {
    await prisma.tesla.create({
      data: { driverId: user.id, label: 'Tesla', capacity: 3, isOnline: false },
    });
  }

  const token = signToken({ sub: user.id, role: user.role });
  return { user, token };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

  const token = signToken({ sub: user.id, role: user.role });
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token,
  };
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User does not exist.');
  return user;
}