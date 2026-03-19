import { z } from 'zod';

export const secretaryOverviewQuerySchema = z.object({
  campus: z.string().optional(),
});
