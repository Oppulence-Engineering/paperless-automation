/**
 * @vitest-environment node
 *
 * Canvas blocks listing route tests.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockConfig } from '@/blocks/types'

const mockGetAllBlocks = vi.fn()

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
  getAllBlocks: mockGetAllBlocks,
}))

vi.mock('../middleware', () => ({
  withCanvasAuth: (handler: any) => async (request: NextRequest) =>
    handler(request, mockContext),
}))

const buildBlock = (params: {
  type: string
  name: string
  description: string
  authMode?: 'oauth' | 'api_key' | 'bot_token'
}): BlockConfig => ({
  type: params.type,
  name: params.name,
  description: params.description,
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
    access: [`${params.type}_tool`],
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
  authMode: params.authMode,
})

describe('Canvas blocks listing', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetAllBlocks.mockReset()
  })

  it('returns block capabilities', async () => {
    mockGetAllBlocks.mockReturnValue([
      buildBlock({
        type: 'gmail',
        name: 'Gmail',
        description: 'Send email via Gmail',
        authMode: 'oauth',
      }),
      buildBlock({
        type: 'slack',
        name: 'Slack',
        description: 'Send Slack message',
        authMode: 'bot_token',
      }),
    ])

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/blocks')
    )
    const { GET } = await import('@/app/api/integrations/canvas/blocks/route')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.blocks).toHaveLength(2)
    expect(data.data.blocks[0]).toHaveProperty('type')
  })

  it('filters by category and search term', async () => {
    mockGetAllBlocks.mockReturnValue([
      buildBlock({
        type: 'gmail',
        name: 'Gmail',
        description: 'Send email via Gmail',
        authMode: 'oauth',
      }),
      buildBlock({
        type: 'slack',
        name: 'Slack',
        description: 'Send Slack message',
        authMode: 'bot_token',
      }),
    ])

    const request = new NextRequest(
      new URL('http://localhost:3000/api/integrations/canvas/blocks?category=email&search=gmail')
    )
    const { GET } = await import('@/app/api/integrations/canvas/blocks/route')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.blocks).toHaveLength(1)
    expect(data.data.blocks[0].type).toBe('gmail')
  })
})
