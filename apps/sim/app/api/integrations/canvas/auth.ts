/**
 * Canvas Service Authentication
 *
 * Authenticates Canvas service-to-service API requests using service API keys
 * stored in the database. Keys are validated via SHA-256 hash comparison.
 *
 * Usage:
 *   curl -H "x-service-key: sim_svc_your_key_here" https://your-instance/api/integrations/canvas/...
 */

import { createHash, randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'
import { db } from '@sim/db'
import { serviceApiKey } from '@sim/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import type { CanvasScope, ServiceContext } from './types'
import { serviceContextSchema } from './types'

const logger = createLogger('CanvasAuth')

/**
 * Service key prefix for identification
 */
export const SERVICE_KEY_PREFIX = 'sim_svc_'
const SERVICE_KEY_PREFIX_LENGTH = 16

/**
 * Canvas service identifier
 */
export const CANVAS_SERVICE_ID = 'canvas'

export const canvasAuthFailureCodeSchema = z.enum([
  'MISSING_KEY',
  'INVALID_KEY',
  'EXPIRED_KEY',
  'INACTIVE_KEY',
  'INSUFFICIENT_SCOPE',
  'INTERNAL_ERROR',
])

export const canvasAuthSuccessSchema = z
  .object({
    authenticated: z.literal(true),
    context: serviceContextSchema,
  })
  .strict()

export const canvasAuthFailureSchema = z
  .object({
    authenticated: z.literal(false),
    error: z.string(),
    code: canvasAuthFailureCodeSchema,
  })
  .strict()

export const canvasAuthResultSchema = z.union([canvasAuthSuccessSchema, canvasAuthFailureSchema])

export type CanvasAuthSuccess = z.infer<typeof canvasAuthSuccessSchema>
export type CanvasAuthFailure = z.infer<typeof canvasAuthFailureSchema>
export type CanvasAuthResult = z.infer<typeof canvasAuthResultSchema>

/**
 * Authenticate a Canvas service API request.
 *
 * @param request - The incoming Next.js request
 * @param requiredScopes - Optional scopes required for this endpoint
 * @returns Authentication result with service context on success
 */
export async function authenticateCanvasRequest(
  request: NextRequest,
  requiredScopes?: CanvasScope[]
): Promise<CanvasAuthResult> {
  const providedKey = request.headers.get('x-service-key')

  if (!providedKey) {
    return {
      authenticated: false,
      error: 'Service API key required. Provide x-service-key header.',
      code: 'MISSING_KEY',
    }
  }

  if (!providedKey.startsWith(SERVICE_KEY_PREFIX)) {
    logger.warn('Invalid service key format attempted', { keyPrefix: getServiceKeyPrefix(providedKey) })
    return {
      authenticated: false,
      error: 'Invalid service API key format',
      code: 'INVALID_KEY',
    }
  }

  try {
    const keyHash = hashKey(providedKey)

    const [keyRecord] = await db
      .select()
      .from(serviceApiKey)
      .where(
        and(
          eq(serviceApiKey.keyHash, keyHash),
          eq(serviceApiKey.serviceName, CANVAS_SERVICE_ID)
        )
      )
      .limit(1)

    if (!keyRecord) {
      logger.warn('Service key not found', { keyPrefix: getServiceKeyPrefix(providedKey) })
      return {
        authenticated: false,
        error: 'Invalid service API key',
        code: 'INVALID_KEY',
      }
    }

    if (!keyRecord.isActive) {
      logger.warn('Inactive service key used', { keyPrefix: keyRecord.keyPrefix })
      return {
        authenticated: false,
        error: 'Service API key is inactive',
        code: 'INACTIVE_KEY',
      }
    }

    if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
      logger.warn('Expired service key used', { keyPrefix: keyRecord.keyPrefix })
      return {
        authenticated: false,
        error: 'Service API key has expired',
        code: 'EXPIRED_KEY',
      }
    }

    const keyScopes = parseScopes(keyRecord.permissions)

    if (requiredScopes && requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every((scope) => keyScopes.includes(scope))
      if (!hasAllScopes) {
        logger.warn('Insufficient scopes', {
          keyId: keyRecord.id,
          required: requiredScopes,
          available: keyScopes,
        })
        return {
          authenticated: false,
          error: `Insufficient permissions. Required scopes: ${requiredScopes.join(', ')}`,
          code: 'INSUFFICIENT_SCOPE',
        }
      }
    }

    // Update last used timestamp asynchronously (fire and forget)
    updateLastUsed(keyRecord.id).catch((err) => {
      logger.error('Failed to update last used timestamp', { error: err })
    })

    return {
      authenticated: true,
      context: {
        serviceName: keyRecord.serviceName,
        keyId: keyRecord.id,
        keyPrefix: keyRecord.keyPrefix,
        scopes: keyScopes,
        rateLimitPerMinute: keyRecord.rateLimitPerMinute ?? undefined,
        rateLimitPerDay: keyRecord.rateLimitPerDay ?? undefined,
        metadata: (keyRecord.metadata as Record<string, unknown>) ?? {},
      },
    }
  } catch (error) {
    logger.error('Canvas authentication error', { error })
    return {
      authenticated: false,
      error: 'Authentication service error',
      code: 'INTERNAL_ERROR',
    }
  }
}

/**
 * Hash a service API key using SHA-256.
 */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Generate a new service API key with the standard prefix.
 */
export function generateServiceKey(): string {
  return `${SERVICE_KEY_PREFIX}${randomBytes(32).toString('hex')}`
}

/**
 * Extract a short prefix used to identify a service key in logs.
 */
export function getServiceKeyPrefix(key: string): string {
  return key.slice(0, SERVICE_KEY_PREFIX_LENGTH)
}

/**
 * Parse scopes from database JSON format.
 */
function parseScopes(scopes: unknown): CanvasScope[] {
  if (Array.isArray(scopes)) {
    return scopes.filter((s): s is CanvasScope => typeof s === 'string')
  }
  if (typeof scopes === 'string') {
    try {
      const parsed = JSON.parse(scopes)
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is CanvasScope => typeof s === 'string')
      }
    } catch {
      // Invalid JSON, return empty
    }
  }
  return []
}

/**
 * Update the last used timestamp for a service key.
 */
async function updateLastUsed(keyId: string): Promise<void> {
  await db
    .update(serviceApiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(serviceApiKey.id, keyId))
}

/**
 * Check if a service context has the required scope.
 */
export function hasScope(context: ServiceContext, scope: CanvasScope): boolean {
  return context.scopes.includes(scope)
}

/**
 * Check if a service context has all required scopes.
 */
export function hasAllScopes(context: ServiceContext, scopes: CanvasScope[]): boolean {
  return scopes.every((scope) => context.scopes.includes(scope))
}

/**
 * Check if a service context has any of the specified scopes.
 */
export function hasAnyScope(context: ServiceContext, scopes: CanvasScope[]): boolean {
  return scopes.some((scope) => context.scopes.includes(scope))
}
