/**
 * @vitest-environment node
 *
 * Canvas user provisioning route tests.
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
  insert: vi.fn(() => ({
    values: vi.fn(() => Promise.resolve()),
  })),
  transaction: vi.fn(async (callback: (tx: any) => Promise<void>) => {
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
    }
    await callback(tx)
  }),
}

const mockContext = {
  serviceName: 'canvas',
  keyId: 'key-id',
  keyPrefix: 'sim_svc_',
  scopes: ['users:provision'],
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
  withCanvasAuth: (handler: any) => async (request: NextRequest) =>
    handler(request, mockContext),
}))

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

vi.mock('@sim/db/schema', () => ({
  account: {
    id: 'id',
    accountId: 'account_id',
    providerId: 'provider_id',
    userId: 'user_id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  user: {
    id: 'id',
    email: 'email',
  },
  userStats: {
    id: 'id',
  },
  workflow: {
    id: 'id',
  },
  workspace: {
    id: 'id',
  },
  permissions: {
    id: 'id',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: any[]) => args,
  eq: (...args: any[]) => args,
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: () => ({ workflowState: {} }),
}))

const mockSaveWorkflow = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: (...args: any[]) => mockSaveWorkflow(...args),
}))

describe('Canvas user provisioning', () => {
  beforeEach(() => {
    vi.resetModules()
    selectResults.length = 0
    vi.clearAllMocks()
  })

  it('returns validation error for invalid payload', async () => {
    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/users/provision'),
      {
        method: 'POST',
        body: JSON.stringify({
          canvasUserId: 'not-a-uuid',
          email: 'invalid-email',
        }),
        headers: new Headers({ 'content-type': 'application/json' }),
      }
    )

    const { POST } = await import('@/app/api/integrations/canvas/users/provision/route')
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns existing link when Canvas user already provisioned', async () => {
    selectResults.push([
      {
        linkId: 'link-id',
        userId: 'sim-user-id',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        email: 'existing@example.com',
      },
    ])

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/users/provision'),
      {
        method: 'POST',
        body: JSON.stringify({
          canvasUserId: '11111111-1111-1111-1111-111111111111',
          email: 'existing@example.com',
          name: 'Existing User',
        }),
        headers: new Headers({ 'content-type': 'application/json' }),
      }
    )

    const { POST } = await import('@/app/api/integrations/canvas/users/provision/route')
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.success).toBe(true)
    expect(data.data.alreadyExisted).toBe(true)
    expect(data.data.canvasUserId).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('creates a new Sim user when not found', async () => {
    selectResults.push([])
    selectResults.push([])

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/users/provision'),
      {
        method: 'POST',
        body: JSON.stringify({
          canvasUserId: '11111111-1111-1111-1111-111111111111',
          email: 'new@example.com',
          name: 'New User',
        }),
        headers: new Headers({ 'content-type': 'application/json' }),
      }
    )

    const { POST } = await import('@/app/api/integrations/canvas/users/provision/route')
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.success).toBe(true)
    expect(data.data.simUserId).toBeDefined()
    expect(mockSaveWorkflow).toHaveBeenCalled()
    expect(mockDb.transaction).toHaveBeenCalled()
  })
})
