/**
 * @vitest-environment node
 *
 * Canvas user lookup route tests.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectResults: Array<any[]> = []

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => selectResults.shift() ?? []),
        })),
      })),
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  })),
}

const mockContext = {
  serviceName: 'canvas',
  keyId: 'key-id',
  keyPrefix: 'sim_svc_',
  scopes: ['users:read'],
  rateLimitPerMinute: null,
  rateLimitPerDay: null,
  metadata: {},
  canvasUserId: '11111111-1111-1111-1111-111111111111',
  canvasWorkspaceId: '22222222-2222-2222-2222-222222222222',
  requestId: 'req-id',
  idempotencyKey: undefined,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
}

vi.mock('../../middleware', () => ({
  withCanvasAuthParams: (handler: any) => async (
    request: NextRequest,
    routeContext: { params: Promise<{ canvasUserId: string }> }
  ) => {
    const params = await routeContext.params
    return handler(request, mockContext, params)
  },
}))

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

vi.mock('@sim/db/schema', () => ({
  account: {
    accountId: 'account_id',
    providerId: 'provider_id',
    userId: 'user_id',
    createdAt: 'created_at',
  },
  user: {
    id: 'id',
    email: 'email',
    name: 'name',
  },
  workspace: {
    id: 'id',
    ownerId: 'owner_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: any[]) => args,
  eq: (...args: any[]) => args,
}))

describe('Canvas user lookup', () => {
  beforeEach(() => {
    vi.resetModules()
    selectResults.length = 0
    vi.clearAllMocks()
  })

  it('returns validation error for invalid canvas user id', async () => {
    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/users/invalid-id')
    )
    const { GET } = await import('@/app/api/integrations/canvas/users/[canvasUserId]/route')
    const response = await GET(request, {
      params: Promise.resolve({ canvasUserId: 'invalid-id' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid canvas user id')
  })

  it('returns not provisioned when link is missing', async () => {
    selectResults.push([])

    const request = new NextRequest(
      new URL(
        'http://localhost:3000/api/integrations/canvas/users/11111111-1111-1111-1111-111111111111'
      )
    )
    const { GET } = await import('@/app/api/integrations/canvas/users/[canvasUserId]/route')
    const response = await GET(request, {
      params: Promise.resolve({ canvasUserId: '11111111-1111-1111-1111-111111111111' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.code).toBe('USER_NOT_PROVISIONED')
  })

  it('returns linked user details', async () => {
    selectResults.push([
      {
        account: {
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
        },
        user: {
          id: '33333333-3333-3333-3333-333333333333',
          email: 'test@example.com',
          name: 'Test User',
        },
      },
    ])
    selectResults.push([{ id: '44444444-4444-4444-4444-444444444444' }])

    const request = new NextRequest(
      new URL(
        'http://localhost:3000/api/integrations/canvas/users/11111111-1111-1111-1111-111111111111'
      )
    )
    const { GET } = await import('@/app/api/integrations/canvas/users/[canvasUserId]/route')
    const response = await GET(request, {
      params: Promise.resolve({ canvasUserId: '11111111-1111-1111-1111-111111111111' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.simUserId).toBe('33333333-3333-3333-3333-333333333333')
    expect(data.data.simWorkspaceId).toBe('44444444-4444-4444-4444-444444444444')
  })
})
