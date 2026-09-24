import { prisma } from '../../lib/prisma';
import { ApiError } from '../../../middleware/error.handler';
import { logger } from '../../lib/logger';
import {
  haversineMeters,
  roadDistanceMeters,
  fareFromRoadDistance,
} from '@/app/modules/fares/fare.service';
import type { CreateRideInput } from './rides.schema';

// ── Create ──────────────────────────────────────────────────────────
export async function createRide(passengerId: string, input: CreateRideInput) {
  logger.debug('rides', 'create attempt', {
    passengerId,
    pickup: input.pickupZoneId,
    dest: input.destinationZoneId,
    seats: input.seats,
  });

  const [pickupZone, destZone] = await Promise.all([
    prisma.zone.findUnique({ where: { id: input.pickupZoneId } }),
    prisma.zone.findUnique({ where: { id: input.destinationZoneId } }),
  ]);

  if (!pickupZone) {
    throw new ApiError(404, 'ZONE_NOT_FOUND', `Pickup zone ${input.pickupZoneId} does not exist.`);
  }
  if (!destZone) {
    throw new ApiError(404, 'ZONE_NOT_FOUND', `Destination zone ${input.destinationZoneId} does not exist.`);
  }
  if (pickupZone.id === destZone.id) {
    throw new ApiError(400, 'SAME_ZONE', 'Pickup and destination zones must be different.');
  }

  const straight = haversineMeters(pickupZone.lat, pickupZone.lng, destZone.lat, destZone.lng);
  const road = roadDistanceMeters(pickupZone.lat, pickupZone.lng, destZone.lat, destZone.lng);

  // Estimate uses solo fare (no discount); final fare is computed at completion.
  const { finalPoysha: estimatedFare } = fareFromRoadDistance(road, false);

  const ride = await prisma.$transaction(async (tx) => {
    const created = await tx.rideRequest.create({
      data: {
        passengerId,
        pickupZoneId: input.pickupZoneId,
        destinationZoneId: input.destinationZoneId,
        seatsRequested: input.seats,
        status: 'REQUESTED',
        straightLineMeters: straight,
        roadDistanceMeters: road,
        estimatedFarePoysha: estimatedFare,
        paymentMethod: input.paymentMethod,
      },
      include: {
        pickupZone: { select: { id: true, name: true, cluster: true } },
        destinationZone: { select: { id: true, name: true, cluster: true } },
      },
    });

    await tx.rideStatusHistory.create({
      data: {
        rideRequestId: created.id,
        fromStatus: null,
        toStatus: 'REQUESTED',
        changedBy: passengerId,
      },
    });

    return created;
  });

  logger.info('rides', 'created', {
    rideId: ride.id,
    passengerId,
    straight,
    road,
    estimatedFare,
  });

  return ride;
}

// ── Read (own) ──────────────────────────────────────────────────────
export async function getMyRides(passengerId: string) {
  return prisma.rideRequest.findMany({
    where: { passengerId },
    include: {
      pickupZone: { select: { id: true, name: true } },
      destinationZone: { select: { id: true, name: true } },
    },
    orderBy: { requestedAt: 'desc' },
  });
}

// ── Read (single, ownership-checked) ────────────────────────────────
export async function getRideById(rideId: string, userId: string, role: string) {
  const ride = await prisma.rideRequest.findUnique({
    where: { id: rideId },
    include: {
      pickupZone: { select: { id: true, name: true } },
      destinationZone: { select: { id: true, name: true } },
    },
  });

  if (!ride) throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride does not exist.');

  if (role === 'PASSENGER' && ride.passengerId !== userId) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only view your own rides.');
  }

  return ride;
}

// ── Cancel ──────────────────────────────────────────────────────────
export async function cancelRide(rideId: string, passengerId: string) {
  const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
  if (!ride) throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride does not exist.');

  if (ride.passengerId !== passengerId) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only cancel your own rides.');
  }

  const cancellable: string[] = ['REQUESTED', 'MATCHED'];
  if (!cancellable.includes(ride.status)) {
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      `Cannot cancel a ride in status ${ride.status}.`,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.rideRequest.update({
      where: { id: rideId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    // If the ride was already in a pool, free the seat(s).
    if (ride.poolId) {
      const pool = await tx.pool.findUnique({ where: { id: ride.poolId } });
      if (pool) {
        const newSeats = Math.max(0, pool.seatsOccupied - ride.seatsRequested);
        await tx.pool.update({
          where: { id: pool.id },
          data: {
            seatsOccupied: newSeats,
            version: { increment: 1 },
            ...(newSeats === 0 ? { status: 'CANCELLED' } : {}),
          },
        });
      }
    }

    await tx.rideStatusHistory.create({
      data: {
        rideRequestId: rideId,
        fromStatus: ride.status,
        toStatus: 'CANCELLED',
        changedBy: passengerId,
      },
    });

    return r;
  });

  logger.info('rides', 'cancelled', { rideId, passengerId });
  return updated;
}


// History: full audit trail for a single ride 
export async function getRideHistory(rideId: string, userId: string, role: string) {
  const ride = await prisma.rideRequest.findUnique({
    where: { id: rideId },
    include: {
      pickupZone: { select: { name: true } },
      destinationZone: { select: { name: true } },
    },
  });

  if (!ride) throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride does not exist.');

  if (role === 'PASSENGER' && ride.passengerId !== userId) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only view history for your own rides.');
  }

  const timeline = await prisma.rideStatusHistory.findMany({
    where: { rideRequestId: rideId },
    include: {
      changedByUser: { select: { id: true, name: true, role: true } },
    },
    orderBy: { changedAt: 'asc' },
  });

  return {
    rideRequestId: ride.id,
    currentStatus: ride.status,
    pickupZone: ride.pickupZone.name,
    destinationZone: ride.destinationZone.name,
    seatsRequested: ride.seatsRequested,
    roadDistanceMeters: ride.roadDistanceMeters,
    estimatedFarePoysha: ride.estimatedFarePoysha,
    finalFarePoysha: ride.finalFarePoysha,
    requestedAt: ride.requestedAt,
    matchedAt: ride.matchedAt,
    completedAt: ride.completedAt,
    cancelledAt: ride.cancelledAt,
    timeline: timeline.map((t) => ({
      id: t.id,
      fromStatus: t.fromStatus,
      toStatus: t.toStatus,
      changedBy: {
        id: t.changedByUser.id,
        name: t.changedByUser.name,
        role: t.changedByUser.role,
      },
      changedAt: t.changedAt,
    })),
  };
}