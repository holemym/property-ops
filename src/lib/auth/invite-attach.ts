import type { Role } from '@/types/domain'

// ---------------------------------------------------------------------------
// invite-attach — the pure decision core of inviteOrAttachUser
// (src/app/(app)/settings/users/actions.ts). Extracted so the security-critical
// branch table is unit-testable without mocking the admin client, mirroring the
// notify-inapp resolver precedent (pure, no I/O).
//
// THE INVARIANT THIS ENCODES (attach-hijack close): an invite for an email that
// already has an account may claim that account for the inviter's workspace ONLY
// when the account belongs to no workspace yet (workspace_id IS NULL). An account
// already in ANOTHER workspace is never re-pointed (that would hand the inviter a
// stranger's account: their data access moves to the inviter's workspace and their
// role is whatever the inviter chose). An account already in THIS workspace never
// has its role overwritten by an invite (re-inviting an OWNER as TENANT must not
// demote them) — the only same-workspace case that proceeds is the portal path
// re-inviting someone who is already a resident here, which needs no profile
// write at all (the caller just links tenants.auth_user_id).
// ---------------------------------------------------------------------------

/** The slice of the existing `profiles` row the attach decision needs. */
export type AttachProfileState = {
  workspace_id: string | null
  role: Role
}

export type AttachDecision =
  /** Workspace-less account — claim it (conditionally, pinned on workspace_id IS NULL). */
  | { kind: 'attach' }
  /** Already a resident of this workspace — skip the profile write, proceed to linking. */
  | { kind: 'already-member' }
  /** Never attach — surface the message to the inviter. */
  | { kind: 'refuse'; message: string }

const TENANT_ROLES: Role[] = ['TENANT', 'GUEST']

export function decideAttach(
  profile: AttachProfileState,
  targetRole: Role,
  workspaceId: string
): AttachDecision {
  if (profile.workspace_id === workspaceId) {
    // Same workspace. A portal invite for someone who is already a resident here is
    // a legitimate re-link (e.g. the directory contact was linked late) — no profile
    // write needed or allowed. Every other same-workspace combination is a refusal:
    // an invite must never overwrite an existing member's role.
    if (targetRole === 'TENANT' && TENANT_ROLES.includes(profile.role)) {
      return { kind: 'already-member' }
    }
    if (targetRole === 'TENANT') {
      return { kind: 'refuse', message: 'This email belongs to a workspace staff member, not a resident.' }
    }
    return { kind: 'refuse', message: 'This person is already a member of this workspace.' }
  }

  if (profile.workspace_id !== null) {
    return { kind: 'refuse', message: 'That email is already in use in another workspace.' }
  }

  return { kind: 'attach' }
}
