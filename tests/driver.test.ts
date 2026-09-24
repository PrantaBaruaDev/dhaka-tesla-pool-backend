import { describe, it, expect, beforeAll } from 'bun:test';
import request from 'supertest';
import app from '../src/app';

async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error(`Login failed for ${email}: ${res.status}`);
  return Array.isArray(cookies) ? cookies[0] : cookies;
}

const BANANI = 'z-banani';
const MOHAKHALI = 'z-mohakhali';
const GULSHAN1 = 'z-gulshan1';
const DHANMONDI = 'z-dhanmondi';

describe('driver', () => {
  let jashimCookie: string;
  let nusratCookie: string;
  let rafiqCookie: string;
  let shirinCookie: string;

  beforeAll(async () => {
    jashimCookie  = await loginAs('jashim@tesla.dhaka', 'password123');
    nusratCookie  = await loginAs('nusrat@example.com',  'password123');
    rafiqCookie   = await loginAs('rafiq@example.com',   'password123');
    shirinCookie  = await loginAs('shirin@example.com',  'password123');

    // Ensure clean state: driver offline, no active pool for this run
    await request(app)
      .post('/api/v1/driver/status')
      .set('Cookie', jashimCookie)
      .send({ online: false });
  });

  // ── Status toggle ────────────────────────────────────────────────
  it('toggles driver online', async () => {
    const res = await request(app)
      .post('/api/v1/driver/status')
      .set('Cookie', jashimCookie)
      .send({ online: true });

    expect(res.status).toBe(200);
    expect(res.body.tesla.isOnline).toBe(true);
    expect(res.body.tesla.label).toBe('Bullet');
    expect(res.body.tesla.capacity).toBe(3);
  });

  it('toggles driver offline', async () => {
    const res = await request(app)
      .post('/api/v1/driver/status')
      .set('Cookie', jashimCookie)
      .send({ online: false });
    expect(res.status).toBe(200);
    expect(res.body.tesla.isOnline).toBe(false);
  });

  it('rejects invalid status body', async () => {
    const res = await request(app)
      .post('/api/v1/driver/status')
      .set('Cookie', jashimCookie)
      .send({ online: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  // ── Access control ───────────────────────────────────────────────
  it('a passenger cannot toggle driver status', async () => {
    const res = await request(app)
      .post('/api/v1/driver/status')
      .set('Cookie', nusratCookie)
      .send({ online: true });
    expect(res.status).toBe(403);
  });

  it('a passenger cannot list driver requests', async () => {
    const res = await request(app)
      .get('/api/v1/driver/requests')
      .set('Cookie', nusratCookie);
    expect(res.status).toBe(403);
  });

  it('unauthenticated access returns 401', async () => {
    const res = await request(app).get('/api/v1/driver/requests');
    expect(res.status).toBe(401);
  });

  // ── Matching requests ────────────────────────────────────────────
  it('lists open requests with all fields the driver needs', async () => {
    // Create a fresh Nusrat request
    const create = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
      });
    expect(create.status).toBe(201);

    const res = await request(app)
      .get('/api/v1/driver/requests')
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(200);
    expect(res.body.tesla.capacity).toBe(3);
    expect(res.body.activePoolId).toBeNull();
    expect(Array.isArray(res.body.requests)).toBe(true);

    const nusrats = res.body.requests.find(
      (r: { passenger: { email?: string } }) => r.passenger?.email === 'nusrat@example.com',
    );
    // Note: our select only picked name/id — adjust if you need email
    const match = res.body.requests.find(
      (r: { passenger: { name: string } }) => r.passenger.name === 'Nusrat',
    );
    expect(match).toBeDefined();
    expect(match.pickupZone.name).toBe('Banani');
    expect(match.destinationZone.name).toBe('Mohakhali');
    expect(match.estimatedFarePoysha).toBe(9300);
    expect(match.canJoinActivePool).toBe(false); // no active pool yet
  });

  it('returns canJoinActivePool false when no active pool exists', async () => {
    const res = await request(app)
      .get('/api/v1/driver/requests')
      .set('Cookie', jashimCookie);
    expect(res.status).toBe(200);
    for (const r of res.body.requests) {
      expect(r.canJoinActivePool).toBe(false);
    }
  });

  // ── Active pool ──────────────────────────────────────────────────
  it('returns null active pool when none exists', async () => {
    const res = await request(app)
      .get('/api/v1/driver/pools/active')
      .set('Cookie', jashimCookie);
    expect(res.status).toBe(200);
    expect(res.body.pool).toBeNull();
  });
});