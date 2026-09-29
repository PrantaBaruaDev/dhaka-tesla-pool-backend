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
  });

  beforeEach(async () => {
    await prisma.$transaction([
      prisma.rideStatusHistory.deleteMany({}),
      prisma.rideRequest.deleteMany({}),
      prisma.pool.deleteMany({}),
      prisma.tesla.updateMany({ data: { isOnline: false } }),
    ]);
  });

  // Status toggle 
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

  // Access control
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

  // Matching requests
  it('lists open requests with all fields the driver needs', async () => {
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

    const match = res.body.requests.find(
      (r: { passenger: { name: string } }) => r.passenger.name === 'Nusrat',
    );
    expect(match).toBeDefined();
    expect(match.pickupZone.name).toBe('Banani');
    expect(match.destinationZone.name).toBe('Mohakhali');
    expect(match.estimatedFarePoysha).toBe(9300);
    expect(match.canJoinActivePool).toBe(false);
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

  // Active pool 
  it('returns null active pool when none exists', async () => {
    const res = await request(app)
      .get('/api/v1/driver/pools/active')
      .set('Cookie', jashimCookie);
    expect(res.status).toBe(200);
    expect(res.body.pool).toBeNull();
  });

  // Passenger profile 
  it('driver can view a passenger profile scoped to their own pools', async () => {
    const create = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1, paymentMethod: 'CASH' });
    const rideId = create.body.rideRequest.id;

    const accept = await request(app)
      .post(`/api/v1/driver/requests/${rideId}/accept`)
      .set('Cookie', jashimCookie);
    const poolId = accept.body.pool.id;

    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/complete`).set('Cookie', jashimCookie);

    const res = await request(app)
      .get('/api/v1/driver/passengers/u-nusrat-001')
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(200);
    expect(res.body.passenger.id).toBe('u-nusrat-001');
    expect(res.body.passenger.name).toBe('Nusrat');
    expect(res.body.passenger.email).toBe('nusrat@example.com');
    expect(res.body.passenger.role).toBe('PASSENGER');
    expect(res.body.ridesWithYou.length).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.totalRides).toBeGreaterThanOrEqual(1);
  });

  it('driver profile endpoint rejects unknown passenger', async () => {
    const res = await request(app)
      .get('/api/v1/driver/passengers/u-does-not-exist')
      .set('Cookie', jashimCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PASSENGER_NOT_FOUND');
  });

  it('driver profile endpoint rejects a non-passenger user', async () => {
    const res = await request(app)
      .get('/api/v1/driver/passengers/u-jashim-001')
      .set('Cookie', jashimCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NOT_A_PASSENGER');
  });

  it('a passenger cannot hit the driver profile endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/driver/passengers/u-nusrat-001')
      .set('Cookie', nusratCookie);
    expect(res.status).toBe(403);
  });
});