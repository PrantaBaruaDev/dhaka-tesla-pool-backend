import { Router } from 'express';
import { signupHandler, loginHandler, logoutHandler, meHandler } from './auth.controller';
import { requireAuth } from '@/middleware/auth.guard';

export const authRouter = Router();

authRouter.post('/signup', signupHandler);
authRouter.post('/login', loginHandler);
authRouter.post('/logout', logoutHandler);
authRouter.get('/me', requireAuth, meHandler);
