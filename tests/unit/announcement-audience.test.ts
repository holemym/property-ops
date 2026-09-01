import { describe, it, expect } from 'vitest'
import { resolveAnnouncementAudience, type AudienceProfile } from '@/lib/notifications/announcement-audience'

// The pure core of the ANNOUNCEMENT_PUBLISHED fan-out (publishAnnouncementAction).
// Mirrors the resolver-branch coverage style of notify-inapp's recipient resolvers:
// the audience must match EXACTLY what tenant_can_read_announcement (migration 0030)
// grants read access to, so nobody is pinged about a notice they cannot open.

const TODAY = '2026-09-01'

const profiles: AudienceProfile[] = [
  { id: 'user-owner', role: 'OWNER', is_active: true },
  { id: 'user-tenant-a', role: 'TENANT', is_active: true },
  { id: 'user-tenant-b', role: 'TENANT', is_active: true },
  { id: 'user-guest', role: 'GUEST', is_active: true },
  { id: 'user-tenant-inactive', role: 'TENANT', is_active: false },
  { id: 'user-accountant', role: 'ACCOUNTANT', is_active: true },
]

const units = [
  { id: 'unit-1', property_id: 'prop-1' },
  { id: 'unit-2', property_id: 'prop-1' },
  { id: 'unit-3', property_id: 'prop-2' },
]

const tenants = [
  { id: 'tenant-a', auth_user_id: 'user-tenant-a' },
  { id: 'tenant-b', auth_user_id: 'user-tenant-b' },
  { id: 'tenant-uninvited', auth_user_id: null },
]

describe('resolveAnnouncementAudience', () => {
  it('workspace-wide: every active TENANT/GUEST profile, no managers/accountant', () => {
    const result = resolveAnnouncementAudience({
      propertyId: null,
      profiles,
      tenants: [],
      tenancies: [],
      units: [],
      today: TODAY,
    })
    expect(result).toEqual(['user-tenant-a', 'user-tenant-b', 'user-guest'])
  })

  it('workspace-wide: a deactivated tenant profile is excluded (0030 is_active gate)', () => {
    const result = resolveAnnouncementAudience({
      propertyId: null,
      profiles,
      tenants: [],
      tenancies: [],
      units: [],
      today: TODAY,
    })
    expect(result).not.toContain('user-tenant-inactive')
  })

  it('property-targeted: only tenants holding an ACTIVE tenancy in that property', () => {
    const result = resolveAnnouncementAudience({
      propertyId: 'prop-1',
      profiles,
      tenants,
      tenancies: [
        // active, open-ended, in prop-1 -> included
        { tenant_id: 'tenant-a', unit_id: 'unit-1', start_date: '2025-01-01', end_date: null },
        // active but in prop-2 -> excluded
        { tenant_id: 'tenant-b', unit_id: 'unit-3', start_date: '2025-01-01', end_date: null },
      ],
      units,
      today: TODAY,
    })
    expect(result).toEqual(['user-tenant-a'])
  })

  it('property-targeted: an ENDED tenancy no longer receives (former-tenant guard)', () => {
    const result = resolveAnnouncementAudience({
      propertyId: 'prop-1',
      profiles,
      tenants,
      tenancies: [
        { tenant_id: 'tenant-a', unit_id: 'unit-1', start_date: '2024-01-01', end_date: '2026-08-31' },
      ],
      units,
      today: TODAY,
    })
    expect(result).toEqual([])
  })

  it('property-targeted: a FUTURE tenancy does not receive yet', () => {
    const result = resolveAnnouncementAudience({
      propertyId: 'prop-1',
      profiles,
      tenants,
      tenancies: [
        { tenant_id: 'tenant-a', unit_id: 'unit-1', start_date: '2026-10-01', end_date: null },
      ],
      units,
      today: TODAY,
    })
    expect(result).toEqual([])
  })

  it('property-targeted: start/end boundary days are INCLUSIVE, matching the 0030 SQL', () => {
    const result = resolveAnnouncementAudience({
      propertyId: 'prop-1',
      profiles,
      tenants,
      tenancies: [
        // starts today -> included; ends today -> still included
        { tenant_id: 'tenant-a', unit_id: 'unit-1', start_date: TODAY, end_date: null },
        { tenant_id: 'tenant-b', unit_id: 'unit-2', start_date: '2025-01-01', end_date: TODAY },
      ],
      units,
      today: TODAY,
    })
    expect(result).toEqual(['user-tenant-a', 'user-tenant-b'])
  })

  it('property-targeted: unlinked tenancies and un-invited tenants contribute nothing (fail closed)', () => {
    const result = resolveAnnouncementAudience({
      propertyId: 'prop-1',
      profiles,
      tenants,
      tenancies: [
        // pre-P1 free-text tenancy (tenant_id null)
        { tenant_id: null, unit_id: 'unit-1', start_date: '2025-01-01', end_date: null },
        // linked but never invited to the portal (auth_user_id null)
        { tenant_id: 'tenant-uninvited', unit_id: 'unit-2', start_date: '2025-01-01', end_date: null },
      ],
      units,
      today: TODAY,
    })
    expect(result).toEqual([])
  })

  it('property-targeted: a tenant with several active tenancies appears once (dedupe)', () => {
    const result = resolveAnnouncementAudience({
      propertyId: 'prop-1',
      profiles,
      tenants,
      tenancies: [
        { tenant_id: 'tenant-a', unit_id: 'unit-1', start_date: '2025-01-01', end_date: null },
        { tenant_id: 'tenant-a', unit_id: 'unit-2', start_date: '2025-06-01', end_date: null },
      ],
      units,
      today: TODAY,
    })
    expect(result).toEqual(['user-tenant-a'])
  })

  it('property-targeted: a targeted resident whose PROFILE is deactivated is excluded', () => {
    const result = resolveAnnouncementAudience({
      propertyId: 'prop-1',
      profiles,
      tenants: [{ id: 'tenant-x', auth_user_id: 'user-tenant-inactive' }],
      tenancies: [
        { tenant_id: 'tenant-x', unit_id: 'unit-1', start_date: '2025-01-01', end_date: null },
      ],
      units,
      today: TODAY,
    })
    expect(result).toEqual([])
  })
})
