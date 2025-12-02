import { createError } from 'h3'

/**
 * Standard HTTP status codes used throughout the API
 */
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503
} as const

/**
 * Standard error messages for common scenarios
 */
export const ERROR_MESSAGES = {
  INVALID_REQUEST_BODY: 'Invalid request body',
  AUTHENTICATION_REQUIRED: 'Authentication required',
  AUTHORIZATION_FAILED: 'Authorization failed',
  RESOURCE_NOT_FOUND: 'Resource not found',
  DUPLICATE_RESOURCE: 'Resource already exists',
  PAYLOAD_TOO_LARGE: 'Payload size exceeds maximum allowed',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',
  INTERNAL_SERVER_ERROR: 'Internal server error',
  EXTERNAL_SERVICE_ERROR: 'External service error',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable'
} as const

/**
 * Creates a standardized validation error
 *
 * @param message - Error message
 * @param data - Optional additional context
 */
export function createValidationError(message: string, data?: Record<string, any>) {
  return createError({
    statusCode: HTTP_STATUS.BAD_REQUEST,
    statusMessage: message,
    data
  })
}

/**
 * Creates a standardized authentication error
 *
 * @param message - Error message (defaults to standard message)
 */
export function createAuthenticationError(message: string = ERROR_MESSAGES.AUTHENTICATION_REQUIRED) {
  return createError({
    statusCode: HTTP_STATUS.UNAUTHORIZED,
    statusMessage: message
  })
}

/**
 * Creates a standardized authorization error
 *
 * @param message - Error message (defaults to standard message)
 */
export function createAuthorizationError(message: string = ERROR_MESSAGES.AUTHORIZATION_FAILED) {
  return createError({
    statusCode: HTTP_STATUS.FORBIDDEN,
    statusMessage: message
  })
}

/**
 * Creates a standardized not found error
 *
 * @param resourceName - Name of the resource that was not found
 * @param identifier - Optional identifier that was searched for
 */
export function createNotFoundError(resourceName: string, identifier?: string) {
  const message = identifier
    ? `${resourceName} not found: ${identifier}`
    : `${resourceName} not found`

  return createError({
    statusCode: HTTP_STATUS.NOT_FOUND,
    statusMessage: message
  })
}

/**
 * Creates a standardized conflict error
 *
 * @param message - Error message describing the conflict
 */
export function createConflictError(message: string) {
  return createError({
    statusCode: HTTP_STATUS.CONFLICT,
    statusMessage: message
  })
}

/**
 * Creates a standardized internal server error
 *
 * @param message - Error message (defaults to standard message)
 * @param data - Optional additional context
 */
export function createInternalError(message: string = ERROR_MESSAGES.INTERNAL_SERVER_ERROR, data?: Record<string, any>) {
  return createError({
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    statusMessage: message,
    data
  })
}

/**
 * Creates a standardized external service error (e.g., AI Gateway)
 *
 * @param serviceName - Name of the external service
 * @param message - Error message
 * @param data - Optional additional context
 */
export function createExternalServiceError(serviceName: string, message: string, data?: Record<string, any>) {
  return createError({
    statusCode: HTTP_STATUS.BAD_GATEWAY,
    statusMessage: `Failed to reach ${serviceName}: ${message}`,
    data
  })
}

/**
 * Creates a standardized service unavailable error
 *
 * @param message - Error message (defaults to standard message)
 */
export function createServiceUnavailableError(message: string = ERROR_MESSAGES.SERVICE_UNAVAILABLE) {
  return createError({
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    statusMessage: message
  })
}
