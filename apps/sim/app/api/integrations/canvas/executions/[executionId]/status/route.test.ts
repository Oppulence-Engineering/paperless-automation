/**
 * @vitest-environment node
 *
 * Canvas execution status route tests.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectResults: Array<any[]> = []

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
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
  scopes: ['executions:read'],
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

vi.mock('../../../middleware', () => ({
  withCanvasAuthParams: (handler: any) => async (
    request: NextRequest,
    routeContext: { params: Promise<{ executionId: string }> }
  ) => {
    const params = await routeContext.params
    return handler(request, mockContext, params)
  },
}))

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

vi.mock('@sim/db/schema', () => ({
  workflowExecutionLogs: {
    executionId: 'execution_id',
    startedAt: 'started_at',
    endedAt: 'ended_at',
    totalDurationMs: 'total_duration_ms',
    level: 'level',
    executionData: 'execution_data',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (...args: any[]) => args,
}))

describe('Canvas execution status', () => {
  beforeEach(() => {
    vi.resetModules()
    selectResults.length = 0
    vi.clearAllMocks()
  })

  it('returns running status when execution is in progress', async () => {
    selectResults.push([
      {
        executionId: 'exec-1',
        startedAt: new Date('2024-01-01T00:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        level: 'info',
        executionData: {
          request: { blockType: 'gmail' },
          progress: 0.4,
        },
      },
    ])

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/executions/exec-1/status')
    )
    const { GET } = await import(
      '@/app/api/integrations/canvas/executions/[executionId]/status/route'
    )
    const response = await GET(request, {
      params: Promise.resolve({ executionId: 'exec-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.status).toBe('running')
  })

  it('returns completed status when execution finished', async () => {
    selectResults.push([
      {
        executionId: 'exec-2',
        startedAt: new Date('2024-01-01T00:00:00.000Z'),
        endedAt: new Date('2024-01-01T00:00:01.000Z'),
        totalDurationMs: 1000,
        level: 'info',
        executionData: {
          request: { blockType: 'gmail' },
          response: { output: { messageId: 'msg-1' } },
        },
      },
    ])

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/executions/exec-2/status')
    )
    const { GET } = await import(
      '@/app/api/integrations/canvas/executions/[executionId]/status/route'
    )
    const response = await GET(request, {
      params: Promise.resolve({ executionId: 'exec-2' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.status).toBe('completed')
  })
})
