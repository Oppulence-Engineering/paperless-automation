/**
 * Canvas Execution Status API
 *
 * GET /api/integrations/canvas/executions/:executionId/status
 *
 * @scope executions:read
 */

import { NextResponse } from 'next/server'
import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { withCanvasAuthParams } from '../../../middleware'
import { notFoundResponse } from '../../../responses'
import type { BlockExecutionResponseData } from '../../../types'

const logger = createLogger('CanvasExecutionStatus')

export const GET = withCanvasAuthParams<{ executionId: string }>(
  async (request, context, params) => {
    try {
      const { executionId } = params

      const [log] = await db
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

      if (!log) {
        return notFoundResponse('Execution')
      }

      const executionData = (log.executionData as any) ?? {}
      const requestData = executionData.request ?? {}
      const responseData = executionData.response ?? {}

      if (!log.endedAt) {
        const runningPayload: BlockExecutionResponseData = {
          executionId,
          blockType: requestData.blockType ?? 'unknown',
          status: 'running',
          progress: executionData.progress ?? 0,
          currentStep: executionData.currentStep ?? 'Running',
          timing: {
            startedAt: log.startedAt.toISOString(),
          },
          pollUrl: `/api/v1/executions/${executionId}/status`,
          estimatedCompletionMs: executionData.estimatedCompletionMs,
        }

        return NextResponse.json({ success: true, data: runningPayload })
      }

      const completedPayload: BlockExecutionResponseData = {
        executionId,
        blockType: responseData.blockType ?? requestData.blockType ?? 'unknown',
        status: log.level === 'error' ? 'failed' : 'completed',
        output: responseData.output ?? {},
        timing: {
          startedAt: log.startedAt.toISOString(),
          completedAt: log.endedAt.toISOString(),
          durationMs: log.totalDurationMs ?? undefined,
        },
        usage: responseData.usage,
      }

      return NextResponse.json({ success: true, data: completedPayload })
    } catch (error) {
      logger.error('Failed to fetch execution status', { error })
      return notFoundResponse('Execution')
    }
  },
  ['executions:read']
)
