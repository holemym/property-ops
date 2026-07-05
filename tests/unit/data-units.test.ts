import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listUnits, getUnit, createUnit, updateUnit } from '@/lib/data/units'

const WORKSPACE_A = 'workspace-a'
const WORKSPACE_B = 'workspace-b'
const PROPERTY_1 = 'prop-1'
const PROPERTY_2 = 'prop-2'

describe('units data access', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      units: [
        { id: 'unit-1', workspace_id: WORKSPACE_A, property_id: PROPERTY_1, label: 'Top floor', status: 'OCCUPIED', occupancy_type: 'LONG_TERM', created_at: '2026-01-01T00:00:00Z' },
        { id: 'unit-2', workspace_id: WORKSPACE_A, property_id: PROPERTY_2, label: 'Studio', status: 'VACANT', occupancy_type: 'SHORT_TERM', created_at: '2026-01-02T00:00:00Z' },
        { id: 'unit-3', workspace_id: WORKSPACE_B, property_id: 'prop-other', label: 'Other WS unit', status: 'VACANT', occupancy_type: 'VACANT', created_at: '2026-01-03T00:00:00Z' },
      ],
    })
  })

  it('only lists units for the given workspace', async () => {
    const result = await listUnits(client, WORKSPACE_A)
    expect(result).toHaveLength(2)
    expect(result.map((u) => u.label)).not.toContain('Other WS unit')
  })

  it('filters by propertyId', async () => {
    const result = await listUnits(client, WORKSPACE_A, { propertyId: PROPERTY_1 })
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Top floor')
  })

  it('filters by status', async () => {
    const result = await listUnits(client, WORKSPACE_A, { status: 'VACANT' })
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Studio')
  })

  it('creates a unit linked to a property with default VACANT status and workspace scoping', async () => {
    const created = await createUnit(client, {
      workspaceId: WORKSPACE_A,
      propertyId: PROPERTY_1,
      label: 'New Unit',
      occupancyType: 'LONG_TERM',
    })
    expect(created.status).toBe('VACANT')
    expect(created.workspace_id).toBe(WORKSPACE_A)
    expect(created.property_id).toBe(PROPERTY_1)
    const listed = await listUnits(client, WORKSPACE_A)
    expect(listed.map((u) => u.label)).toContain('New Unit')
  })

  it('does not return a unit belonging to another workspace', async () => {
    const result = await getUnit(client, WORKSPACE_A, 'unit-3')
    expect(result).toBeNull()
  })

  it('clears an optional field when updated with null', async () => {
    const created = await createUnit(client, {
      workspaceId: WORKSPACE_A,
      propertyId: PROPERTY_1,
      label: 'Notable Unit',
      occupancyType: 'LONG_TERM',
      generalNotes: 'old note',
    })
    expect(created.general_notes).toBe('old note')

    await updateUnit(client, WORKSPACE_A, created.id, { generalNotes: null })

    const after = await getUnit(client, WORKSPACE_A, created.id)
    expect(after?.general_notes).toBeNull()
  })

  it('updates status and occupancy type', async () => {
    const updated = await updateUnit(client, WORKSPACE_A, 'unit-2', {
      status: 'MAINTENANCE',
      occupancyType: 'MIXED',
    })
    expect(updated.status).toBe('MAINTENANCE')
    expect(updated.occupancy_type).toBe('MIXED')
  })
})
