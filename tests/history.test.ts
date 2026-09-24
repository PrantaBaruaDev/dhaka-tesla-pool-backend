import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/app/lib/prisma';

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

describe('history', () => {
  let jashimCookie: string;
  let nusratCookie: string;
  let rafiqCookie: string;

  beforeAll(async () => {
    jashimCookie = await loginAs('jashim@tesla.dhaka', 'password123');
    nusratCookie = await loginAs('nusrat@example.com', 'password123');
    rafiqCookie  = await loginAs('rafiq@example.com', 'password123');
  });

  beforeEach(async () => {
    await prisma.rideStatusHistory.deleteMany({});
    await prisma.rideRequest.deleteMany({});
    await prisma.pool.deleteMany({});
  });

  async function requestRide(cookie: string, pickup: string, dest: string) {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', cookie)
      .send({ pickupZoneId: pickup, destinationZoneId: dest, seats: 1, paymentMethod: 'CASH' });
    if (res.status !== 201) throw new Error(`create ride failed: ${res.status}`);
    return res.body.rideRequest.id as string;
  }

  // ── Passenger-facing history ─────────────────────────────────────
  it('records a REQUESTED entry on creation', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);

    const res = await request(app)
      .get(`/api/v1/rides/${rideId}/history`)
      .set('Cookie', nusratCookie);

    expect(res.status).toBe(200);
    expect(res.body.history.timeline).toHaveLength(1);
    expect(res.body.history.timeline[0].fromStatus).toBeNull();
    expect(res.body.history.timeline[0].toStatus).toBe('REQUESTED');
    expect(res.body.history.timeline[0].changedBy.name).toBe('Nusrat');
    expect(res.body.history.timeline[0].changedBy.role).toBe('PASSENGER');
  });

  it('records every transition with the right actor', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const accept = await request(app)
      .post(`/api/v1/driver/requests/${rideId}/accept`)
      .set('Cookie', jashimCookie);
    const poolId = accept.body.pool.id;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/complete`).set('Cookie', jashimCookie);

    const res = await request(app)
      .get(`/api/v1/rides/${rideId}/history`)
      .set('Cookie', nusratCookie);

    expect(res.status).toBe(200);
    const t = res.body.history.timeline;
    expect(t).toHaveLength(5);

    const expected = [
      { from: null, to: 'REQUESTED', actor: 'Nusrat' },
      { from: 'REQUESTED', to: 'MATCHED', actor: 'Jashim' },
      { from: 'MATCHED', to: 'DRIVER_ARRIVED', actor: 'Jashim' },
      { from: 'DRIVER_ARRIVED', to: 'STARTED', actor: 'Jashim' },
      { from: 'STARTED', to: 'COMPLETED', actor: 'Jashim' },
    ];

    expect(t).toHaveLength(expected.length);

    expected.forEach((exp, i) => {
        const actual = t[i];
        expect(actual).toBeDefined();
        if (!actual) return; 
        expect(actual.fromStatus).toBe(exp.from);
        expect(actual.toStatus).toBe(exp.to);
        expect(actual.changedBy.name).toBe(exp.actor);
    });
  });

  it('a passenger cannot read another passenger\'s ride history', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const res = await request(app)
      .get(`/api/v1/rides/${rideId}/history`)
      .set('Cookie', rafiqCookie);
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown ride', async () => {
    const res = await request(app)
      .get('/api/v1/rides/00000000-0000-0000-0000-000000000000/history')
      .set('Cookie', nusratCookie);
    expect(res.status).toBe(404);
  });

  // ── Driver-facing pool audit ─────────────────────────────────────
  it('returns a full audit for a completed pool', async () => {
    const nusratRide = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const rafiqRide  = await requestRide(rafiqCookie,  BANANI, GULSHAN1);

    const a = await request(app).post(`/api/v1/driver/requests/${nusratRide}/accept`).set('Cookie', jashimCookie);
    const poolId = a.body.pool.id;
    await request(app).post(`/api/v1/driver/requests/${rafiqRide}/accept`).set('Cookie', jashimCookie);

    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/complete`).set('Cookie', jashimCookie);

    const res = await request(app)
      .get(`/api/v1/driver/pools/${poolId}/history`)
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(200);
    expect(res.body.audit.poolId).toBe(poolId);
    expect(res.body.audit.status).toBe('COMPLETED');
    expect(res.body.audit.rides).toHaveLength(2);

    for (const ride of res.body.audit.rides) {
      expect(ride.currentStatus).toBe('COMPLETED');
      expect(ride.timeline).toHaveLength(5);
      expect(ride.finalFarePoysha).toBeGreaterThan(0);
    }

    const nusrat = res.body.audit.rides.find((r: { passenger: { name: string } }) => r.passenger.name === 'Nusrat');
    const rafiq  = res.body.audit.rides.find((r: { passenger: { name: string } }) => r.passenger.name === 'Rafiq');
    expect(nusrat.finalFarePoysha).toBe(7440);
    expect(rafiq.finalFarePoysha).toBe(6600);
  });

  it('a different driver cannot read pool audit', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const a = await request(app).post(`/api/v1/driver/requests/${rideId}/accept`).set('Cookie', jashimCookie);
    const poolId = a.body.pool.id;

    // Sign up a fresh driver
    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Intruder', email: `intruder-${Date.now()}@test.local`, password: 'password123', role: 'DRIVER' });
    const otherCookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];

    const res = await request(app)
      .get(`/api/v1/driver/pools/${poolId}/history`)
      .set('Cookie', otherCookie);

    expect(res.status).toBe(403);
  });

  it('a passenger cannot hit the driver audit endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/driver/pools/some-pool-id/history')
      .set('Cookie', nusratCookie);
    expect(res.status).toBe(403);
  });
});