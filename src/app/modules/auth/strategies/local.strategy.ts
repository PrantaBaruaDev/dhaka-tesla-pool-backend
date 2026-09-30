import { Strategy as LocalStrategy } from 'passport-local';
import { login } from '../auth.service';

export const localStrategy = new LocalStrategy(
  { usernameField: 'email', passwordField: 'password', session: false },
  async (email, password, done) => {
    try {
      const { user } = await login({ email, password });
      return done(null, {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });
    } catch (err) {
      return done(err, false);
    }
  },
);