/**
 * @vitest-environment node
 *
 * Canvas authentication tests.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => ({
  and: (...args: any[]) => args,
  eq: (...args: any[]) => args,
}))

const selectResults: Array<any[]> = []

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  })),
}

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

vi.mock('@sim/db/schema', () => ({
  serviceApiKey: {
    id: 'id',
    keyHash: 'key_hash',
    keyPrefix: 'key_prefix',
    serviceName: 'service_name',
    permissions: 'permissions',
    rateLimitPerMinute: 'rate_limit_per_minute',
    rateLimitPerDay: 'rate_limit_per_day',
    isActive: 'is_active',
    expiresAt: 'expires_at',
    metadata: 'metadata',
  },
}))

const buildRequest = (key?: string) => {
  const headers = new Headers()
  if (key) {
    headers.set('x-service-key', key)
  }
  return new NextRequest(new URL('http://localhost:3000/api/test'), { headers })
}

describe('authenticateCanvasRequest', () => {
  beforeEach(() => {
    selectResults.length = 0
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('rejects missing service key', async () => {
    const { authenticateCanvasRequest } = await import('@/app/api/integrations/canvas/auth')
    const result = await authenticateCanvasRequest(buildRequest())

    expect(result.authenticated).toBe(false)
    if (!result.authenticated) {
      expect(result.code).toBe('MISSING_KEY')
    }
  })

  it('rejects invalid service key prefix', async () => {
    const { authenticateCanvasRequest } = await import('@/app/api/integrations/canvas/auth')
    const result = await authenticateCanvasRequest(buildRequest('invalid_key'))

    expect(result.authenticated).toBe(false)
    if (!result.authenticated) {
      expect(result.code).toBe('INVALID_KEY')
    }
  })

  it('rejects unknown service key', async () => {
    const { authenticateCanvasRequest } = await import('@/app/api/integrations/canvas/auth')
    const result = await authenticateCanvasRequest(buildRequest('sim_svc_missing'))

    expect(result.authenticated).toBe(false)
    if (!result.authenticated) {
      expect(result.code).toBe('INVALID_KEY')
    }
  })

  it('rejects inactive service key', async () => {
    const { authenticateCanvasRequest, hashKey } = await import('@/app/api/integrations/canvas/auth')
    const key = 'sim_svc_inactive'

    selectResults.push([
      {
        id: 'key-id',
        keyHash: hashKey(key),
        keyPrefix: key.slice(0, 16),
        serviceName: 'canvas',
        permissions: ['blocks:execute'],
        isActive: false,
        expiresAt: null,
        rateLimitPerMinute: null,
        rateLimitPerDay: null,
        metadata: {},
      },
    ])

    const result = await authenticateCanvasRequest(buildRequest(key), ['blocks:execute'])

    expect(result.authenticated).toBe(false)
    if (!result.authenticated) {
      expect(result.code).toBe('INACTIVE_KEY')
    }
  })

  it('rejects expired service key', async () => {
    const { authenticateCanvasRequest, hashKey } = await import('@/app/api/integrations/canvas/auth')
    const key = 'sim_svc_expired'

    selectResults.push([
      {
        id: 'key-id',
        keyHash: hashKey(key),
        keyPrefix: key.slice(0, 16),
        serviceName: 'canvas',
        permissions: ['blocks:execute'],
        isActive: true,
        expiresAt: new Date(Date.now() - 1000),
        rateLimitPerMinute: null,
        rateLimitPerDay: null,
        metadata: {},
      },
    ])

    const result = await authenticateCanvasRequest(buildRequest(key), ['blocks:execute'])

    expect(result.authenticated).toBe(false)
    if (!result.authenticated) {
      expect(result.code).toBe('EXPIRED_KEY')
    }
  })

  it('rejects insufficient scopes', async () => {
    const { authenticateCanvasRequest, hashKey } = await import('@/app/api/integrations/canvas/auth')
    const key = 'sim_svc_scoped'

    selectResults.push([
      {
        id: 'key-id',
        keyHash: hashKey(key),
        keyPrefix: key.slice(0, 16),
        serviceName: 'canvas',
        permissions: ['blocks:list'],
        isActive: true,
        expiresAt: null,
        rateLimitPerMinute: 1000,
        rateLimitPerDay: 100000,
        metadata: {},
      },
    ])

    const result = await authenticateCanvasRequest(buildRequest(key), ['blocks:execute'])

    expect(result.authenticated).toBe(false)
    if (!result.authenticated) {
      expect(result.code).toBe('INSUFFICIENT_SCOPE')
    }
  })

  it('authenticates valid service key', async () => {
    const { authenticateCanvasRequest, hashKey } = await import('@/app/api/integrations/canvas/auth')
    const key = 'sim_svc_valid'

    selectResults.push([
      {
        id: 'key-id',
        keyHash: hashKey(key),
        keyPrefix: key.slice(0, 16),
        serviceName: 'canvas',
        permissions: ['blocks:execute', 'users:provision'],
        isActive: true,
        expiresAt: null,
        rateLimitPerMinute: 1000,
        rateLimitPerDay: 100000,
        metadata: {},
      },
    ])

    const result = await authenticateCanvasRequest(buildRequest(key), ['blocks:execute'])

    expect(result.authenticated).toBe(true)
    if (result.authenticated) {
      expect(result.context.serviceName).toBe('canvas')
      expect(result.context.keyPrefix).toBe(key.slice(0, 16))
    }
  })
})
