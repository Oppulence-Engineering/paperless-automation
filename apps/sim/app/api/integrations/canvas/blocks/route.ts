/**
 * Canvas Blocks Listing API
 *
 * Lists available Sim Studio blocks for Canvas integration.
 * Provides block capabilities, inputs, and outputs for Canvas to discover.
 *
 * GET /api/integrations/canvas/blocks
 *
 * @scope blocks:list
 */

import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getAllBlocks } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { withCanvasAuth } from '../middleware'
import { badRequestResponse } from '../responses'
import type { BlockCapability, BlockListResponseData } from '../types'
import { parsePaginationParams } from '../types'
import { buildParamsDescriptor, getCredentialTypes, mapBlockCategory } from './utils'

const logger = createLogger('CanvasBlocksListing')

/**
 * GET /api/integrations/canvas/blocks
 *
 * Returns a paginated list of available blocks with their capabilities.
 * Supports filtering by category via query parameter.
 */
export const GET = withCanvasAuth(async (request, context) => {
  try {
    const url = new URL(request.url)
    const { limit, offset } = parsePaginationParams(url)
    const categoryFilter = url.searchParams.get('category')
    const search = url.searchParams.get('search')
    const includeHidden = url.searchParams.get('includeHidden') === 'true'

    logger.info('Listing blocks for Canvas', {
      serviceName: context.serviceName,
      category: categoryFilter,
      limit,
      offset,
    })

    // Get all blocks from registry
    const allBlocks = getAllBlocks().map((block) => ({
      block,
      category: mapBlockCategory(block),
    }))

    // Filter blocks
    let filteredBlocks = allBlocks.filter(({ block, category }) => {
      // Exclude hidden blocks unless requested
      if (!includeHidden && block.hideFromToolbar) {
        return false
      }

      // Exclude trigger-only blocks
      if (block.type === 'starter') {
        return false
      }

      // Apply category filter
      if (categoryFilter) {
        const normalized = categoryFilter.toLowerCase()
        if (category.toLowerCase() !== normalized) {
          return false
        }
      }

      // Apply search filter
      if (search) {
        const query = search.toLowerCase()
        const matches =
          block.name.toLowerCase().includes(query) ||
          block.description.toLowerCase().includes(query) ||
          block.type.toLowerCase().includes(query)
        if (!matches) return false
      }

      return true
    })

    // Sort by category, then name
    filteredBlocks.sort((a, b) => {
      const catCompare = a.category.localeCompare(b.category)
      if (catCompare !== 0) return catCompare
      return a.block.name.localeCompare(b.block.name)
    })

    const total = filteredBlocks.length

    // Apply pagination
    const paginatedBlocks = filteredBlocks.slice(offset, offset + limit)

    const capabilities: BlockCapability[] = paginatedBlocks.map(({ block, category }) =>
      transformBlockToCapability(block, category)
    )

    const payload: BlockListResponseData = {
      blocks: capabilities,
      total,
      limit,
      offset,
    }

    logger.info('Blocks listing complete', {
      total,
      returned: capabilities.length,
      offset,
    })

    return NextResponse.json({ success: true, data: payload })
  } catch (error) {
    logger.error('Failed to list blocks', { error })
    return badRequestResponse('Failed to list blocks')
  }
}, ['blocks:list'])

/**
 * Transform a BlockConfig to a Canvas BlockCapability
 */
function transformBlockToCapability(block: BlockConfig, category: string): BlockCapability {
  const credentialTypes = getCredentialTypes(block)
  const params = buildParamsDescriptor(block)

  return {
    type: block.type,
    version: '1.0.0',
    name: block.name,
    description: block.description,
    category,
    requiresCredentials: credentialTypes.length > 0,
    credentialTypes: credentialTypes.length > 0 ? credentialTypes : undefined,
    params,
  }
}
