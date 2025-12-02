/**
 * Standard response format for list endpoints with pagination
 */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    limit: number
    offset: number
    total: number
    hasMore: boolean
    nextOffset: number | null
  }
}

/**
 * Creates a standardized paginated response
 *
 * @param data - Array of items
 * @param total - Total number of items
 * @param limit - Number of items per page
 * @param offset - Current offset
 * @returns Paginated response object
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  limit: number,
  offset: number
): PaginatedResponse<T> {
  const hasMore = offset + data.length < total
  const nextOffset = hasMore ? offset + limit : null

  return {
    data,
    pagination: {
      limit,
      offset,
      total,
      hasMore,
      nextOffset
    }
  }
}

/**
 * Standard response format for single resource endpoints
 * Returns the resource directly (not wrapped in { data: ... })
 *
 * @param resource - The resource to return
 * @returns The resource directly
 */
export function createResourceResponse<T>(resource: T): T {
  return resource
}

/**
 * Standard response format for creation endpoints
 */
export interface CreateResponse<T> {
  id: string
  resource: T
}

/**
 * Creates a standardized creation response
 *
 * @param id - ID of the created resource
 * @param resource - The created resource
 * @returns Creation response object
 */
export function createCreationResponse<T>(id: string, resource: T): CreateResponse<T> {
  return {
    id,
    resource
  }
}

/**
 * Standard response format for update endpoints
 */
export interface UpdateResponse<T> {
  id: string
  resource: T
  updated: boolean
}

/**
 * Creates a standardized update response
 *
 * @param id - ID of the updated resource
 * @param resource - The updated resource
 * @param updated - Whether the resource was actually updated
 * @returns Update response object
 */
export function createUpdateResponse<T>(id: string, resource: T, updated: boolean = true): UpdateResponse<T> {
  return {
    id,
    resource,
    updated
  }
}
