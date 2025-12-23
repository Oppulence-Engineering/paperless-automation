/**
 * Canvas Block Schema API
 *
 * Returns detailed JSON schema for a specific block type.
 *
 * GET /api/integrations/canvas/blocks/:type/schema
 *
 * @scope blocks:list
 */

import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlock, getBlockByToolName } from '@/blocks'
import { withCanvasAuthParams } from '../../../middleware'
import { errorResponse } from '../../../responses'
import type { BlockSchemaResponseData } from '../../../types'
import { buildInputSchema, buildOutputSchema, getCredentialTypes, mapBlockCategory } from '../../utils'

const logger = createLogger('CanvasBlockSchema')

export const GET = withCanvasAuthParams<{ type: string }>(
  async (request, context, params) => {
    try {
      const { type } = params

      const block = getBlock(type) ?? getBlockByToolName(type)
      if (!block) {
        return errorResponse('INVALID_BLOCK_TYPE', 'Unknown block type', 400, { blockType: type })
      }

      const credentialTypes = getCredentialTypes(block)
      const category = mapBlockCategory(block)

      const payload: BlockSchemaResponseData = {
        type: block.type,
        name: block.name,
        description: block.description,
        category,
        version: '1.0.0',
        requiresCredentials: credentialTypes.length > 0,
        credentialTypes: credentialTypes.length > 0 ? credentialTypes : undefined,
        inputSchema: buildInputSchema(block),
        outputSchema: buildOutputSchema(block),
      }

      logger.info('Canvas block schema requested', {
        serviceName: context.serviceName,
        blockType: block.type,
      })

      return NextResponse.json({ success: true, data: payload })
    } catch (error) {
      logger.error('Failed to get block schema', { error })
      return errorResponse('INTERNAL_ERROR', 'Failed to get block schema', 500)
    }
  },
  ['blocks:list']
)
