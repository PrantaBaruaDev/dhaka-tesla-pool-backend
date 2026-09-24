import { z } from 'zod';

export const toggleStatusSchema = z
  .object({
    online: z.boolean(),
  })
  .strict();

export type ToggleStatusInput = z.infer<typeof toggleStatusSchema>;