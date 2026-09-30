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

async function requestRideWithSeats(
  cookie: string,
  pickup: string,
  dest: string,
  seats: number,
) {
  const res = await request(app)
    .post('/api/v1/rides')
    .set('Cookie', cookie)
    .send({ pickupZoneId: pickup, destinationZoneId: dest, seats, paymentMethod: 'CASH' });
  if (res.status !== 201) throw new Error(`create ride failed: ${res.status}`);
  return res.body.rideRequest.id as string;
}

const BANANI = 'z-banani';
const MOHAKHALI = 'z-mohakhali';
const GULSHAN1 = 'z-gulshan1';
const DHANMONDI = 'z-dhanmondi';

describe('pooling', () => {
  let jashimCookie: string;
  let nusratCookie: string;
  let rafiqCookie: string;
  let shirinCookie: string;

  beforeAll(async () => {
    jashimCookie = await loginAs('jashim@tesla.dhaka', 'password123');
    nusratCookie = await loginAs('nusrat@example.com', 'password123');
    rafiqCookie  = await loginAs('rafiq@example.com', 'password123');
    shirinCookie = await loginAs('shirin@example.com', 'password123');
  });

  beforeEach(async () => {
    await prisma.$transaction([
      prisma.rideStatusHistory.deleteMany({}),
      prisma.rideRequest.deleteMany({}),
      prisma.pool.deleteMany({}),
    ]);

    await request(app)
      .post('/api/v1/driver/status')
      .set('Cookie', jashimCookie)
      .send({ online: false });
  });

  async function requestRide(cookie: string, pickup: string, dest: string) {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', cookie)
      .send({ pickupZoneId: pickup, destinationZoneId: dest, seats: 1, paymentMethod: 'CASH' });
    if (res.status !== 201) throw new Error(`create ride failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.rideRequest.id as string;
  }

  it('creates a pool when the first request is accepted', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);

    const res = await request(app)
      .post(`/api/v1/driver/requests/${rideId}/accept`)
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.pool.status).toBe('OPEN');
    expect(res.body.pool.seatsOccupied).toBe(1);
    expect(res.body.pool.version).toBe(0);
    expect(res.body.rideRequest.status).toBe('MATCHED');
    expect(res.body.rideRequest.poolId).toBe(res.body.pool.id);
  });

  it('joins an existing pool with a matching-corridor request', async () => {
    const nusratRide = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const rafiqRide  = await requestRide(rafiqCookie,  BANANI, GULSHAN1);

    const first = await request(app)
      .post(`/api/v1/driver/requests/${nusratRide}/accept`)
      .set('Cookie', jashimCookie);
    expect(first.status).toBe(200);
    const poolId = first.body.pool.id;

    const second = await request(app)
      .post(`/api/v1/driver/requests/${rafiqRide}/accept`)
      .set('Cookie', jashimCookie);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.pool.id).toBe(poolId);
    expect(second.body.pool.seatsOccupied).toBe(2);
    expect(second.body.pool.version).toBe(1);
  });

  it('rejects a request on a different corridor', async () => {
    const bananiRide = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const dhanoRide  = await requestRide(rafiqCookie,  DHANMONDI, 'z-mirpur');

    await request(app)
      .post(`/api/v1/driver/requests/${bananiRide}/accept`)
      .set('Cookie', jashimCookie);

    const res = await request(app)
      .post(`/api/v1/driver/requests/${dhanoRide}/accept`)
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CLUSTER_MISMATCH');
  });

  it('rejects the 4th seat (capacity 3)', async () => {
    const a = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const b = await requestRide(rafiqCookie,  BANANI, GULSHAN1);
    const c = await requestRide(shirinCookie, BANANI, GULSHAN1);

    await request(app).post(`/api/v1/driver/requests/${a}/accept`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/requests/${b}/accept`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/requests/${c}/accept`).set('Cookie', jashimCookie);

    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Fourth', email: `fourth-${Date.now()}@test.local`, password: 'password123', role: 'PASSENGER' });
    const fourthCookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];
    const d = await requestRide(fourthCookie, BANANI, GULSHAN1);

    const res = await request(app)
      .post(`/api/v1/driver/requests/${d}/accept`)
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('POOL_FULL');
  }, 30000);

  it('two parallel accepts for the last seat: exactly one succeeds', async () => {
    const a = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const b = await requestRide(rafiqCookie,  BANANI, GULSHAN1);
    await request(app).post(`/api/v1/driver/requests/${a}/accept`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/requests/${b}/accept`).set('Cookie', jashimCookie);

    const c = await requestRide(shirinCookie, BANANI, GULSHAN1);
    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Fifth', email: `fifth-${Date.now()}@test.local`, password: 'password123', role: 'PASSENGER' });
    const fifthCookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];
    const d = await requestRide(fifthCookie, BANANI, GULSHAN1);

    const [r1, r2] = await Promise.all([
      request(app).post(`/api/v1/driver/requests/${c}/accept`).set('Cookie', jashimCookie),
      request(app).post(`/api/v1/driver/requests/${d}/accept`).set('Cookie', jashimCookie),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error).toBe('POOL_FULL');

    const pool = await prisma.pool.findFirst({
      where: { teslaId: (await prisma.tesla.findUnique({ where: { driverId: 'u-jashim-001' } }))!.id, status: 'OPEN' },
    });
    expect(pool!.seatsOccupied).toBe(3);
  }, 30000);

  it('runs the full lifecycle and finalizes fares with pool discount', async () => {
    const nusratRide = await requestRide(nusratCookie, BANANI, MOHAKHALI);  // 4200 m, base 9300
    const rafiqRide  = await requestRide(rafiqCookie,  BANANI, GULSHAN1);   // 3500 m, base 8250

    const a = await request(app).post(`/api/v1/driver/requests/${nusratRide}/accept`).set('Cookie', jashimCookie);
    const b = await request(app).post(`/api/v1/driver/requests/${rafiqRide}/accept`).set('Cookie', jashimCookie);
    const poolId = a.body.pool.id;
    expect(b.body.pool.id).toBe(poolId);

    const arrive = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/arrive`)
      .set('Cookie', jashimCookie);
    expect(arrive.status).toBe(200);
    expect(arrive.body.updatedRides.every((r: { status: string }) => r.status === 'DRIVER_ARRIVED')).toBe(true);

    const start = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/start`)
      .set('Cookie', jashimCookie);
    expect(start.status).toBe(200);
    expect(start.body.pool.status).toBe('IN_PROGRESS');

    const complete = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/complete`)
      .set('Cookie', jashimCookie);
    expect(complete.status).toBe(200);
    expect(complete.body.pool.status).toBe('COMPLETED');

    // Fares with 20% discount
    const nusrat = complete.body.rides.find((r: { id: string }) => r.id === nusratRide);
    const rafiq  = complete.body.rides.find((r: { id: string }) => r.id === rafiqRide);

    expect(nusrat.baseFarePoysha).toBe(9300);
    expect(nusrat.finalFarePoysha).toBe(7440);

    expect(rafiq.baseFarePoysha).toBe(8250);
    expect(rafiq.finalFarePoysha).toBe(6600);
  }, 30000);

  it('rejects start before all passengers are DRIVER_ARRIVED', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const a = await request(app).post(`/api/v1/driver/requests/${rideId}/accept`).set('Cookie', jashimCookie);
    const poolId = a.body.pool.id;

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/start`)
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_TRANSITION');
  });

  it('rejects complete before start', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const a = await request(app).post(`/api/v1/driver/requests/${rideId}/accept`).set('Cookie', jashimCookie);
    const poolId = a.body.pool.id;

    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set('Cookie', jashimCookie);

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/complete`)
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_TRANSITION');
  });

  it('a different driver cannot arrive/start/complete someone else\'s pool', async () => {
    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Other', email: `other-${Date.now()}@test.local`, password: 'password123', role: 'DRIVER' });
    const otherCookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];

    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const a = await request(app).post(`/api/v1/driver/requests/${rideId}/accept`).set('Cookie', jashimCookie);
    const poolId = a.body.pool.id;

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/arrive`)
      .set('Cookie', otherCookie);

    expect(res.status).toBe(403);
  });

  it('rejects accepting an already-MATCHED ride', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    await request(app).post(`/api/v1/driver/requests/${rideId}/accept`).set('Cookie', jashimCookie);

    const res = await request(app)
      .post(`/api/v1/driver/requests/${rideId}/accept`)
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_TRANSITION');
  });

  it('returns completed pools in history', async () => {
    const rideId = await requestRide(nusratCookie, BANANI, MOHAKHALI);
    const a = await request(app).post(`/api/v1/driver/requests/${rideId}/accept`).set('Cookie', jashimCookie);
    const poolId = a.body.pool.id;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set('Cookie', jashimCookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/complete`).set('Cookie', jashimCookie);

    const res = await request(app)
      .get('/api/v1/driver/pools/history')
      .set('Cookie', jashimCookie);

    expect(res.status).toBe(200);
    expect(res.body.pools.length).toBeGreaterThanOrEqual(1);
    const found = res.body.pools.find((p: { id: string }) => p.id === poolId);
    expect(found).toBeDefined();
    expect(found.status).toBe('COMPLETED');
    expect(found.passengers.length).toBe(1);
  }, 30000);

  it('single passenger with 2 seats does not trigger pool discount', async () => {
  // Nusrat books 2 seats alone
  const rideId = await requestRideWithSeats(nusratCookie, BANANI, MOHAKHALI, 2);

  const accept = await request(app)
    .post(`/api/v1/driver/requests/${rideId}/accept`)
    .set('Cookie', jashimCookie);
  const poolId = accept.body.pool.id;

  await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set('Cookie', jashimCookie);
  await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set('Cookie', jashimCookie);
  const complete = await request(app)
    .post(`/api/v1/driver/pools/${poolId}/complete`)
    .set('Cookie', jashimCookie);

  // 2 seats × 9300 = 18600, no discount (she's the only passenger)
  expect(complete.body.rides[0].finalFarePoysha).toBe(18600);
  expect(complete.body.rides[0].discountPoysha).toBe(0);
});

it('single passenger with 2 seats + another passenger gets discount', async () => {
  const ride1 = await requestRideWithSeats(nusratCookie, BANANI, MOHAKHALI, 2);
  const ride2 = await requestRideWithSeats(rafiqCookie,  BANANI, GULSHAN1,  1);

  const a = await request(app).post(`/api/v1/driver/requests/${ride1}/accept`).set('Cookie', jashimCookie);
  const poolId = a.body.pool.id;
  await request(app).post(`/api/v1/driver/requests/${ride2}/accept`).set('Cookie', jashimCookie);

  await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set('Cookie', jashimCookie);
  await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set('Cookie', jashimCookie);
  const complete = await request(app)
    .post(`/api/v1/driver/pools/${poolId}/complete`)
    .set('Cookie', jashimCookie);

  const nusrat = complete.body.rides.find((r: { id: string }) => r.id === ride1);
  const rafiq  = complete.body.rides.find((r: { id: string }) => r.id === ride2);

  // Nusrat: 2 × 9300 = 18600 → 20% off = 14880
  expect(nusrat.finalFarePoysha).toBe(14880);
  // Rafiq: 1 × 8250 = 8250 → 20% off = 6600
  expect(rafiq.finalFarePoysha).toBe(6600);
});
});