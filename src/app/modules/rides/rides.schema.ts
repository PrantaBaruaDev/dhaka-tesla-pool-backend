import { z } from 'zod';

export const createRideSchema = z
  .object({
    pickupZoneId: z.string().min(1),
    destinationZoneId: z.string().min(1),
    seats: z.number().int().min(1).max(3),
    paymentMethod: z.enum(['CASH', 'TESLAPAY']),
  })
  .strict(); 

export const previewRideSchema = z
.object({
  pickupZoneId: z.string().min(1),
  destinationZoneId: z.string().min(1),
  seats: z.number().int().min(1).max(3),
})
.strict();

export type PreviewRideInput = z.infer<typeof previewRideSchema>;
export type CreateRideInput = z.infer<typeof createRideSchema>;