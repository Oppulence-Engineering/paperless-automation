/**
 * Environment utility functions for consistent environment detection across the application
 */
import { env, getEnv, isTruthy } from './env'

const isServer = typeof window === 'undefined'

const getServerEnv = <T>(
  getter: () => T,
  clientVariable?: string
): T | string | boolean | number | undefined => {
  if (isServer) {
    return getter()
  }
  if (clientVariable) {
    return getEnv(clientVariable)
  }
  return undefined
}

/**
 * Is the application running in production mode
 */
export const isProd = env.NODE_ENV === 'production'

/**
 * Is the application running in development mode
 */
export const isDev = env.NODE_ENV === 'development'

/**
 * Is the application running in test mode
 */
export const isTest = env.NODE_ENV === 'test'

/**
 * Is this the hosted version of the application
 */
export const isHosted =
  getEnv('NEXT_PUBLIC_APP_URL') === 'https://www.sim.ai' ||
  getEnv('NEXT_PUBLIC_APP_URL') === 'https://www.staging.sim.ai'

/**
 * Is billing enforcement enabled
 */
export const isBillingEnabled = isTruthy(
  getServerEnv(() => env.BILLING_ENABLED, 'NEXT_PUBLIC_BILLING_ENABLED')
)

/**
 * Is email verification enabled
 */
export const isEmailVerificationEnabled = isTruthy(
  getServerEnv(() => env.EMAIL_VERIFICATION_ENABLED)
)

const isAuthDisabledRaw = isTruthy(getServerEnv(() => env.DISABLE_AUTH))

/**
 * Is authentication disabled (for self-hosted deployments behind private networks)
 * This flag is blocked when isHosted is true.
 */
export const isAuthDisabled = isAuthDisabledRaw && !isHosted

if (isAuthDisabledRaw) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      const logger = createLogger('FeatureFlags')
      if (isHosted) {
        logger.error(
          'DISABLE_AUTH is set but ignored on hosted environment. Authentication remains enabled for security.'
        )
      } else {
        logger.warn(
          'DISABLE_AUTH is enabled. Authentication is bypassed and all requests use an anonymous session. Only use this in trusted private networks.'
        )
      }
    })
    .catch(() => {
      // Fallback during config compilation when logger is unavailable
    })
}

/**
 * Is user registration disabled
 */
export const isRegistrationDisabled = isTruthy(getServerEnv(() => env.DISABLE_REGISTRATION))

/**
 * Is Trigger.dev enabled for async job processing
 */
export const isTriggerDevEnabled = isTruthy(
  getServerEnv(() => env.TRIGGER_DEV_ENABLED, 'NEXT_PUBLIC_TRIGGER_DEV_ENABLED')
)

/**
 * Is SSO enabled for enterprise authentication
 */
export const isSsoEnabled = isTruthy(getServerEnv(() => env.SSO_ENABLED, 'NEXT_PUBLIC_SSO_ENABLED'))

/**
 * Is E2B enabled for remote code execution
 */
export const isE2bEnabled = isTruthy(getServerEnv(() => env.E2B_ENABLED, 'NEXT_PUBLIC_E2B_ENABLED'))

/**
 * Get cost multiplier based on environment
 */
export function getCostMultiplier(): number {
  if (!isProd) {
    return 1
  }

  const multiplier = getServerEnv(() => env.COST_MULTIPLIER)
  if (typeof multiplier === 'number') {
    return multiplier
  }
  if (typeof multiplier === 'string' && multiplier.trim() !== '') {
    const parsed = Number(multiplier)
    return Number.isFinite(parsed) ? parsed : 1
  }
  return 1
}
