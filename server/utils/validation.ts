import { createError } from 'h3'

/**
 * Validates that a value is included in a given enum array.
 * Throws a standardized error if validation fails.
 *
 * @param value - The value to validate
 * @param enumArray - The array of valid enum values
 * @param fieldName - The name of the field being validated (for error messages)
 * @returns The validated value
 * @throws {H3Error} If value is not in the enum array
 *
 * @example
 * ```ts
 * const status = validateEnum(body.status, CONTENT_STATUSES, 'status')
 * ```
 */
export function validateEnum<T extends readonly string[]>(
  value: unknown,
  enumArray: T,
  fieldName: string
): T[number] {
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a string`
    })
  }

  if (!enumArray.includes(value as T[number])) {
    const validValues = enumArray.join(', ')
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be one of: ${validValues}. Received: ${value}`
    })
  }

  return value as T[number]
}

/**
 * Validates that a value is a non-empty string.
 *
 * @param value - The value to validate
 * @param fieldName - The name of the field being validated
 * @returns The trimmed string value
 * @throws {H3Error} If value is not a non-empty string
 */
export function validateRequiredString(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} is required and must be a non-empty string`
    })
  }

  return value.trim()
}

/**
 * Validates that a value is a string or null/undefined.
 *
 * @param value - The value to validate
 * @param fieldName - The name of the field being validated
 * @returns The string value or null
 * @throws {H3Error} If value is not a string, null, or undefined
 */
export function validateOptionalString(
  value: unknown,
  fieldName: string
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a string or null`
    })
  }

  return value.trim() || null
}

/**
 * Validates that a value is a valid number within a range.
 *
 * @param value - The value to validate
 * @param fieldName - The name of the field being validated
 * @param min - Minimum allowed value (inclusive)
 * @param max - Maximum allowed value (inclusive)
 * @returns The validated number
 * @throws {H3Error} If value is not a valid number in range
 */
export function validateNumber(
  value: unknown,
  fieldName: string,
  min?: number,
  max?: number
): number {
  if (typeof value === 'string' && !value.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a valid number`
    })
  }

  const num = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(num)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a valid number`
    })
  }

  if (min !== undefined && num < min) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be at least ${min}`
    })
  }

  if (max !== undefined && num > max) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be at most ${max}`
    })
  }

  return num
}

/**
 * Validates that a value is a valid UUID string.
 *
 * @param value - The value to validate
 * @param fieldName - The name of the field being validated
 * @returns The validated UUID string
 * @throws {H3Error} If value is not a valid UUID
 */
export function validateUUID(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} is required and must be a valid UUID string`
    })
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(value.trim())) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a valid UUID format`
    })
  }

  return value.trim()
}

/**
 * Validates that a value is a valid UUID string or null/undefined.
 *
 * @param value - The value to validate
 * @param fieldName - The name of the field being validated
 * @returns The validated UUID string or null
 * @throws {H3Error} If value is not a valid UUID, null, or undefined
 */
export function validateOptionalUUID(
  value: unknown,
  fieldName: string
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a valid UUID string or null`
    })
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(value.trim())) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a valid UUID format`
    })
  }

  return value.trim()
}

/**
 * Validates that a request body is a non-null object.
 *
 * @param body - The request body to validate
 * @throws {H3Error} If body is not an object
 */
export function validateRequestBody(body: unknown): asserts body is Record<string, any> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body'
    })
  }
}
