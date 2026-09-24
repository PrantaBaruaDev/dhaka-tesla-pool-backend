import { prisma } from '../../lib/prisma';
import { ApiError } from '../../../middleware/error.handler';
import { logger } from '../../lib/logger';
import type { ToggleStatusInput } from './driver.schema';

// ── Helper: fetch this driver's Tesla (throws if missing) ────────────
async function getDriverTesla(driverId: string) {
  const tesla = await prisma.tesla.findUnique({ where: { driverId } });
  if (!tesla) {
    throw new ApiError(404, 'TESLA_NOT_FOUND', 'No Tesla is registered for this driver.');
  }
  return tesla;
}

// ── Toggle online / offline ─────────────────────────────────────────
export async function setOnlineStatus(driverId: string, input: ToggleStatusInput) {
  const tesla = await getDriverTesla(driverId);

  const updated = await prisma.tesla.update({
    where: { id: tesla.id },
    data: { isOnline: input.online },
    select: {
      id: true,
      label: true,
      capacity: true,
      isOnline: true,
      updatedAt: true,
    },
  });

  logger.info('driver', `driver ${input.online ? 'went online' : 'went offline'}`, {
    driverId,
    teslaId: tesla.id,
  });

  return updated;
}

// ── Fetch the driver's current active pool (OPEN or IN_PROGRESS) ─────
export async function getActivePool(driverId: string) {
  const tesla = await getDriverTesla(driverId);

  const pool = await prisma.pool.findFirst({
    where: {
      teslaId: tesla.id,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
    include: {
      rides: {
        include: {
          passenger: { select: { id: true, name: true, email: true } },
          pickupZone: { select: { id: true, name: true, cluster: true } },
          destinationZone: { select: { id: true, name: true, cluster: true } },
        },
      },
    },
    orderBy: { id: 'desc' },
  });

  if (!pool) return null;

  return {
    id: pool.id,
    status: pool.status,
    seatsOccupied: pool.seatsOccupied,
    capacity: tesla.capacity,
    version: pool.version,
    startedAt: pool.startedAt,
    completedAt: pool.completedAt,
    passengers: pool.rides.map((r) => ({
      rideRequestId: r.id,
      passengerId: r.passengerId,
      passengerName: r.passenger.name,
      seats: r.seatsRequested,
      status: r.status,
      pickupZone: r.pickupZone,
      destinationZone: r.destinationZone,
      estimatedFarePoysha: r.estimatedFarePoysha,
    })),
  };
}

// ── List open requests that match this driver ───────────────────────
export async function getMatchingRequests(driverId: string) {
  const tesla = await getDriverTesla(driverId);

  const activePool = await prisma.pool.findFirst({
    where: {
      teslaId: tesla.id,
      status: 'OPEN',
    },
    include: {
      rides: {
        include: {
          pickupZone: { select: { cluster: true } },
          destinationZone: { select: { cluster: true } },
        },
      },
    },
  });

  const openRequests = await prisma.rideRequest.findMany({
    where: { status: 'REQUESTED' },
    include: {
      passenger: { select: { id: true, name: true } },
      pickupZone: { select: { id: true, name: true, cluster: true } },
      destinationZone: { select: { id: true, name: true, cluster: true } },
    },
    orderBy: { requestedAt: 'asc' },
  });

  // Determine the pool's cluster signature (if a pool is active)
  let poolPickupCluster: string | null = null;
  let poolDestCluster: string | null = null;

  const firstRide = activePool?.rides.at(0);
  if (firstRide) {
    poolPickupCluster = firstRide.pickupZone.cluster;
    poolDestCluster = firstRide.destinationZone.cluster;
  }

  const requests = openRequests.map((r) => {
    // A request is compatible with the active pool if clusters match
    // and the pool has enough remaining capacity.
    let canJoinActivePool = false;

    if (activePool && poolPickupCluster && poolDestCluster) {
      const samePickup = r.pickupZone.cluster === poolPickupCluster;
      const sameDest = r.destinationZone.cluster === poolDestCluster;
      const hasCapacity =
        activePool.seatsOccupied + r.seatsRequested <= tesla.capacity;

      canJoinActivePool = samePickup && sameDest && hasCapacity;
    }

    return {
      id: r.id,
      passenger: r.passenger,
      pickupZone: r.pickupZone,
      destinationZone: r.destinationZone,
      seatsRequested: r.seatsRequested,
      roadDistanceMeters: r.roadDistanceMeters,
      estimatedFarePoysha: r.estimatedFarePoysha,
      status: r.status,
      requestedAt: r.requestedAt,
      canJoinActivePool,
      activePoolId: activePool?.id ?? null,
    };
  });

  return {
    tesla: {
      id: tesla.id,
      label: tesla.label,
      capacity: tesla.capacity,
      isOnline: tesla.isOnline,
    },
    activePoolId: activePool?.id ?? null,
    seatsOccupied: activePool?.seatsOccupied ?? 0,
    requests,
  };
}