import { describe, it, expect } from 'vitest'
import { buildGeocodeQuery, parseNominatimResponse, geocodeRateLimitKey } from '@/lib/geocode'

describe('buildGeocodeQuery', () => {
  it('formats a full valid address as "line1, postalCode city, country"', () => {
    expect(
      buildGeocodeQuery({ line1: 'Ringstrasse 12', postalCode: '1010', city: 'Wien', country: 'Austria' })
    ).toBe('Ringstrasse 12, 1010 Wien, Austria')
  })

  it('trims whitespace on every part', () => {
    expect(
      buildGeocodeQuery({ line1: '  Ringstrasse 12  ', postalCode: ' 1010 ', city: ' Wien ', country: ' Austria ' })
    ).toBe('Ringstrasse 12, 1010 Wien, Austria')
  })

  it('drops a missing postal code without leaving a stray space', () => {
    expect(
      buildGeocodeQuery({ line1: 'Ringstrasse 12', postalCode: '', city: 'Wien', country: 'Austria' })
    ).toBe('Ringstrasse 12, Wien, Austria')
  })

  it('drops a missing city, keeping only the postal code', () => {
    expect(
      buildGeocodeQuery({ line1: 'Ringstrasse 12', postalCode: '1010', city: '', country: 'Austria' })
    ).toBe('Ringstrasse 12, 1010, Austria')
  })

  it('omits a missing line1, still joining the remaining parts', () => {
    expect(
      buildGeocodeQuery({ line1: '', postalCode: '1010', city: 'Wien', country: 'Austria' })
    ).toBe('1010 Wien, Austria')
  })

  it('omits a missing country', () => {
    expect(
      buildGeocodeQuery({ line1: 'Ringstrasse 12', postalCode: '1010', city: 'Wien', country: '' })
    ).toBe('Ringstrasse 12, 1010 Wien')
  })

  it('returns an empty string when every part is empty', () => {
    expect(buildGeocodeQuery({ line1: '', postalCode: '', city: '', country: '' })).toBe('')
  })

  it('returns an empty string for whitespace-only garbage input', () => {
    expect(buildGeocodeQuery({ line1: '   ', postalCode: '\t', city: '  ', country: '' })).toBe('')
  })
})

describe('parseNominatimResponse', () => {
  it('parses a valid single-result response, coercing string lat/lon to numbers', () => {
    expect(parseNominatimResponse([{ lat: '48.2082', lon: '16.3738' }])).toEqual({
      lat: 48.2082,
      lng: 16.3738,
    })
  })

  it('parses numeric lat/lon too (defensive — jsonv2 always sends strings)', () => {
    expect(parseNominatimResponse([{ lat: 48.2, lon: 16.37 }])).toEqual({ lat: 48.2, lng: 16.37 })
  })

  it('reads only the first match and ignores extra fields on it', () => {
    const result = parseNominatimResponse([
      { lat: '48.2082', lon: '16.3738', display_name: 'Vienna, Austria', importance: 0.9 },
      { lat: '1', lon: '1' },
    ])
    expect(result).toEqual({ lat: 48.2082, lng: 16.3738 })
  })

  it('returns null for an empty array (no match found)', () => {
    expect(parseNominatimResponse([])).toBeNull()
  })

  it('returns null for garbage input that is not an array', () => {
    expect(parseNominatimResponse({ error: 'Unable to geocode' })).toBeNull()
    expect(parseNominatimResponse(null)).toBeNull()
    expect(parseNominatimResponse(undefined)).toBeNull()
    expect(parseNominatimResponse('not json')).toBeNull()
    expect(parseNominatimResponse(42)).toBeNull()
  })

  it('returns null for garbage array entries', () => {
    expect(parseNominatimResponse([null])).toBeNull()
    expect(parseNominatimResponse(['a bare string result'])).toBeNull()
    expect(parseNominatimResponse([42])).toBeNull()
  })

  it('returns null for non-numeric lat/lon', () => {
    expect(parseNominatimResponse([{ lat: 'not-a-number', lon: '16.3738' }])).toBeNull()
    expect(parseNominatimResponse([{ lat: '48.2082', lon: 'not-a-number' }])).toBeNull()
  })

  it('returns null for blank lat/lon strings (Number(\'\') would otherwise coerce to 0)', () => {
    expect(parseNominatimResponse([{ lat: '', lon: '16.3738' }])).toBeNull()
    expect(parseNominatimResponse([{ lat: '   ', lon: '16.3738' }])).toBeNull()
  })

  it('returns null when lat or lon is missing entirely', () => {
    expect(parseNominatimResponse([{ lon: '16.3738' }])).toBeNull()
    expect(parseNominatimResponse([{ lat: '48.2082' }])).toBeNull()
    expect(parseNominatimResponse([{}])).toBeNull()
  })
})

describe('geocodeRateLimitKey', () => {
  it('builds a workspace-scoped bucket key', () => {
    expect(geocodeRateLimitKey('workspace-a')).toBe('geocode:workspace-a')
  })

  it('gives different workspaces different keys (one workspace can never exhaust another\'s budget)', () => {
    expect(geocodeRateLimitKey('workspace-a')).not.toBe(geocodeRateLimitKey('workspace-b'))
  })
})
