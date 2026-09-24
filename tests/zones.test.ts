import { describe, it, expect } from 'bun:test';
import request from 'supertest';
import app from '../src/app';

describe('zones', () => {
  it('GET /api/v1/zones returns all seeded zones', async () => {
    const res = await request(app).get('/api/v1/zones');

    expect(res.status).toBe(200);
    expect(res.body.zones).toBeArray();
    expect(res.body.zones.length).toBeGreaterThanOrEqual(8);

    const zone = res.body.zones[0];
    expect(zone).toHaveProperty('id');
    expect(zone).toHaveProperty('name');
    expect(zone).toHaveProperty('lat');
    expect(zone).toHaveProperty('lng');
    expect(zone).toHaveProperty('cluster');
  });

  it('returns zones sorted by name', async () => {
    const res = await request(app).get('/api/v1/zones');
    const names = res.body.zones.map((z: { name: string }) => z.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('includes all seeded corridor clusters', async () => {
    const res = await request(app).get('/api/v1/zones');
    const clusters = new Set(res.body.zones.map((z: { cluster: string }) => z.cluster));
    expect(clusters.has('banani-corridor')).toBe(true);
    expect(clusters.has('dhanmondi-mirpur')).toBe(true);
    expect(clusters.has('uttara-airport')).toBe(true);
  });
});