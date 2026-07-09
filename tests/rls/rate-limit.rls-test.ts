import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, teardown, svc, type RlsFixture } from './helpers'

// rate_limit_buckets (0022) is a zero-policy table like vendor_job_tokens (0014), and
// check_rate_limit() is a SECURITY DEFINER function revoked from public/authenticated
// like log_ticket_event (0012). Assert both locks: no role but service_role can read
// the table or invoke the function.
describe.skipIf(!hasLiveCreds())('RLS: rate_limit_buckets (zero-policy) + check_rate_limit()', () => {
  let f: RlsFixture

  beforeAll(async () => {
    f = await setupTwoWorkspaces()
  })
  afterAll(async () => {
    await teardown(f)
  })

  it('service can call check_rate_limit; authenticated (even OWNER) cannot', async () => {
    const key = `rls-test:${Date.now()}`
    const { data, error } = await svc().rpc('check_rate_limit', {
      p_key: key,
      p_max: 5,
      p_window_seconds: 60,
    })
    expect(error).toBeNull()
    expect(data).toBe(true)

    const { error: ownerError } = await f.clients.aOwner.rpc('check_rate_limit', {
      p_key: key,
      p_max: 5,
      p_window_seconds: 60,
    })
    expect(ownerError).not.toBeNull()

    const { error: opError } = await f.clients.aOperator.rpc('check_rate_limit', {
      p_key: key,
      p_max: 5,
      p_window_seconds: 60,
    })
    expect(opError).not.toBeNull()
  })

  it('authenticated (even OWNER) cannot read rate_limit_buckets directly', async () => {
    const { data: ownerRead } = await f.clients.aOwner.from('rate_limit_buckets').select('key')
    expect(ownerRead ?? []).toHaveLength(0)
  })

  it('the window blocks after p_max and resets after the window elapses', async () => {
    const key = `rls-test-window:${Date.now()}`
    const s = svc()
    for (let i = 0; i < 3; i++) {
      const { data } = await s.rpc('check_rate_limit', { p_key: key, p_max: 3, p_window_seconds: 60 })
      expect(data).toBe(true)
    }
    // 4th call within the same window exceeds p_max=3.
    const { data: fourth } = await s.rpc('check_rate_limit', { p_key: key, p_max: 3, p_window_seconds: 60 })
    expect(fourth).toBe(false)
  })
})
