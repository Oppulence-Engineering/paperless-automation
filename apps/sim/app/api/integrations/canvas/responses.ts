/**
 * Canvas Integration API Response Helpers
 *
 * Consistent response formatting for all Canvas integration API endpoints.
 */

import { NextResponse } from 'next/server'
import type { CanvasApiError, CanvasApiSuccess, PaginationMeta } from './types'

/**
 * Create a successful list response with pagination
 */
export function listResponse<T>(
  data: T[],
  pagination: PaginationMeta
): NextResponse<CanvasApiSuccess<{ items: T[]; pagination: PaginationMeta }>> {
  return NextResponse.json({ success: true, data: { items: data, pagination } })
}

/**
 * Create a successful single resource response
 */
export function singleResponse<T>(
  data: T,
  status = 200
): NextResponse<CanvasApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status })
}

/**
 * Create an error response
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown,
  retryAfter?: number
): NextResponse<CanvasApiError> {
  const body: CanvasApiError = {
    error: message,
    ...(code ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
  }

  return NextResponse.json(body, { status })
}

/**
 * Authentication required error (401)
 */
export function unauthorizedResponse(message = 'Authentication required'): NextResponse {
  return errorResponse('UNAUTHORIZED', message, 401)
}

/**
 * Permission denied error (403)
 */
export function forbiddenResponse(message = 'Access denied'): NextResponse {
  return errorResponse('FORBIDDEN', message, 403)
}

/**
 * Insufficient scope error (403)
 */
export function insufficientScopeResponse(requiredScopes: string[]): NextResponse {
  return errorResponse(
    'INSUFFICIENT_SCOPE',
    `Insufficient permissions. Required scopes: ${requiredScopes.join(', ')}`,
    403,
    { requiredScopes }
  )
}

/**
 * Resource not found error (404)
 */
export function notFoundResponse(resource: string): NextResponse {
  return errorResponse('NOT_FOUND', `${resource} not found`, 404)
}

/**
 * Bad request error (400)
 */
export function badRequestResponse(message: string, details?: unknown): NextResponse {
  return errorResponse('INVALID_PARAMS', message, 400, details)
}

/**
 * Validation error (400)
 */
export function validationErrorResponse(errors: Record<string, string[]>): NextResponse {
  return errorResponse('INVALID_PARAMS', 'Request validation failed', 400, { errors })
}

/**
 * Rate limit exceeded error (429)
 */
export function rateLimitResponse(retryAfter?: number): NextResponse {
  const response = errorResponse(
    'RATE_LIMITED',
    'Rate limit exceeded',
    429,
    undefined,
    retryAfter
  )
  if (retryAfter) {
    response.headers.set('Retry-After', retryAfter.toString())
  }
  return response
}

/**
 * Internal server error (500)
 */
export function internalErrorResponse(message = 'Internal server error'): NextResponse {
  return errorResponse('INTERNAL_ERROR', message, 500)
}

/**
 * Service unavailable error (503)
 */
export function serviceUnavailableResponse(message = 'Service temporarily unavailable'): NextResponse {
  return errorResponse('SERVICE_UNAVAILABLE', message, 503)
}

/**
 * Block execution error (422)
 */
export function executionErrorResponse(message: string, details?: unknown): NextResponse {
  return errorResponse('EXECUTION_ERROR', message, 422, details)
}

/**
 * Block not found error (404)
 */
export function blockNotFoundResponse(blockType: string): NextResponse {
  return errorResponse('BLOCK_NOT_FOUND', `Block type '${blockType}' not found`, 404)
}

/**
 * User already exists response (409)
 */
export function userExistsResponse(message = 'User already exists'): NextResponse {
  return errorResponse('USER_EXISTS', message, 409)
}
