// Signup gating (Track S1.2). Default is 'open' (current/legacy behavior — anyone can
// self-register and gets their own isolated workspace via RLS). Set SIGNUP_MODE=invite
// for a single-organization deployment where accounts should only be created by an
// admin's invite (Settings -> Users). The server action is the enforcement boundary —
// this flag only changes what the UI offers and what the action accepts.
export function isInviteOnly(): boolean {
  return process.env.SIGNUP_MODE === 'invite'
}
