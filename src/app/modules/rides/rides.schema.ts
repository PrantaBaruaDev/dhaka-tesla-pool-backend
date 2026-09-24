import { z } from 'zod';

export const createRideSchema = z
  .object({
    // Zone IDs are strings like "z-banani", not UUIDs
    pickupZoneId: z.string().min(1),
    destinationZoneId: z.string().min(1),
    seats: z.number().int().min(1).max(3),
    paymentMethod: z.enum(['CASH', 'TESLAPAY']),
  })
  .strict();   // ← rejects distanceMeters, estimatedFarePoysha, poolId, etc.

export type CreateRideInput = z.infer<typeof createRideSchema>;