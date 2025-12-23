/**
 * @vitest-environment node
 *
 * Canvas block schema route tests.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockConfig } from '@/blocks/types'

const mockGetBlock = vi.fn()
const mockGetBlockByToolName = vi.fn()

const mockContext = {
  serviceName: 'canvas',
  keyId: 'key-id',
  keyPrefix: 'sim_svc_',
  scopes: ['blocks:list'],
  rateLimitPerMinute: null,
  rateLimitPerDay: null,
  metadata: {},
  canvasUserId: undefined,
  canvasWorkspaceId: undefined,
  requestId: 'req-id',
  idempotencyKey: undefined,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
}

vi.mock('@/blocks', () => ({
  getBlock: mockGetBlock,
  getBlockByToolName: mockGetBlockByToolName,
}))

vi.mock('../../../middleware', () => ({
  withCanvasAuthParams: (handler: any) => async (
    request: NextRequest,
    routeContext: { params: Promise<{ type: string }> }
  ) => {
    const params = await routeContext.params
    return handler(request, mockContext, params)
  },
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
    access: ['gmail_tool'],
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

describe('Canvas block schema', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetBlock.mockReset()
    mockGetBlockByToolName.mockReset()
  })

  it('returns schema for known block type', async () => {
    mockGetBlock.mockReturnValue(buildBlock())
    mockGetBlockByToolName.mockReturnValue(null)

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/blocks/gmail/schema')
    )
    const { GET } = await import('@/app/api/integrations/canvas/blocks/[type]/schema/route')
    const response = await GET(request, {
      params: Promise.resolve({ type: 'gmail' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.type).toBe('gmail')
    expect(data.data).toHaveProperty('inputSchema')
  })

  it('returns error for unknown block type', async () => {
    mockGetBlock.mockReturnValue(null)
    mockGetBlockByToolName.mockReturnValue(null)

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/blocks/unknown/schema')
    )
    const { GET } = await import('@/app/api/integrations/canvas/blocks/[type]/schema/route')
    const response = await GET(request, {
      params: Promise.resolve({ type: 'unknown' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Unknown block type')
    expect(data.code).toBe('INVALID_BLOCK_TYPE')
  })
})
