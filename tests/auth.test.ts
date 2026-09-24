import { describe, it, expect } from 'bun:test';
import request from 'supertest';
import app from '../src/app';

const NUSRAT_EMAIL = `nusrat-${Date.now()}@test.local`;

describe('auth', () => {
  let cookie: string;

  it('rejects signup with extra field', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'X', email: 'x@test.local', password: 'password123', role: 'PASSENGER', foo: 'bar' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('signs up a new passenger and sets cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Nusrat', email: NUSRAT_EMAIL, password: 'password123', role: 'PASSENGER' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('PASSENGER');
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    cookie = Array.isArray(cookies) ? cookies[0] : cookies;
    expect(cookie).toContain('access_token=');
    expect(cookie).toContain('HttpOnly');
  });

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Nusrat', email: NUSRAT_EMAIL, password: 'password123', role: 'PASSENGER' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_TAKEN');
  });

  it('GET /me returns the current user', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(NUSRAT_EMAIL);
  });

  it('GET /me without cookie returns 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('logs in with the seeded Nusrat', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: NUSRAT_EMAIL, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(NUSRAT_EMAIL);
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: NUSRAT_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('logs out and clears the cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
  });
});