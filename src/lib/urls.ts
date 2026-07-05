// Shared URL constants. Lives outside the 'use server' action files because those
// may only export async server actions, not constants.
export const AUTH_CALLBACK_URL = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
