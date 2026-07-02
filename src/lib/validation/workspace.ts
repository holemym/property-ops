import { z } from 'zod'

export const workspaceFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120),
  currency: z.string().min(3).max(3).default('EUR'),
  language: z.string().min(2).max(5).default('en'),
})

export type WorkspaceFormValues = z.infer<typeof workspaceFormSchema>
