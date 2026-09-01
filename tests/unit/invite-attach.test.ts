import { describe, it, expect } from 'vitest'
import { decideAttach, type AttachProfileState } from '@/lib/auth/invite-attach'
import type { Role } from '@/types/domain'

const WS = 'ws-1'
const OTHER_WS = 'ws-2'

function profile(workspace_id: string | null, role: Role): AttachProfileState {
  return { workspace_id, role }
}

describe('decideAttach', () => {
  // THE HIJACK CLOSE: an account already in another workspace is never attached,
  // regardless of the role the inviter picked.
  it('refuses an account that belongs to another workspace (staff invite)', () => {
    const d = decideAttach(profile(OTHER_WS, 'OWNER'), 'OPERATOR', WS)
    expect(d.kind).toBe('refuse')
  })

  it('refuses an account that belongs to another workspace (portal invite)', () => {
    const d = decideAttach(profile(OTHER_WS, 'TENANT'), 'TENANT', WS)
    expect(d.kind).toBe('refuse')
  })

  // The only legitimate claim: a workspace-less profile.
  it('attaches a workspace-less profile (staff invite)', () => {
    expect(decideAttach(profile(null, 'OPERATOR'), 'OPERATOR', WS)).toEqual({ kind: 'attach' })
  })

  it('attaches a workspace-less profile (portal invite)', () => {
    expect(decideAttach(profile(null, 'GUEST'), 'TENANT', WS)).toEqual({ kind: 'attach' })
  })

  // Same-workspace: an invite never overwrites an existing member's role.
  it('refuses re-inviting an existing member as staff (no role overwrite)', () => {
    const d = decideAttach(profile(WS, 'OWNER'), 'OPERATOR', WS)
    expect(d.kind).toBe('refuse')
  })

  it('refuses a portal invite aimed at a same-workspace STAFF profile (no demotion)', () => {
    for (const staffRole of ['OWNER', 'OPERATOR', 'ACCOUNTANT', 'SUPER_ADMIN'] as Role[]) {
      const d = decideAttach(profile(WS, staffRole), 'TENANT', WS)
      expect(d.kind).toBe('refuse')
    }
  })

  it('refuses a staff invite aimed at a same-workspace resident (no escalation)', () => {
    const d = decideAttach(profile(WS, 'TENANT'), 'OWNER', WS)
    expect(d.kind).toBe('refuse')
  })

  // The one same-workspace pass-through: portal re-invite of an existing resident,
  // which proceeds to tenants.auth_user_id linking with NO profile write.
  it('passes through a portal invite for an existing same-workspace resident', () => {
    expect(decideAttach(profile(WS, 'TENANT'), 'TENANT', WS)).toEqual({ kind: 'already-member' })
    expect(decideAttach(profile(WS, 'GUEST'), 'TENANT', WS)).toEqual({ kind: 'already-member' })
  })
})
