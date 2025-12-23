/**
 * Canvas User Lookup API
 *
 * Retrieves Sim Studio user information by Canvas user ID.
 *
 * GET /api/integrations/canvas/users/[canvasUserId]
 *
 * @scope users:read
 */

import { db } from '@sim/db'
import { account, user, workspace } from '@sim/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { withCanvasAuthParams } from '../../middleware'
import { badRequestResponse, errorResponse, internalErrorResponse, singleResponse } from '../../responses'

const logger = createLogger('CanvasUserLookup')

/**
 * Canvas provider identifier
 */
const CANVAS_PROVIDER_ID = 'canvas'

const canvasUserParamsSchema = z
  .object({
    canvasUserId: z.string().uuid(),
  })
  .strict()

const canvasUserInfoSchema = z
  .object({
    canvasUserId: z.string().uuid(),
    simUserId: z.string().uuid(),
    simWorkspaceId: z.string().uuid().nullable(),
    email: z.string().email(),
    name: z.string(),
    linkedAt: z.string(),
  })
  .strict()

type CanvasUserInfo = z.infer<typeof canvasUserInfoSchema>

/**
 * GET /api/integrations/canvas/users/[canvasUserId]
 *
 * Retrieves Sim Studio user information for a Canvas user.
 * Returns user details and workspace ID if the user is linked.
 */
export const GET = withCanvasAuthParams<{ canvasUserId: string }>(
  async (request, context, params) => {
    try {
      const paramsResult = canvasUserParamsSchema.safeParse(params)
      if (!paramsResult.success) {
        const errors = paramsResult.error.flatten().fieldErrors
        return badRequestResponse('Invalid canvas user id', errors)
      }

      const { canvasUserId } = paramsResult.data

      logger.info('Looking up Canvas user', {
        canvasUserId,
        serviceName: context.serviceName,
      })

      // Find the Canvas account link
      const [accountLink] = await db
        .select({
          account: account,
          user: user,
        })
        .from(account)
        .innerJoin(user, eq(account.userId, user.id))
        .where(and(eq(account.accountId, canvasUserId), eq(account.providerId, CANVAS_PROVIDER_ID)))
        .limit(1)

      if (!accountLink) {
        return errorResponse(
          'USER_NOT_PROVISIONED',
          'Canvas user not linked to Sim Studio',
          404
        )
      }

      // Find user's primary workspace
      const [userWorkspace] = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.ownerId, accountLink.user.id))
        .limit(1)

      const response: CanvasUserInfo = {
        canvasUserId,
        simUserId: accountLink.user.id,
        simWorkspaceId: userWorkspace?.id ?? null,
        email: accountLink.user.email,
        name: accountLink.user.name,
        linkedAt: accountLink.account.createdAt.toISOString(),
      }

      return singleResponse(response)
    } catch (error) {
      logger.error('Canvas user lookup failed', { error })
      return internalErrorResponse('Failed to lookup user')
    }
  },
  ['users:read']
)
