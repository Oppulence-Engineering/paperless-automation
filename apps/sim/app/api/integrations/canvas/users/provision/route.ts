/**
 * Canvas User Provisioning API
 *
 * Creates or links a Sim Studio user for a Canvas user.
 * This is the primary entry point for Canvas users to get access to Sim blocks.
 *
 * POST /api/integrations/canvas/users/provision
 *
 * @scope users:provision
 */

import { db } from '@sim/db'
import { account, permissions, user, userStats, workflow, workspace } from '@sim/db/schema'
import { eq, and } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { withCanvasAuth } from '../../middleware'
import {
  singleResponse,
  badRequestResponse,
  userExistsResponse,
  internalErrorResponse,
} from '../../responses'
import type { UserProvisioningResponseData } from '../../types'
import { userProvisioningRequestSchema } from '../../types'

const logger = createLogger('CanvasUserProvisioning')

/**
 * Canvas provider identifier for account linking
 */
const CANVAS_PROVIDER_ID = 'canvas'

/**
 * Default usage limit for new Canvas-provisioned users (in credits)
 */
const DEFAULT_CANVAS_USER_CREDITS = '1000000' // $10 worth

/**
 * POST /api/integrations/canvas/users/provision
 *
 * Provisions a Sim Studio user for a Canvas user. Handles three scenarios:
 * 1. Canvas user already linked → returns existing Sim user
 * 2. Email already exists in Sim → links Canvas user to existing account
 * 3. New user → creates full Sim account with workspace
 */
export const POST = withCanvasAuth(async (request, context) => {
  try {
    const body = await request.json()
    const parseResult = userProvisioningRequestSchema.safeParse(body)

    if (!parseResult.success) {
      const errors = parseResult.error.flatten().fieldErrors
      return badRequestResponse('Validation failed', errors)
    }

    const { canvasUserId, email, name, workspaceId, metadata } = parseResult.data
    const derivedName = name ?? deriveNameFromEmail(email)
    const linkMetadata = {
      ...(metadata ?? {}),
      ...(workspaceId ? { canvasWorkspaceId: workspaceId } : {}),
    }

    logger.info('Processing Canvas user provisioning request', {
      canvasUserId,
      email,
      serviceName: context.serviceName,
    })

    // Check if Canvas user is already linked
    const existingLink = await findExistingCanvasLink(canvasUserId)
    if (existingLink) {
      logger.info('Canvas user already linked', {
        canvasUserId,
        simUserId: existingLink.userId,
      })

      const response: UserProvisioningResponseData = {
        simUserId: existingLink.userId,
        canvasUserId,
        email: existingLink.email,
        createdAt: existingLink.createdAt.toISOString(),
        linkId: existingLink.linkId,
        alreadyExisted: true,
      }

      return singleResponse(response, 409)
    }

    // Check if email already exists in Sim
    const existingUser = await findUserByEmail(email)
    if (existingUser) {
      // Link Canvas user to existing Sim account
      const link = await createCanvasAccountLink(existingUser.id, canvasUserId, linkMetadata)

      logger.info('Linked Canvas user to existing Sim account', {
        canvasUserId,
        simUserId: existingUser.id,
      })

      const response: UserProvisioningResponseData = {
        simUserId: existingUser.id,
        canvasUserId,
        email: existingUser.email,
        createdAt: link.createdAt.toISOString(),
        linkId: link.linkId,
      }

      return singleResponse(response, 201)
    }

    // Create new Sim user with full provisioning
    const result = await createNewSimUser(canvasUserId, email, derivedName, linkMetadata)

    logger.info('Created new Sim user for Canvas', {
      canvasUserId,
      simUserId: result.userId,
      simWorkspaceId: result.workspaceId,
    })

    const response: UserProvisioningResponseData = {
      simUserId: result.userId,
      canvasUserId,
      email,
      createdAt: result.linkCreatedAt.toISOString(),
      linkId: result.linkId,
    }

    return singleResponse(response, 201)
  } catch (error) {
    logger.error('Canvas user provisioning failed', { error })

    if (error instanceof Error && error.message.includes('unique')) {
      return userExistsResponse('User provisioning conflict - please retry')
    }

    return internalErrorResponse('Failed to provision user')
  }
}, ['users:provision'])

function deriveNameFromEmail(email: string): string {
  const [localPart] = email.split('@')
  if (!localPart) return 'Canvas User'
  return localPart
    .split(/[._-]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

/**
 * Find existing Canvas account link
 */
async function findExistingCanvasLink(canvasUserId: string) {
  const [link] = await db
    .select({
      linkId: account.id,
      userId: account.userId,
      createdAt: account.createdAt,
      email: user.email,
    })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .where(and(eq(account.accountId, canvasUserId), eq(account.providerId, CANVAS_PROVIDER_ID)))
    .limit(1)

  return link ?? null
}

/**
 * Find user by email
 */
async function findUserByEmail(email: string) {
  const [existingUser] = await db.select().from(user).where(eq(user.email, email)).limit(1)

  return existingUser ?? null
}

/**
 * Create Canvas account link for existing user
 */
async function createCanvasAccountLink(
  userId: string,
  canvasUserId: string,
  metadata?: Record<string, unknown>
): Promise<{ linkId: string; createdAt: Date }> {
  const now = new Date()
  const linkId = crypto.randomUUID()

  await db.insert(account).values({
    id: linkId,
    accountId: canvasUserId,
    providerId: CANVAS_PROVIDER_ID,
    userId,
    scope: JSON.stringify(metadata ?? {}),
    createdAt: now,
    updatedAt: now,
  })

  return { linkId, createdAt: now }
}

/**
 * Create a new Sim user with full provisioning:
 * - User record
 * - User stats
 * - Default workspace with initial workflow
 * - Canvas account link
 */
async function createNewSimUser(
  canvasUserId: string,
  email: string,
  name: string,
  metadata?: Record<string, unknown>
): Promise<{ userId: string; workspaceId: string; linkId: string; linkCreatedAt: Date }> {
  const userId = crypto.randomUUID()
  const workspaceId = crypto.randomUUID()
  const workflowId = crypto.randomUUID()
  const linkId = crypto.randomUUID()
  const now = new Date()

  await db.transaction(async (tx) => {
    // Create user
    await tx.insert(user).values({
      id: userId,
      name,
      email,
      emailVerified: true, // Canvas users are pre-verified
      createdAt: now,
      updatedAt: now,
    })

    // Create user stats
    await tx.insert(userStats).values({
      id: crypto.randomUUID(),
      userId,
      currentUsageLimit: DEFAULT_CANVAS_USER_CREDITS,
    })

    // Create Canvas account link
    await tx.insert(account).values({
      id: linkId,
      accountId: canvasUserId,
      providerId: CANVAS_PROVIDER_ID,
      userId,
      scope: JSON.stringify(metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    })

    // Create default workspace
    const firstName = name.split(' ')[0]
    const workspaceName = `${firstName}'s Workspace`

    await tx.insert(workspace).values({
      id: workspaceId,
      name: workspaceName,
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: true,
      createdAt: now,
      updatedAt: now,
    })

    // Create admin permissions for workspace
    await tx.insert(permissions).values({
      id: crypto.randomUUID(),
      entityType: 'workspace' as const,
      entityId: workspaceId,
      userId,
      permissionType: 'admin' as const,
      createdAt: now,
      updatedAt: now,
    })

    // Create initial workflow
    await tx.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      folderId: null,
      name: 'canvas-workflow',
      description: 'Your first Canvas workflow',
      color: '#3972F6',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
    })
  })

  // Seed default workflow state (outside transaction for better error handling)
  try {
    const { workflowState } = buildDefaultWorkflowArtifacts()
    await saveWorkflowToNormalizedTables(workflowId, workflowState)
  } catch (error) {
    logger.warn('Failed to seed default workflow state - user still created', { error, workflowId })
  }

  return { userId, workspaceId, linkId, linkCreatedAt: now }
}
