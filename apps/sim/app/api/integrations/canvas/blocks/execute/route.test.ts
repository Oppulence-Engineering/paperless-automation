/**
 * @vitest-environment node
 *
 * Canvas block execution route tests.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockConfig } from '@/blocks/types'

const mockGetBlock = vi.fn()
const mockGetBlockByToolName = vi.fn()
const mockExecuteTool = vi.fn()
const mockRedactApiKeys = vi.fn((value: Record<string, unknown>) => value)

const selectResults: Array<any[]> = []

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  })),
}

const mockContext = {
  serviceName: 'canvas',
  keyId: 'key-id',
  keyPrefix: 'sim_svc_',
  scopes: ['blocks:execute'],
  rateLimitPerMinute: null,
  rateLimitPerDay: null,
  metadata: {},
  canvasUserId: '11111111-1111-1111-1111-111111111111',
  canvasWorkspaceId: '22222222-2222-2222-2222-222222222222',
  requestId: 'req-id',
  idempotencyKey: 'idem-key',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
}

vi.mock('@/blocks', () => ({
  getBlock: mockGetBlock,
  getBlockByToolName: mockGetBlockByToolName,
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

vi.mock('@/lib/core/security/redaction', () => ({
  redactApiKeys: mockRedactApiKeys,
}))

vi.mock('../../middleware', () => ({
  withCanvasAuth: (handler: any) => async (request: NextRequest) =>
    handler(request, mockContext),
}))

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

vi.mock('@sim/db/schema', () => ({
  account: {
    accountId: 'account_id',
    providerId: 'provider_id',
    userId: 'user_id',
  },
  workspace: {
    id: 'id',
    ownerId: 'owner_id',
  },
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
  and: (...args: any[]) => args,
  eq: (...args: any[]) => args,
}))

const buildBlock = (): BlockConfig => ({
  type: 'gmail',
  name: 'Gmail',
  description: 'Send email via Gmail',
  category: 'blocks',
  bgColor: '#111111',
  icon: () => ({} as JSX.Element),
  subBlocks: [
    {
      id: 'to',
      type: 'short_text',
      required: true,
    },
  ],
  tools: {
    access: ['gmail_send'],
  },
  inputs: {
    to: {
      type: 'short_text',
      description: 'Recipient',
    },
  },
  outputs: {
    messageId: 'string',
  },
  authMode: 'oauth',
})

describe('Canvas block execute', () => {
  beforeEach(() => {
    vi.resetModules()
    selectResults.length = 0
    mockGetBlock.mockReset()
    mockGetBlockByToolName.mockReset()
    mockExecuteTool.mockReset()
    mockRedactApiKeys.mockClear()
  })

  it('rejects missing params', async () => {
    mockGetBlock.mockReturnValue(buildBlock())
    mockGetBlockByToolName.mockReturnValue(null)

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/blocks/execute'),
      {
        method: 'POST',
        body: JSON.stringify({ blockType: 'gmail' }),
        headers: new Headers({ 'content-type': 'application/json' }),
      }
    )

    const { POST } = await import('@/app/api/integrations/canvas/blocks/execute/route')
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.code).toBe('INVALID_PARAMS')
  })

  it('returns error when Canvas user is not provisioned', async () => {
    mockGetBlock.mockReturnValue(buildBlock())
    mockGetBlockByToolName.mockReturnValue(null)
    selectResults.push([])
    selectResults.push([])

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/blocks/execute'),
      {
        method: 'POST',
        body: JSON.stringify({
          blockType: 'gmail',
          params: { to: 'test@example.com' },
        }),
        headers: new Headers({ 'content-type': 'application/json' }),
      }
    )

    const { POST } = await import('@/app/api/integrations/canvas/blocks/execute/route')
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.code).toBe('USER_NOT_PROVISIONED')
  })

  it('returns completed execution response', async () => {
    mockGetBlock.mockReturnValue(buildBlock())
    mockGetBlockByToolName.mockReturnValue(null)
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { messageId: 'msg-1' },
    })
    selectResults.push([])
    selectResults.push([{ userId: 'sim-user-id' }])
    selectResults.push([{ id: 'workspace-id' }])

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/blocks/execute'),
      {
        method: 'POST',
        body: JSON.stringify({
          blockType: 'gmail',
          params: { to: 'test@example.com' },
          context: {
            workflowId: '33333333-3333-3333-3333-333333333333',
            executionId: '44444444-4444-4444-4444-444444444444',
          },
        }),
        headers: new Headers({ 'content-type': 'application/json' }),
      }
    )

    const { POST } = await import('@/app/api/integrations/canvas/blocks/execute/route')
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.status).toBe('completed')
    expect(mockExecuteTool).toHaveBeenCalled()
  })
})
