/**
 * Canvas Block Execution API
 *
 * Executes Sim Studio blocks on behalf of Canvas users.
 * This is the core execution endpoint for Canvas-Sim integration.
 *
 * POST /api/integrations/canvas/blocks/execute
 *
 * @scope blocks:execute
 */

import { db } from '@sim/db'
import { account, workspace, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlock, getBlockByToolName } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { executeTool } from '@/tools'
import type { ExecutionContext } from '@/executor/types'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { withCanvasAuth } from '../../middleware'
import {
  badRequestResponse,
  errorResponse,
  internalErrorResponse,
  singleResponse,
} from '../../responses'
import type { BlockExecutionResponseData } from '../../types'
import { blockExecutionRequestWithInputsSchema } from '../../types'
import { buildInputSchema } from '../utils'

const logger = createLogger('CanvasBlockExecution')

/**
 * Canvas provider identifier
 */
const CANVAS_PROVIDER_ID = 'canvas'

/**
 * Default execution timeout in milliseconds
 */
const DEFAULT_EXECUTION_TIMEOUT_MS = 30000

/**
 * Maximum execution timeout in milliseconds
 */
const MAX_EXECUTION_TIMEOUT_MS = 300000

/**
 * Request validation schema
 */
const executeRequestSchema = blockExecutionRequestWithInputsSchema.superRefine((data, ctx) => {
  const timeout = data.options?.timeout
  if (timeout !== undefined) {
    if (timeout < 1000 || timeout > MAX_EXECUTION_TIMEOUT_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `timeout must be between 1000 and ${MAX_EXECUTION_TIMEOUT_MS} ms`,
        path: ['options', 'timeout'],
      })
    }
  }
})

/**
 * POST /api/integrations/canvas/blocks/execute
 *
 * Executes a Sim Studio block with the provided inputs.
 * Validates the Canvas user is linked to a Sim account with workspace access.
 */
export const POST = withCanvasAuth(
  async (request, serviceContext) => {
    const startTime = Date.now()
    let executionId = ''
    let requestPayload: Record<string, unknown> | null = null
    let responseBlockType: string | null = null
    let logStarted = false

    try {
      const body = await request.json()
      const parseResult = executeRequestSchema.safeParse(body)

      if (!parseResult.success) {
        const errors = parseResult.error.flatten().fieldErrors
        return badRequestResponse('Validation failed', errors)
      }

      const { blockType, blockVersion, options } = parseResult.data
      const params = parseResult.data.params ?? parseResult.data.inputs ?? {}
      const context = parseResult.data.context

      const canvasUserId = serviceContext.canvasUserId
      const canvasWorkspaceId = serviceContext.canvasWorkspaceId

      if (!canvasUserId) {
        return badRequestResponse('Missing X-Canvas-User-Id header')
      }

      executionId = context?.executionId ?? serviceContext.idempotencyKey ?? crypto.randomUUID()
      const requestId = serviceContext.requestId ?? executionId

      logger.info('Processing Canvas block execution request', {
        executionId,
        blockType,
        canvasUserId,
        canvasWorkspaceId,
        serviceName: serviceContext.serviceName,
      })

      const existing = await findExistingExecution(executionId)
      if (existing) {
        return buildExecutionStatusResponse(existing, executionId)
      }

      const resolved = resolveBlock(blockType)
      if (!resolved) {
        return errorResponse('INVALID_BLOCK_TYPE', 'Unknown block type', 400, { blockType })
      }

      const { blockConfig, toolId: presetToolId } = resolved
      const hydratedParams = applyBlockTransforms(blockConfig, params)
      const toolId = presetToolId ?? resolveToolId(blockConfig, hydratedParams)

      if (!toolId) {
        return errorResponse('INVALID_BLOCK_TYPE', 'Unable to resolve tool for block type', 400, {
          blockType,
        })
      }

      // Look up the Canvas user's linked Sim account
      const simUser = await findLinkedSimUser(canvasUserId)
      if (!simUser) {
        logger.warn('Canvas user not linked to Sim account', {
          executionId,
          canvasUserId,
        })
        return errorResponse(
          'USER_NOT_PROVISIONED',
          'Canvas user not linked to Sim Studio. Call /users/provision first.',
          404
        )
      }

      // Find the user's workspace
      const simWorkspace = await findUserWorkspace(simUser.userId)
      if (!simWorkspace) {
        logger.error('Sim user has no workspace', {
          executionId,
          simUserId: simUser.userId,
        })
        return internalErrorResponse('User workspace not found')
      }

      const executionContext = buildCanvasExecutionContext({
        executionId,
        workspaceId: simWorkspace.id,
        userId: simUser.userId,
        canvasWorkflowId: context?.workflowId,
      })

      const toolInputs = {
        ...hydratedParams,
        _context: {
          workflowId: executionContext.workflowId,
          workspaceId: executionContext.workspaceId,
          executionId,
          userId: simUser.userId,
          isCanvasExecution: true,
          canvasWorkspaceId,
          canvasNodeId: context?.nodeId,
          canvasWorkflowId: context?.workflowId,
        },
      }

      requestPayload = {
        requestId,
        idempotencyKey: serviceContext.idempotencyKey,
        serviceKeyPrefix: serviceContext.keyPrefix,
        serviceName: serviceContext.serviceName,
        ipAddress: serviceContext.ipAddress,
        userAgent: serviceContext.userAgent,
        blockType,
        blockVersion,
        toolId,
        params: redactApiKeys(hydratedParams),
        context: {
          canvasUserId,
          canvasWorkspaceId,
          canvasWorkflowId: context?.workflowId,
          canvasNodeId: context?.nodeId,
        },
      }

      await logExecutionStart({
        executionId,
        workspaceId: simWorkspace.id,
        blockType: blockConfig.type,
        blockVersion,
        callerUserId: canvasUserId,
        callerWorkspaceId: canvasWorkspaceId,
        callerWorkflowId: context?.workflowId,
        callerNodeId: context?.nodeId,
        requestData: requestPayload,
      })
      logStarted = true
      responseBlockType = blockConfig.type

      logger.info('Executing block via executeTool', {
        executionId,
        blockType: blockConfig.type,
        toolId,
        workspaceId: simWorkspace.id,
        userId: simUser.userId,
      })

      const timeoutMs = options?.timeout ?? DEFAULT_EXECUTION_TIMEOUT_MS
      const retryOnFailure = options?.retryOnFailure ?? false

      const result = await executeWithRetry(
        toolId,
        toolInputs,
        executionContext,
        timeoutMs,
        retryOnFailure
      )

      const endTime = Date.now()
      const durationMs = endTime - startTime

      const usage = {
        tokensUsed: extractTokensUsed(result.output),
        apiCallsMade: extractApiCallsMade(result.output),
        creditsConsumed: extractCreditsConsumed(result.output),
      }

      const asyncExecution = result.success ? detectAsyncExecution(result.output) : null
      if (asyncExecution) {
        await logExecutionRunning({
          executionId,
          durationMs,
          output: redactApiKeys(result.output ?? {}),
          usage,
          requestData: requestPayload,
          responseBlockType: blockConfig.type,
          progress: asyncExecution.progress,
          currentStep: asyncExecution.currentStep,
          estimatedCompletionMs: asyncExecution.estimatedCompletionMs,
        })

        const response: BlockExecutionResponseData = {
          executionId,
          blockType: blockConfig.type,
          status: 'running',
          progress: asyncExecution.progress,
          currentStep: asyncExecution.currentStep,
          pollUrl: `/api/v1/executions/${executionId}/status`,
          estimatedCompletionMs: asyncExecution.estimatedCompletionMs,
        }

        return singleResponse(response, 202)
      }

      await logExecutionCompletion({
        executionId,
        durationMs,
        success: result.success,
        output: redactApiKeys(result.output ?? {}),
        error: result.error,
        usage,
        requestData: requestPayload,
        responseBlockType: blockConfig.type,
      })

      logger.info('Block execution completed', {
        executionId,
        blockType: blockConfig.type,
        success: result.success,
        durationMs,
      })

      if (!result.success) {
        const errorMessage = result.error ?? 'Block execution failed'
        const lowerMessage = errorMessage.toLowerCase()
        const isMissingCredentials =
          lowerMessage.includes('credential') ||
          lowerMessage.includes('oauth') ||
          lowerMessage.includes('api key')

        return errorResponse(
          isMissingCredentials ? 'MISSING_CREDENTIALS' : 'EXECUTION_FAILED',
          errorMessage,
          isMissingCredentials ? 400 : 500,
          { executionId, blockType: blockConfig.type }
        )
      }

      const response: BlockExecutionResponseData = {
        executionId,
        blockType: blockConfig.type,
        status: 'completed',
        output: result.output ?? {},
        timing: {
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date(endTime).toISOString(),
          durationMs,
        },
        usage,
      }

      return singleResponse(response)
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Canvas block execution failed', {
        error,
        durationMs,
      })

      if (logStarted && executionId && requestPayload && responseBlockType) {
        await logExecutionCompletion({
          executionId,
          durationMs,
          success: false,
          output: {},
          error: errorMessage,
          usage: {
            tokensUsed: null,
            apiCallsMade: null,
            creditsConsumed: null,
          },
          requestData: requestPayload,
          responseBlockType,
        })
      }

      if (error instanceof Error && error.message === 'EXECUTION_TIMEOUT') {
        return errorResponse('TIMEOUT', 'Execution exceeded timeout', 504, {
          executionId,
          durationMs,
        })
      }

      return errorResponse('EXECUTION_FAILED', errorMessage, 500, {
        executionId,
        durationMs,
      })
    }
  },
  { scopes: ['blocks:execute'], requireUserContext: true }
)

async function executeWithRetry(
  toolId: string,
  toolInputs: Record<string, unknown>,
  executionContext: ExecutionContext,
  timeoutMs: number,
  retryOnFailure: boolean
) {
  try {
    const result = await executeWithTimeout(toolId, toolInputs, executionContext, timeoutMs)
    if (retryOnFailure && !result.success) {
      return await executeWithTimeout(toolId, toolInputs, executionContext, timeoutMs)
    }
    return result
  } catch (error) {
    if (retryOnFailure) {
      return await executeWithTimeout(toolId, toolInputs, executionContext, timeoutMs)
    }
    throw error
  }
}

async function executeWithTimeout(
  toolId: string,
  toolInputs: Record<string, unknown>,
  executionContext: ExecutionContext,
  timeoutMs: number
) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('EXECUTION_TIMEOUT'))
    }, timeoutMs)

    executeTool(toolId, toolInputs, false, false, executionContext)
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function resolveBlock(blockType: string): { blockConfig: BlockConfig; toolId?: string } | null {
  const blockConfig = getBlock(blockType)
  if (blockConfig) {
    return { blockConfig }
  }

  const byToolName = getBlockByToolName(blockType)
  if (byToolName) {
    return { blockConfig: byToolName, toolId: blockType }
  }

  return null
}

function resolveToolId(blockConfig: BlockConfig, params: Record<string, unknown>): string | null {
  const toolId = blockConfig.tools.config?.tool
    ? blockConfig.tools.config.tool(params)
    : blockConfig.tools.access[0]
  return toolId ?? null
}

function applyBlockTransforms(
  blockConfig: BlockConfig,
  params: Record<string, unknown>
): Record<string, unknown> {
  let finalParams = { ...params }

  for (const subBlock of blockConfig.subBlocks) {
    if (finalParams[subBlock.id] !== undefined) continue

    if (typeof subBlock.value === 'function') {
      try {
        const value = subBlock.value(finalParams as Record<string, any>)
        if (value !== undefined) {
          finalParams[subBlock.id] = value
        }
      } catch (error) {
        logger.warn('Failed to apply default subblock value', {
          blockType: blockConfig.type,
          subBlockId: subBlock.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } else if (subBlock.defaultValue !== undefined) {
      finalParams[subBlock.id] = subBlock.defaultValue
    }
  }

  if (blockConfig.tools.config?.params) {
    try {
      const transformedParams = blockConfig.tools.config.params(finalParams)
      finalParams = { ...finalParams, ...transformedParams }
    } catch (error) {
      logger.warn('Failed to apply parameter transformation', {
        blockType: blockConfig.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const inputSchema = buildInputSchema(blockConfig)
  const properties = (inputSchema.properties ?? {}) as Record<string, { type?: string }>
  for (const [key, schema] of Object.entries(properties)) {
    const value = finalParams[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      if (schema.type === 'object' || schema.type === 'array') {
        try {
          finalParams[key] = JSON.parse(value.trim())
        } catch (error) {
          logger.warn('Failed to parse JSON input', {
            key,
            blockType: blockConfig.type,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  }

  return finalParams
}

async function findExistingExecution(executionId: string) {
  const [existing] = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      level: workflowExecutionLogs.level,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)

  return existing ?? null
}

function buildExecutionStatusResponse(existing: NonNullable<Awaited<ReturnType<typeof findExistingExecution>>>, executionId: string) {
  if (!existing.endedAt) {
    const runningResponse: BlockExecutionResponseData = {
      executionId,
      blockType: (existing.executionData as any)?.request?.blockType ?? 'unknown',
      status: 'running',
      progress: (existing.executionData as any)?.progress ?? 0,
      currentStep: (existing.executionData as any)?.currentStep ?? 'Running',
      timing: {
        startedAt: existing.startedAt.toISOString(),
      },
      pollUrl: `/api/v1/executions/${executionId}/status`,
      estimatedCompletionMs: (existing.executionData as any)?.estimatedCompletionMs,
    }
    return singleResponse(runningResponse, 202)
  }

  const executionData = (existing.executionData as any) ?? {}
  const responseData = executionData.response ?? {}

  const completedResponse: BlockExecutionResponseData = {
    executionId,
    blockType: responseData.blockType ?? executionData.request?.blockType ?? 'unknown',
    status: existing.level === 'error' ? 'failed' : 'completed',
    output: responseData.output ?? {},
    timing: {
      startedAt: existing.startedAt.toISOString(),
      completedAt: existing.endedAt.toISOString(),
      durationMs: existing.totalDurationMs ?? undefined,
    },
    usage: responseData.usage,
  }

  return singleResponse(completedResponse)
}

async function logExecutionStart(params: {
  executionId: string
  workspaceId: string
  blockType: string
  blockVersion?: string
  callerUserId: string
  callerWorkspaceId?: string
  callerWorkflowId?: string
  callerNodeId?: string
  requestData: Record<string, unknown>
}) {
  const now = new Date()

  await db.insert(workflowExecutionLogs).values({
    id: crypto.randomUUID(),
    workflowId: null,
    workspaceId: params.workspaceId,
    executionId: params.executionId,
    stateSnapshotId: null,
    deploymentVersionId: null,
    level: 'info',
    trigger: 'api',
    startedAt: now,
    endedAt: null,
    totalDurationMs: null,
    executionData: {
      request: params.requestData,
      status: 'running',
    },
    cost: null,
    files: null,
    createdAt: now,
    blockType: params.blockType,
    blockVersion: params.blockVersion,
    callerId: CANVAS_PROVIDER_ID,
    callerUserId: params.callerUserId,
    callerWorkspaceId: params.callerWorkspaceId,
    callerWorkflowId: params.callerWorkflowId,
    callerNodeId: params.callerNodeId,
  }).onConflictDoNothing()
}

async function logExecutionCompletion(params: {
  executionId: string
  durationMs: number
  success: boolean
  output: Record<string, unknown>
  error?: string
  usage: {
    tokensUsed: number | null
    apiCallsMade: number | null
    creditsConsumed: number | null
  }
  requestData: Record<string, unknown>
  responseBlockType: string
}) {
  const completedAt = new Date()

  await db
    .update(workflowExecutionLogs)
    .set({
      endedAt: completedAt,
      totalDurationMs: params.durationMs,
      level: params.success ? 'info' : 'error',
      executionData: {
        request: params.requestData,
        response: {
          blockType: params.responseBlockType,
          output: params.output,
          error: params.error,
          usage: params.usage,
          success: params.success,
          status: params.success ? 'completed' : 'failed',
          durationMs: params.durationMs,
          completedAt: completedAt.toISOString(),
        },
        status: params.success ? 'completed' : 'failed',
      },
      apiCallsMade: params.usage.apiCallsMade ?? undefined,
      creditsConsumed:
        params.usage.creditsConsumed !== null ? String(params.usage.creditsConsumed) : undefined,
    })
    .where(eq(workflowExecutionLogs.executionId, params.executionId))
}

async function logExecutionRunning(params: {
  executionId: string
  durationMs: number
  output: Record<string, unknown>
  usage: {
    tokensUsed: number | null
    apiCallsMade: number | null
    creditsConsumed: number | null
  }
  requestData: Record<string, unknown>
  responseBlockType: string
  progress?: number
  currentStep?: string
  estimatedCompletionMs?: number
}) {
  await db
    .update(workflowExecutionLogs)
    .set({
      executionData: {
        request: params.requestData,
        response: {
          blockType: params.responseBlockType,
          output: params.output,
          usage: params.usage,
          success: true,
          status: 'running',
          durationMs: params.durationMs,
        },
        status: 'running',
        progress: params.progress,
        currentStep: params.currentStep,
        estimatedCompletionMs: params.estimatedCompletionMs,
      },
      apiCallsMade: params.usage.apiCallsMade ?? undefined,
      creditsConsumed:
        params.usage.creditsConsumed !== null ? String(params.usage.creditsConsumed) : undefined,
    })
    .where(eq(workflowExecutionLogs.executionId, params.executionId))
}

/**
 * Find a Canvas user's linked Sim account
 */
async function findLinkedSimUser(canvasUserId: string): Promise<{ userId: string } | null> {
  const [link] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.accountId, canvasUserId), eq(account.providerId, CANVAS_PROVIDER_ID)))
    .limit(1)

  return link ?? null
}

/**
 * Find user's primary workspace
 */
async function findUserWorkspace(userId: string): Promise<{ id: string } | null> {
  const [userWorkspace] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerId, userId))
    .limit(1)

  return userWorkspace ?? null
}

/**
 * Build a minimal ExecutionContext for Canvas block execution.
 * This provides the required context for tool execution without
 * a full workflow execution graph.
 */
function buildCanvasExecutionContext(params: {
  executionId: string
  workspaceId: string
  userId: string
  canvasWorkflowId?: string
}): ExecutionContext {
  const { executionId, workspaceId, userId, canvasWorkflowId } = params

  // Use Canvas workflow ID or generate a synthetic one
  const workflowId = canvasWorkflowId ?? `canvas-${executionId}`

  return {
    workflowId,
    workspaceId,
    executionId,
    userId,
    isDeployedContext: false,

    // Empty state maps - Canvas executes single blocks without workflow state
    blockStates: new Map(),
    executedBlocks: new Set(),

    // Execution logs
    blockLogs: [],
    metadata: {
      duration: 0,
      workflowId,
      workspaceId,
      executionId,
      userId,
      isDebugSession: false,
      triggerType: 'canvas',
    },

    // Environment
    environmentVariables: {},
    workflowVariables: {},

    // Decision tracking (unused for single block execution)
    decisions: {
      router: new Map(),
      condition: new Map(),
    },

    // Loop tracking (unused for single block execution)
    completedLoops: new Set(),
    loopExecutions: new Map(),

    // Parallel tracking (unused for single block execution)
    parallelExecutions: new Map(),

    // Active execution path tracking
    activeExecutionPath: new Set(),
  }
}

const ASYNC_STATUS_VALUES = new Set([
  'queued',
  'running',
  'processing',
  'pending',
  'in_progress',
  'in-progress',
  'started',
])

const ASYNC_MESSAGE_PATTERN = /\b(async|asynchronous|queued|processing|running|pending|in progress)\b/i

function detectAsyncExecution(
  output: Record<string, unknown> | undefined
): { progress?: number; currentStep?: string; estimatedCompletionMs?: number } | null {
  if (!output || typeof output !== 'object') {
    return null
  }

  const statusValue = getString(
    output.status ??
      output.state ??
      output.jobStatus ??
      (output as { job_state?: unknown }).job_state
  )

  const normalizedStatus = statusValue?.toLowerCase()
  const isRunningStatus = normalizedStatus ? ASYNC_STATUS_VALUES.has(normalizedStatus) : false

  const jobId = getString(
    output.jobId ??
      (output as { job_id?: unknown }).job_id ??
      output.taskId ??
      (output as { task_id?: unknown }).task_id
  )

  const message = getString(
    output.currentStep ??
      output.message ??
      output.statusMessage ??
      (output as { status_message?: unknown }).status_message
  )

  const hasAsyncMessage = message ? ASYNC_MESSAGE_PATTERN.test(message) : false

  if (!isRunningStatus && !(jobId && hasAsyncMessage)) {
    return null
  }

  const progressValue = getNumber(
    output.progress ?? output.percentage ?? (output as { percent?: unknown }).percent
  )

  const progress = progressValue !== undefined ? normalizeProgress(progressValue) : undefined
  const currentStep = message ?? (normalizedStatus ? `Status: ${normalizedStatus}` : undefined)
  const estimatedCompletionMs = getNumber(
    output.estimatedCompletionMs ??
      (output as { etaMs?: unknown }).etaMs ??
      (output as { eta_ms?: unknown }).eta_ms
  )

  return {
    progress,
    currentStep,
    estimatedCompletionMs,
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function normalizeProgress(value: number): number {
  if (value <= 0) return 0
  if (value <= 1) return value
  if (value <= 100) return value / 100
  return 1
}

/**
 * Extract token usage from tool output if available
 */
function extractTokensUsed(output: Record<string, unknown> | undefined): number | null {
  if (!output) return null

  const tokens = (output as { tokens?: { total?: number } }).tokens
  if (tokens?.total) return tokens.total

  const usage = (output as { usage?: { total_tokens?: number } }).usage
  if (usage?.total_tokens) return usage.total_tokens

  const cost = (output as { cost?: { tokens?: { total?: number } } }).cost
  if (cost?.tokens?.total) return cost.tokens.total

  return null
}

function extractApiCallsMade(output: Record<string, unknown> | undefined): number | null {
  if (!output) return 1

  const usage = (output as { usage?: { apiCallsMade?: number } }).usage
  if (typeof usage?.apiCallsMade === 'number') return usage.apiCallsMade

  return 1
}

function extractCreditsConsumed(output: Record<string, unknown> | undefined): number | null {
  if (!output) return null

  const usage = (output as { usage?: { creditsConsumed?: number } }).usage
  if (typeof usage?.creditsConsumed === 'number') return usage.creditsConsumed

  const cost = (output as { cost?: { total?: number } }).cost
  if (typeof cost?.total === 'number') return cost.total

  return null
}
