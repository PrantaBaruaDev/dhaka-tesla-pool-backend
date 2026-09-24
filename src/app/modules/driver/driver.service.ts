import { prisma } from '../../lib/prisma';
import { ApiError } from '../../../middleware/error.handler';
import { logger } from '../../lib/logger';
import type { ToggleStatusInput } from './driver.schema';
import { fareFromRoadDistance } from '../fares/fare.service';

// ── Helper: fetch this driver's Tesla (throws if missing) ────────────
export async function getDriverTesla(driverId: string) {
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

// Accept a REQUESTED ride → create or join a pool 
export async function acceptRequest(driverId: string, rideRequestId: string) {
  const tesla = await getDriverTesla(driverId);

  logger.debug('pool', 'accept attempt', { driverId, rideRequestId, teslaId: tesla.id });

  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Claim the ride atomically 
        // This is the crux: only ONE transaction can transition a ride
        // from REQUESTED → MATCHED, because updateMany's WHERE clause
        // is evaluated atomically at the DB level.
        const ride = await tx.rideRequest.findUnique({
          where: { id: rideRequestId },
          include: {
            pickupZone: { select: { id: true, name: true, cluster: true } },
            destinationZone: { select: { id: true, name: true, cluster: true } },
          },
        });

        if (!ride) throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride does not exist.');
        if (ride.status !== 'REQUESTED') {
          throw new ApiError(409, 'INVALID_TRANSITION', `Ride is already ${ride.status}.`);
        }

        // ── 2. Find this Tesla's active pool ────────────────────────
        const activePool = await tx.pool.findFirst({
          where: { teslaId: tesla.id, status: 'OPEN' },
          orderBy: { id: 'desc' },
        });

        // ── Case A: no active pool → create one ─────────────────────
        if (!activePool) {
          // Claim the ride FIRST, before creating the pool.
          // If someone else already claimed it, count === 0 and we abort.
          const claimed = await tx.rideRequest.updateMany({
            where: { id: rideRequestId, status: 'REQUESTED' },
            data: { status: 'MATCHED', matchedAt: new Date() },
          });
          if (claimed.count === 0) {
            throw new ApiError(409, 'INVALID_TRANSITION', 'Ride was claimed by another driver.');
          }

          const newPool = await tx.pool.create({
            data: {
              teslaId: tesla.id,
              status: 'OPEN',
              seatsOccupied: ride.seatsRequested,
              version: 0,
            },
          });

          // Now attach the pool
          await tx.rideRequest.update({
            where: { id: rideRequestId },
            data: { poolId: newPool.id },
          });

          await tx.rideStatusHistory.create({
            data: {
              rideRequestId,
              fromStatus: 'REQUESTED',
              toStatus: 'MATCHED',
              changedBy: driverId,
            },
          });

          logger.info('pool', 'new pool created', {
            poolId: newPool.id,
            rideId: rideRequestId,
            seats: ride.seatsRequested,
            attempt,
          });

          return { pool: newPool, ride: { ...ride, poolId: newPool.id, status: 'MATCHED' }, created: true };
        }

        // ── Case B: join existing pool ──────────────────────────────
        // Capacity check (read-time, re-checked atomically on update)
        if (activePool.seatsOccupied + ride.seatsRequested > tesla.capacity) {
          logger.warn('pool', 'POOL_FULL rejection', {
            poolId: activePool.id,
            seatsOccupied: activePool.seatsOccupied,
            requested: ride.seatsRequested,
            capacity: tesla.capacity,
          });
          throw new ApiError(409, 'POOL_FULL', `${tesla.label} has no seats left.`, {
            poolId: activePool.id,
            seatsOccupied: activePool.seatsOccupied,
            capacity: tesla.capacity,
          });
        }

        // Cluster matching rule
        const poolFirstRide = await tx.rideRequest.findFirst({
          where: { poolId: activePool.id },
          include: {
            pickupZone: { select: { cluster: true } },
            destinationZone: { select: { cluster: true } },
          },
        });

        if (poolFirstRide) {
          const samePickup = poolFirstRide.pickupZone.cluster === ride.pickupZone.cluster;
          const sameDest = poolFirstRide.destinationZone.cluster === ride.destinationZone.cluster;
          if (!samePickup || !sameDest) {
            throw new ApiError(
              409,
              'CLUSTER_MISMATCH',
              'This request is on a different corridor than the active pool.',
            );
          }
        }

        // ── 3. Atomically increment the pool, guarded by version ────
        // If another transaction already incremented the version, this
        // update matches 0 rows and we retry the whole transaction.
        const poolUpdate = await tx.pool.updateMany({
          where: {
            id: activePool.id,
            version: activePool.version,   // ← optimistic lock
            status: 'OPEN',
          },
          data: {
            seatsOccupied: { increment: ride.seatsRequested },
            version: { increment: 1 },
          },
        });

        if (poolUpdate.count === 0) {
          // Version changed or pool is no longer OPEN → retry
          throw new ApiError(409, 'RETRY_NEEDED', 'Pool state changed, retry.');
        }

        // ── 4. Claim the ride (only if still REQUESTED) ─────────────
        const claimed = await tx.rideRequest.updateMany({
          where: { id: rideRequestId, status: 'REQUESTED' },
          data: { status: 'MATCHED', poolId: activePool.id, matchedAt: new Date() },
        });

        if (claimed.count === 0) {
          // Ride was claimed by someone else — abort the whole transaction,
          // the pool increment will roll back too.
          throw new ApiError(409, 'INVALID_TRANSITION', 'Ride was claimed by another driver.');
        }

        await tx.rideStatusHistory.create({
          data: {
            rideRequestId,
            fromStatus: 'REQUESTED',
            toStatus: 'MATCHED',
            changedBy: driverId,
          },
        });

        const updatedPool = await tx.pool.findUniqueOrThrow({
          where: { id: activePool.id },
        });

        logger.info('pool', 'joined existing pool', {
          poolId: updatedPool.id,
          rideId: rideRequestId,
          seats: updatedPool.seatsOccupied,
          version: updatedPool.version,
          attempt,
        });

        return {
          pool: updatedPool,
          ride: { ...ride, poolId: updatedPool.id, status: 'MATCHED' },
          created: false,
        };
      });

      return result;
    } catch (err) {
      // Only retry on our explicit retry signal, not on capacity or cluster errors
      if (err instanceof ApiError && err.code === 'RETRY_NEEDED' && attempt < MAX_RETRIES) {
        logger.debug('pool', `optimistic lock retry ${attempt}/${MAX_RETRIES}`);
        continue;
      }
      throw err;
    }
  }

  throw new ApiError(503, 'TOO_MANY_RETRIES', 'Pool contention too high, try again.');
}
