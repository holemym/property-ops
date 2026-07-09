import { z } from 'zod'

// Shared password policy (Track S1.6) for signup and set-password. Supabase's own
// minimum is 6 chars; this is the app's stricter floor. Paired with the Supabase
// dashboard leaked-password-protection setting (docs/runbooks/supabase-security-settings.md) —
// this schema only guards length, which is the one thing worth enforcing app-side.
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')

export const signupSchema = z.object({
  fullName: z.string().min(1, 'Enter your name.'),
  email: z.string().email('Enter a valid email address.'),
  password: passwordSchema,
})
