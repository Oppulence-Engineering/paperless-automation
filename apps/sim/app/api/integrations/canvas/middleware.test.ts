/**
 * @vitest-environment node
 *
 * Canvas middleware tests.
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthenticate = vi.fn()
const mockRateLimit = vi.fn()

vi.mock('./auth', () => ({
  authenticateCanvasRequest: (...args: any[]) => mockAuthenticate(...args),
}))

vi.mock('./rate-limit', () => ({
  enforceCanvasRateLimit: (...args: any[]) => mockRateLimit(...args),
}))

const buildAuthContext = () => ({
  serviceName: 'canvas',
  keyId: 'key-id',
  keyPrefix: 'sim_svc_',
  scopes: ['blocks:execute'],
  rateLimitPerMinute: null,
  rateLimitPerDay: null,
  metadata: {},
})

const buildRequest = (headers?: Headers) =>
  new NextRequest(new URL('http://localhost:3000/api/integrations/canvas/test'), { headers })

const originalAllowlist = process.env.CANVAS_IP_ALLOWLIST

describe('withCanvasAuth', () => {
  beforeEach(() => {
    vi.resetModules()
    mockAuthenticate.mockReset()
    mockRateLimit.mockReset()
    process.env.CANVAS_IP_ALLOWLIST = ''
  })

  afterEach(() => {
    process.env.CANVAS_IP_ALLOWLIST = originalAllowlist
  })

  it('rejects invalid Canvas user header', async () => {
    mockAuthenticate.mockResolvedValue({
      authenticated: true,
      context: buildAuthContext(),
    })
    mockRateLimit.mockResolvedValue({ allowed: true })

    const { withCanvasAuth } = await import('./middleware')
    const handler = vi.fn(async () => new Response(null, { status: 204 }))
    const wrapped = withCanvasAuth(handler, { requireUserContext: true })

    const request = buildRequest(new Headers({ 'x-canvas-user-id': 'not-a-uuid' }))
    const response = await wrapped(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request headers')
    expect(handler).not.toHaveBeenCalled()
  })

  it('blocks requests from non-allowlisted IPs', async () => {
    process.env.CANVAS_IP_ALLOWLIST = '10.0.0.1'

    mockAuthenticate.mockResolvedValue({
      authenticated: true,
      context: buildAuthContext(),
    })
    mockRateLimit.mockResolvedValue({ allowed: true })

    const { withCanvasAuth } = await import('./middleware')
    const handler = vi.fn(async () => new Response(null, { status: 204 }))
    const wrapped = withCanvasAuth(handler)

    const request = buildRequest(new Headers({ 'x-forwarded-for': '127.0.0.1' }))
    const response = await wrapped(request)

    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns rate limit response when limits exceeded', async () => {
    mockAuthenticate.mockResolvedValue({
      authenticated: true,
      context: buildAuthContext(),
    })
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 120000 })

    const { withCanvasAuth } = await import('./middleware')
    const handler = vi.fn(async () => new Response(null, { status: 204 }))
    const wrapped = withCanvasAuth(handler)

    const request = buildRequest()
    const response = await wrapped(request)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes through when authenticated and allowed', async () => {
    mockAuthenticate.mockResolvedValue({
      authenticated: true,
      context: buildAuthContext(),
    })
    mockRateLimit.mockResolvedValue({ allowed: true })

    const { withCanvasAuth } = await import('./middleware')
    const handler = vi.fn(async () => new Response(null, { status: 204 }))
    const wrapped = withCanvasAuth(handler)

    const request = buildRequest()
    const response = await wrapped(request)

    expect(response.status).toBe(204)
    expect(handler).toHaveBeenCalled()
  })
})
