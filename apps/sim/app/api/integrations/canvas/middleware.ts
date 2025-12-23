/**
 * Canvas Integration Middleware
 *
 * Higher-order functions that wrap route handlers with Canvas service authentication.
 * Follows the established pattern from the admin API middleware.
 *
 * Usage:
 *   export const POST = withCanvasAuth(
 *     async (request, context) => { ... },
 *     ['blocks:execute']
 *   )
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateCanvasRequest } from './auth'
import {
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  insufficientScopeResponse,
  internalErrorResponse,
  rateLimitResponse,
} from './responses'
import type { CanvasRequestContext, CanvasScope } from './types'
import { canvasRequestContextSchema, canvasScopeSchema } from './types'
import { enforceCanvasRateLimit } from './rate-limit'

const CANVAS_IP_ALLOWLIST = parseAllowlist(process.env.CANVAS_IP_ALLOWLIST)

/**
 * Route handler function signature for Canvas authenticated routes
 */
export type CanvasRouteHandler = (
  request: NextRequest,
  context: CanvasRequestContext
) => Promise<Response>

/**
 * Route handler function signature for Canvas authenticated routes with URL params
 */
export type CanvasRouteHandlerWithParams<P = Record<string, string>> = (
  request: NextRequest,
  context: CanvasRequestContext,
  params: P
) => Promise<Response>

const canvasAuthOptionsSchema = z
  .object({
    scopes: z.array(canvasScopeSchema).optional(),
    requireUserContext: z.boolean().optional(),
    requireWorkspaceContext: z.boolean().optional(),
  })
  .strict()

type CanvasAuthOptions = z.infer<typeof canvasAuthOptionsSchema>

/**
 * Wrap a route handler with Canvas service authentication.
 *
 * @param handler - The route handler to protect
 * @param requiredScopes - Optional scopes required for this endpoint
 * @returns A wrapped handler that authenticates before executing
 *
 * @example
 * export const POST = withCanvasAuth(
 *   async (request, context) => {
 *     // context.serviceName, context.keyId, context.scopes available
 *     return singleResponse({ success: true })
 *   },
 *   ['blocks:execute']
 * )
 */
export function withCanvasAuth(
  handler: CanvasRouteHandler,
  requiredScopes?: CanvasScope[] | CanvasAuthOptions
): (request: NextRequest) => Promise<Response> {
  return async (request: NextRequest) => {
    const options: CanvasAuthOptions = Array.isArray(requiredScopes)
      ? { scopes: requiredScopes }
      : requiredScopes ?? {}
    const auth = await authenticateCanvasRequest(request, options.scopes)

    if (!auth.authenticated) {
      return mapAuthErrorToResponse(auth.code, auth.error, options.scopes)
    }

    const contextResult = canvasRequestContextSchema.safeParse(
      buildRequestContext(request, auth.context)
    )

    if (!contextResult.success) {
      const errors = contextResult.error.flatten().fieldErrors
      return badRequestResponse('Invalid request headers', errors)
    }

    const requestContext = contextResult.data

    if (!isIpAllowed(requestContext.ipAddress)) {
      return forbiddenResponse('IP address not allowed')
    }

    if (options.requireUserContext && !requestContext.canvasUserId) {
      return badRequestResponse('Missing X-Canvas-User-Id header')
    }

    if (options.requireWorkspaceContext && !requestContext.canvasWorkspaceId) {
      return badRequestResponse('Missing X-Canvas-Workspace-Id header')
    }

    const rateLimitResult = await enforceCanvasRateLimit(requestContext)
    if (!rateLimitResult.allowed) {
      const retryAfterSeconds = rateLimitResult.retryAfterMs
        ? Math.ceil(rateLimitResult.retryAfterMs / 1000)
        : undefined
      return rateLimitResponse(retryAfterSeconds)
    }

    return handler(request, requestContext)
  }
}

/**
 * Wrap a route handler with Canvas service authentication, supporting URL params.
 *
 * @param handler - The route handler to protect
 * @param requiredScopes - Optional scopes required for this endpoint
 * @returns A wrapped handler that authenticates before executing
 *
 * @example
 * export const GET = withCanvasAuthParams<{ id: string }>(
 *   async (request, context, params) => {
 *     const { id } = params
 *     return singleResponse({ id, ...data })
 *   },
 *   ['users:read']
 * )
 */
export function withCanvasAuthParams<P extends Record<string, string> = Record<string, string>>(
  handler: CanvasRouteHandlerWithParams<P>,
  requiredScopes?: CanvasScope[] | CanvasAuthOptions
): (request: NextRequest, context: { params: Promise<P> }) => Promise<Response> {
  return async (request: NextRequest, routeContext: { params: Promise<P> }) => {
    const options: CanvasAuthOptions = Array.isArray(requiredScopes)
      ? { scopes: requiredScopes }
      : requiredScopes ?? {}
    const auth = await authenticateCanvasRequest(request, options.scopes)

    if (!auth.authenticated) {
      return mapAuthErrorToResponse(auth.code, auth.error, options.scopes)
    }

    const contextResult = canvasRequestContextSchema.safeParse(
      buildRequestContext(request, auth.context)
    )

    if (!contextResult.success) {
      const errors = contextResult.error.flatten().fieldErrors
      return badRequestResponse('Invalid request headers', errors)
    }

    const requestContext = contextResult.data

    if (!isIpAllowed(requestContext.ipAddress)) {
      return forbiddenResponse('IP address not allowed')
    }

    if (options.requireUserContext && !requestContext.canvasUserId) {
      return badRequestResponse('Missing X-Canvas-User-Id header')
    }

    if (options.requireWorkspaceContext && !requestContext.canvasWorkspaceId) {
      return badRequestResponse('Missing X-Canvas-Workspace-Id header')
    }

    const rateLimitResult = await enforceCanvasRateLimit(requestContext)
    if (!rateLimitResult.allowed) {
      const retryAfterSeconds = rateLimitResult.retryAfterMs
        ? Math.ceil(rateLimitResult.retryAfterMs / 1000)
        : undefined
      return rateLimitResponse(retryAfterSeconds)
    }

    const params = await routeContext.params
    return handler(request, requestContext, params)
  }
}

/**
 * Map authentication error codes to appropriate HTTP responses.
 */
function mapAuthErrorToResponse(
  code: string,
  message: string,
  requiredScopes?: CanvasScope[]
): Response {
  switch (code) {
    case 'MISSING_KEY':
    case 'INVALID_KEY':
    case 'EXPIRED_KEY':
    case 'INACTIVE_KEY':
      return unauthorizedResponse(message)

    case 'INSUFFICIENT_SCOPE':
      return requiredScopes
        ? insufficientScopeResponse(requiredScopes)
        : forbiddenResponse(message)

    case 'INTERNAL_ERROR':
      return internalErrorResponse(message)

    default:
      return unauthorizedResponse(message)
  }
}

function buildRequestContext(
  request: NextRequest,
  context: CanvasRequestContext
): CanvasRequestContext {
  return {
    ...context,
    canvasUserId: request.headers.get('x-canvas-user-id') ?? undefined,
    canvasWorkspaceId: request.headers.get('x-canvas-workspace-id') ?? undefined,
    requestId: request.headers.get('x-request-id') ?? undefined,
    idempotencyKey: request.headers.get('x-idempotency-key') ?? undefined,
    ipAddress: getRequestIp(request),
    userAgent: request.headers.get('user-agent') ?? undefined,
  }
}

function parseAllowlist(value?: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function getRequestIp(request: NextRequest): string | undefined {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const [ip] = forwardedFor.split(',')
    if (ip) return ip.trim()
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  return request.ip ?? undefined
}

function isIpAllowed(ipAddress?: string): boolean {
  if (CANVAS_IP_ALLOWLIST.length === 0) return true
  if (!ipAddress) return false
  return CANVAS_IP_ALLOWLIST.includes(ipAddress)
}
