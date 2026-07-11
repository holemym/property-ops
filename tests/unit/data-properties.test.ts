import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import {
  listProperties,
  getProperty,
  createProperty,
  updateProperty,
  archiveProperty,
  updatePropertyCoordinates,
} from '@/lib/data/properties'

const WORKSPACE_A = 'workspace-a'
const WORKSPACE_B = 'workspace-b'

describe('properties data access', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      properties: [
        { id: 'prop-1', workspace_id: WORKSPACE_A, name: 'Sunset Apartments', status: 'ACTIVE', created_at: '2026-01-01T00:00:00Z', latitude: null, longitude: null, geocoded_at: null },
        { id: 'prop-2', workspace_id: WORKSPACE_B, name: 'Other Workspace Building', status: 'ACTIVE', created_at: '2026-01-02T00:00:00Z', latitude: null, longitude: null, geocoded_at: null },
      ],
    })
  })

  it('only lists properties for the given workspace', async () => {
    const result = await listProperties(client, WORKSPACE_A)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Sunset Apartments')
  })

  it('filters by search text', async () => {
    const result = await listProperties(client, WORKSPACE_A, { search: 'sunset' })
    expect(result).toHaveLength(1)
    const noMatch = await listProperties(client, WORKSPACE_A, { search: 'nonexistent' })
    expect(noMatch).toHaveLength(0)
  })

  it('creates a property scoped to the workspace with ACTIVE status', async () => {
    const created = await createProperty(client, {
      workspaceId: WORKSPACE_A, name: 'New Building', addressLine1: '1 Main St',
      city: 'Vienna', postalCode: '1010', country: 'AT', propertyType: 'APARTMENT_BUILDING',
    })
    expect(created.status).toBe('ACTIVE')
    expect(created.workspace_id).toBe(WORKSPACE_A)
    const listed = await listProperties(client, WORKSPACE_A)
    expect(listed.map((p) => p.name)).toContain('New Building')
  })

  it('clears an optional field when updated with null', async () => {
    const created = await createProperty(client, {
      workspaceId: WORKSPACE_A, name: 'Notable Building', addressLine1: '1 Main St',
      city: 'Vienna', postalCode: '1010', country: 'AT', propertyType: 'APARTMENT_BUILDING',
      notes: 'old note',
    })
    expect(created.notes).toBe('old note')

    await updateProperty(client, WORKSPACE_A, created.id, { notes: null })

    const after = await getProperty(client, WORKSPACE_A, created.id)
    expect(after?.notes).toBeNull()
  })

  it('archives a property by id within the workspace', async () => {
    const archived = await archiveProperty(client, WORKSPACE_A, 'prop-1')
    expect(archived.status).toBe('ARCHIVED')
  })

  it('does not return a property belonging to another workspace', async () => {
    const result = await getProperty(client, WORKSPACE_A, 'prop-2')
    expect(result).toBeNull()
  })

  it('persists a geocode result onto the property row (Track M)', async () => {
    await updatePropertyCoordinates(client, WORKSPACE_A, 'prop-1', {
      latitude: 48.2082,
      longitude: 16.3738,
      geocoded_at: '2026-07-09T12:00:00Z',
    })

    const after = await getProperty(client, WORKSPACE_A, 'prop-1')
    expect(after?.latitude).toBe(48.2082)
    expect(after?.longitude).toBe(16.3738)
    expect(after?.geocoded_at).toBe('2026-07-09T12:00:00Z')
  })

  it('nulls out a stale geocode on a failed re-geocode', async () => {
    await updatePropertyCoordinates(client, WORKSPACE_A, 'prop-1', {
      latitude: 48.2082,
      longitude: 16.3738,
      geocoded_at: '2026-07-09T12:00:00Z',
    })
    await updatePropertyCoordinates(client, WORKSPACE_A, 'prop-1', {
      latitude: null,
      longitude: null,
      geocoded_at: null,
    })

    const after = await getProperty(client, WORKSPACE_A, 'prop-1')
    expect(after?.latitude).toBeNull()
    expect(after?.longitude).toBeNull()
    expect(after?.geocoded_at).toBeNull()
  })

  it('does not touch a property in another workspace', async () => {
    await updatePropertyCoordinates(client, WORKSPACE_A, 'prop-2', {
      latitude: 1,
      longitude: 1,
      geocoded_at: '2026-07-09T12:00:00Z',
    })

    const other = await getProperty(client, WORKSPACE_B, 'prop-2')
    expect(other?.latitude).toBeNull()
  })
})
