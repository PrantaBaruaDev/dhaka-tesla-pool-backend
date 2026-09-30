import { describe, it, expect } from 'bun:test';
import {
  haversineMeters,
  roadDistanceMeters,
  fareFromRoadDistance,
  MAX_DHAKA_DISTANCE_M,
} from '@/app/modules/fares/fare.service';

describe('fare service', () => {
  it('haversine returns 0 for identical points', () => {
    expect(haversineMeters(23.79, 90.40, 23.79, 90.40)).toBe(0);
  });

  it('Banani → Mohakhali straight-line is ~3.0 km', () => {
    const d = haversineMeters(23.7936, 90.4043, 23.7666, 90.4074);
    expect(d).toBeGreaterThan(2_950);
    expect(d).toBeLessThan(3_050);
  });

  it('Banani → Mohakhali road distance is 4200 m', () => {
    expect(roadDistanceMeters(23.7936, 90.4043, 23.7666, 90.4074)).toBe(4200);
  });

  it('Banani → Gulshan 1 road distance is 3500 m', () => {
    expect(roadDistanceMeters(23.7936, 90.4043, 23.7736, 90.4161)).toBe(3500);
  });

  it('Chittagong reference pair straight-line is ~1.6 km', () => {
    const d = haversineMeters(
      22.359327465446906, 91.82193115307132,
      22.35823601890768,  91.83744504888027,
    );
    expect(d).toBeGreaterThan(1_580);
    expect(d).toBeLessThan(1_620);
  });

  it('Chittagong reference pair road distance is 2200 m', () => {
    expect(
      roadDistanceMeters(
        22.359327465446906, 91.82193115307132,
        22.35823601890768,  91.83744504888027,
      ),
    ).toBe(2200);
  });

  it('Nusrat solo fare (4.2 km) is 9300 poysha', () => {
    expect(fareFromRoadDistance(4200, 1, false).finalPoysha).toBe(9300);
  });

  it('Nusrat pooled fare (4.2 km) is 7440 poysha', () => {
    expect(fareFromRoadDistance(4200, 1, true).finalPoysha).toBe(7440);
  });

  it('Rafiq solo fare (3.5 km) is 8250 poysha', () => {
    expect(fareFromRoadDistance(3500, 1, false).finalPoysha).toBe(8250);
  });

  it('Rafiq pooled fare (3.5 km) is 6600 poysha', () => {
    expect(fareFromRoadDistance(3500, 1, true).finalPoysha).toBe(6600);
  });

  it('throws when computed distance exceeds MAX_DHAKA_DISTANCE_M', () => {
    // Dhaka (23.81, 90.41) → Chittagong (22.35, 91.78) ≈ 216 km
    expect(() =>
      roadDistanceMeters(23.8103, 90.4125, 22.3569, 91.7832),
    ).toThrow(new RegExp(`MAX_DHAKA_DISTANCE_M`));
  });

  it('2 seats double the fare (no discount, solo booking)', () => {
    expect(fareFromRoadDistance(4200, 2, false).finalPoysha).toBe(18600);
  });

  it('3 seats triple the fare (no discount, solo booking)', () => {
    expect(fareFromRoadDistance(4200, 3, false).finalPoysha).toBe(27900);
  });

  it('2 seats with pool discount are 20% off the 2-seat subtotal', () => {
    expect(fareFromRoadDistance(4200, 2, true).finalPoysha).toBe(14880);
    // 18600 × 0.8 = 14880
  });
});