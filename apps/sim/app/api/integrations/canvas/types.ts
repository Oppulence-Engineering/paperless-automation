/**
 * Canvas Integration API Types
 *
 * Defines Zod schemas for Canvas service-to-service authentication
 * and API responses for the Canvas integration endpoints.
 */

import { z } from 'zod'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100

/**
 * Available scopes for Canvas service API keys
 */
export const canvasScopeSchema = z.enum([
  'blocks:execute',
  'blocks:list',
  'users:provision',
  'users:read',
  'executions:read',
  'executions:write',
])

export type CanvasScope = z.infer<typeof canvasScopeSchema>

/**
 * Service context passed to authenticated route handlers
 */
export const serviceContextSchema = z
  .object({
    serviceName: z.string(),
    keyId: z.string(),
    keyPrefix: z.string(),
    scopes: z.array(canvasScopeSchema),
    rateLimitPerMinute: z.number().nullable().optional(),
    rateLimitPerDay: z.number().nullable().optional(),
    metadata: z.record(z.unknown()),
  })
  .strict()

export type ServiceContext = z.infer<typeof serviceContextSchema>

/**
 * Canvas request context, including optional Canvas user/workspace headers
 */
export const canvasRequestContextSchema = serviceContextSchema
  .extend({
    canvasUserId: z.string().uuid().optional(),
    canvasWorkspaceId: z.string().uuid().optional(),
    requestId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
  })
  .strict()

export type CanvasRequestContext = z.infer<typeof canvasRequestContextSchema>

/**
 * Pagination parameters for list endpoints
 */
export const paginationParamsSchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_LIMIT),
    offset: z.number().int().min(0),
  })
  .strict()

export type PaginationParams = z.infer<typeof paginationParamsSchema>

/**
 * Pagination metadata in responses
 */
export const paginationMetaSchema = z
  .object({
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    hasMore: z.boolean(),
  })
  .strict()

export type PaginationMeta = z.infer<typeof paginationMetaSchema>

/**
 * Parse pagination params from URL search params
 */
export function parsePaginationParams(url: URL): PaginationParams {
  const limitParam = url.searchParams.get('limit')
  const offsetParam = url.searchParams.get('offset')

  let limit = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT
  let offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0

  if (Number.isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT
  if (Number.isNaN(offset) || offset < 0) offset = 0

  return { limit, offset }
}

/**
 * Create pagination metadata
 */
export function createPaginationMeta(total: number, limit: number, offset: number): PaginationMeta {
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  }
}

/**
 * Canvas API success response format
 */
export const canvasApiSuccessSchema = z
  .object({
    success: z.literal(true),
    data: z.unknown(),
  })
  .strict()

export type CanvasApiSuccess<T = unknown> = z.infer<typeof canvasApiSuccessSchema> & { data: T }

/**
 * Canvas API error response format
 */
export const canvasApiErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
    retryAfter: z.number().optional(),
  })
  .strict()

export type CanvasApiError = z.infer<typeof canvasApiErrorSchema>

/**
 * Block execution request from Canvas
 */
export const blockExecutionContextSchema = z
  .object({
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
    nodeId: z.string().optional(),
  })
  .strict()

export const blockExecutionOptionsSchema = z
  .object({
    timeout: z.number().int().positive().optional(),
    retryOnFailure: z.boolean().optional(),
  })
  .strict()

export const blockExecutionRequestSchema = z
  .object({
    blockType: z.string().min(1),
    params: z.record(z.unknown()),
    blockVersion: z.string().optional(),
    context: blockExecutionContextSchema.optional(),
    options: blockExecutionOptionsSchema.optional(),
  })
  .strict()

export const blockExecutionRequestWithInputsSchema = blockExecutionRequestSchema
  .partial({ params: true })
  .extend({
    inputs: z.record(z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.params && !data.inputs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'params or inputs is required',
        path: ['params'],
      })
    }
  })

export type BlockExecutionRequest = z.infer<typeof blockExecutionRequestSchema>

/**
 * Block execution response to Canvas
 */
export const blockExecutionTimingSchema = z
  .object({
    startedAt: z.string(),
    completedAt: z.string().optional(),
    durationMs: z.number().optional(),
  })
  .strict()

export const blockExecutionUsageSchema = z
  .object({
    tokensUsed: z.number().nullable(),
    apiCallsMade: z.number().nullable(),
    creditsConsumed: z.number().nullable(),
  })
  .strict()

export const blockExecutionResponseDataSchema = z
  .object({
    executionId: z.string(),
    blockType: z.string(),
    status: z.enum(['completed', 'running', 'failed']),
    output: z.record(z.unknown()).optional(),
    progress: z.number().optional(),
    currentStep: z.string().optional(),
    timing: blockExecutionTimingSchema.optional(),
    usage: blockExecutionUsageSchema.optional(),
    pollUrl: z.string().optional(),
    estimatedCompletionMs: z.number().optional(),
  })
  .strict()

export type BlockExecutionResponseData = z.infer<typeof blockExecutionResponseDataSchema>

/**
 * User provisioning request from Canvas
 */
export const userProvisioningRequestSchema = z
  .object({
    canvasUserId: z.string().uuid(),
    email: z.string().email(),
    name: z.string().optional(),
    workspaceId: z.string().uuid().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()

export type UserProvisioningRequest = z.infer<typeof userProvisioningRequestSchema>

/**
 * User provisioning response
 */
export const userProvisioningResponseDataSchema = z
  .object({
    simUserId: z.string().uuid(),
    canvasUserId: z.string().uuid(),
    email: z.string(),
    createdAt: z.string(),
    linkId: z.string().uuid(),
    alreadyExisted: z.boolean().optional(),
  })
  .strict()

export type UserProvisioningResponseData = z.infer<typeof userProvisioningResponseDataSchema>

/**
 * Block capability descriptor
 */
export const blockCapabilityParamSchema = z
  .object({
    type: z.string(),
    required: z.boolean(),
    description: z.string().optional(),
  })
  .strict()

export const blockCapabilitySchema = z
  .object({
    type: z.string(),
    version: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    requiresCredentials: z.boolean(),
    credentialTypes: z.array(z.string()).optional(),
    params: z.record(blockCapabilityParamSchema),
  })
  .strict()

export type BlockCapability = z.infer<typeof blockCapabilitySchema>

export const blockSchemaResponseDataSchema = z
  .object({
    type: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    version: z.string(),
    requiresCredentials: z.boolean(),
    credentialTypes: z.array(z.string()).optional(),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
  })
  .strict()

export type BlockSchemaResponseData = z.infer<typeof blockSchemaResponseDataSchema>

export const blockListResponseDataSchema = z
  .object({
    blocks: z.array(blockCapabilitySchema),
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
  })
  .strict()

export type BlockListResponseData = z.infer<typeof blockListResponseDataSchema>
