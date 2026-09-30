import { Router } from 'express';
import { signupHandler, loginHandler, logoutHandler, meHandler } from './auth.controller';
import { auth } from '@/middleware/auth';

export const authRouter = Router();

authRouter.post('/signup', signupHandler);
authRouter.post('/login', loginHandler);
authRouter.post('/logout', logoutHandler);
authRouter.get('/me', auth(), meHandler);
