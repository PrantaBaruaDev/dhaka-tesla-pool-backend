import { describe, it, expect, beforeAll } from 'bun:test';
import request from 'supertest';
import app from '../src/app';

async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return Array.isArray(cookies) ? cookies[0] : cookies;
}

describe('rides', () => {
  let nusratCookie: string;
  let rafiqCookie: string;
  let jashimCookie: string;

  const BANANI = 'z-banani';
  const MOHAKHALI = 'z-mohakhali';
  const GULSHAN1 = 'z-gulshan1';

  beforeAll(async () => {
    nusratCookie  = await loginAs('nusrat@example.com', 'password123');
    rafiqCookie   = await loginAs('rafiq@example.com',  'password123');
    jashimCookie  = await loginAs('jashim@tesla.dhaka', 'password123');
  });

  it('rejects a client-supplied distanceMeters (Zod strict)', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
        distanceMeters: 10000,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects a request with same pickup and destination', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: BANANI,
        seats: 1,
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SAME_ZONE');
  });

  it('rejects an unknown zone', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({
        pickupZoneId: 'z-does-not-exist',
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ZONE_NOT_FOUND');
  });

  it('creates a ride with server-computed distance and fare (Nusrat)', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    const ride = res.body.rideRequest;
    expect(ride.status).toBe('REQUESTED');
    expect(ride.straightLineMeters).toBeGreaterThanOrEqual(2950);
    expect(ride.straightLineMeters).toBeLessThanOrEqual(3050);
    expect(ride.roadDistanceMeters).toBe(4200);      // exact - rounded to 0.1 km
    expect(ride.estimatedFarePoysha).toBe(9300);     // exact - from rounded distance
    expect(ride.poolId).toBeNull();
  });

  it('creates a ride (Rafiq) with 8250 estimate', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', rafiqCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: GULSHAN1,
        seats: 1,
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(201);
    expect(res.body.rideRequest.estimatedFarePoysha).toBe(8250);
  });

  it('a passenger cannot read another passenger\'s ride', async () => {
    const create = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
      });
    const rideId = create.body.rideRequest.id;

    const read = await request(app)
      .get(`/api/v1/rides/${rideId}`)
      .set('Cookie', rafiqCookie);
    expect(read.status).toBe(403);
  });

  it('a passenger cannot cancel another passenger\'s ride', async () => {
    const create = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
      });
    const rideId = create.body.rideRequest.id;

    const cancel = await request(app)
      .post(`/api/v1/rides/${rideId}/cancel`)
      .set('Cookie', rafiqCookie);
    expect(cancel.status).toBe(403);
  });

  it('passenger can cancel their own REQUESTED ride', async () => {
    const create = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', nusratCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
      });
    const rideId = create.body.rideRequest.id;

    const cancel = await request(app)
      .post(`/api/v1/rides/${rideId}/cancel`)
      .set('Cookie', nusratCookie);
    expect(cancel.status).toBe(200);
    expect(cancel.body.rideRequest.status).toBe('CANCELLED');
    expect(cancel.body.rideRequest.cancelledAt).toBeTruthy();
  });

  it('a driver cannot use passenger ride endpoints', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Cookie', jashimCookie)
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(403);
  });

  it('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .send({
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(401);
  });
});