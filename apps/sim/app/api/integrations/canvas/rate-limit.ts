import { z } from 'zod'
import { createStorageAdapter, type TokenBucketConfig } from '@/lib/core/rate-limiter/storage'
import { createLogger } from '@/lib/logs/console/logger'
import type { CanvasRequestContext } from './types'

const logger = createLogger('CanvasRateLimit')
const storage = createStorageAdapter()

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const rateLimitCheckResultSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterMs: z.number().optional(),
  })
  .strict()

type RateLimitCheckResult = z.infer<typeof rateLimitCheckResultSchema>

function buildConfig(limit: number, intervalMs: number): TokenBucketConfig {
  return {
    maxTokens: limit,
    refillRate: limit,
    refillIntervalMs: intervalMs,
  }
}

async function consume(key: string, limit: number, intervalMs: number): Promise<RateLimitCheckResult> {
  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: true }
  }

  const result = await storage.consumeTokens(key, 1, buildConfig(limit, intervalMs))
  if (result.allowed) {
    return { allowed: true }
  }

  return { allowed: false, retryAfterMs: result.retryAfterMs }
}

export async function enforceCanvasRateLimit(
  context: CanvasRequestContext
): Promise<RateLimitCheckResult> {
  try {
    const serviceKey = `svc:${context.serviceName}:${context.keyPrefix}`
    const userKey = context.canvasUserId
      ? `svc:${context.serviceName}:${context.keyPrefix}:user:${context.canvasUserId}`
      : null

    const perMinute = context.rateLimitPerMinute ?? 1000
    const perDay = context.rateLimitPerDay ?? 100000

    const serviceMinute = await consume(serviceKey, perMinute, MINUTE_MS)
    if (!serviceMinute.allowed) {
      return serviceMinute
    }

    const serviceDay = await consume(`${serviceKey}:day`, perDay, DAY_MS)
    if (!serviceDay.allowed) {
      return serviceDay
    }

    if (userKey) {
      const userMinute = await consume(userKey, perMinute, MINUTE_MS)
      if (!userMinute.allowed) {
        return userMinute
      }

      const userDay = await consume(`${userKey}:day`, perDay, DAY_MS)
      if (!userDay.allowed) {
        return userDay
      }
    }

    return { allowed: true }
  } catch (error) {
    logger.error('Rate limit check failed', { error })
    return { allowed: false, retryAfterMs: MINUTE_MS }
  }
}
