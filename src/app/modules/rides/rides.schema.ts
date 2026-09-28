import { z } from 'zod';

export const createRideSchema = z
  .object({
    pickupZoneId: z.string().min(1),
    destinationZoneId: z.string().min(1),
    seats: z.number().int().min(1).max(3),
    paymentMethod: z.enum(['CASH', 'TESLAPAY']),
  })
  .strict(); 

export type CreateRideInput = z.infer<typeof createRideSchema>;