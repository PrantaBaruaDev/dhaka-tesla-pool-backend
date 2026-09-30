const EARTH_RADIUS_M = 6_371_000;

export const BASE_FARE_POYSHA = 3_000;   // ৳30
export const PER_KM_POYSHA   = 1_500;    // ৳15/km
export const POOL_DISCOUNT   = 0.20;
export const CIRCUITY_FACTOR = 1.4;

const DISTANCE_ROUNDING_M = 100;
export const MAX_DHAKA_DISTANCE_M = 50_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1), Δλ = toRad(lng2 - lng1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_M * c);
}

export function roadDistanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const straight = haversineMeters(lat1, lng1, lat2, lng2);
  const rounded =
    Math.round((straight * CIRCUITY_FACTOR) / DISTANCE_ROUNDING_M) *
    DISTANCE_ROUNDING_M;

  if (rounded > MAX_DHAKA_DISTANCE_M) {
    throw new Error(
      `Computed road distance ${rounded} m exceeds MAX_DHAKA_DISTANCE_M (${MAX_DHAKA_DISTANCE_M} m). Check zone coordinates.`,
    );
  }
  return rounded;
}

export interface FareBreakdown {
  basePoysha: number;
  seats: number;
  subtotalPoysha: number;
  discountPoysha: number;
  finalPoysha: number;
}

export function fareFromRoadDistance(
  roadMeters: number,
  seats: number,
  isPooled: boolean,
): FareBreakdown {
  const km = roadMeters / 1000;
  const perSeat = BASE_FARE_POYSHA + Math.round(km * PER_KM_POYSHA);
  const subtotal = perSeat * seats;
  const discount = isPooled ? Math.round(subtotal * POOL_DISCOUNT) : 0;

  return {
    basePoysha: perSeat,
    seats,
    subtotalPoysha: subtotal,
    discountPoysha: discount,
    finalPoysha: subtotal - discount,
  };
}