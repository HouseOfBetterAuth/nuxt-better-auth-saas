import type { SQL } from 'drizzle-orm'
import type { PgColumn, PgSelect } from 'drizzle-orm/pg-core'
import { and, eq, gte, ilike, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'

export const filterSchema = z.array(
  z.union([
    z.object({
      col: z.string(),
      op: z.literal('between'),
      v: z.tuple([z.string(), z.string()])
    }),
    z.object({
      col: z.string(),
      op: z.literal('in'),
      v: z.array(z.string()).min(1)
    }),
    z.object({
      col: z.string(),
      op: z.literal('like'),
      v: z.string()
    }),
    z.object({
      col: z.string(),
      op: z.literal('eq'),
      v: z.string()
    })
  ])
)

export function processFilters(
  filters: z.infer<typeof filterSchema>,
  columns: Record<string, PgColumn>
): SQL[] {
  const sqlFilters: SQL[] = []

  for (const filter of filters) {
    if (filter.col in columns) {
      const columnKey = filter.col as keyof typeof columns
      const column = columns[columnKey]
      if (filter.op === 'between') {
        sqlFilters.push(
          and(
            gte(column, new Date(filter.v[0])),
            lte(column, new Date(filter.v[1]))
          )!
        )
      } else if (filter.op === 'in') {
        sqlFilters.push(
          inArray(column, filter.v)
        )
      } else if (filter.op === 'like') {
        sqlFilters.push(
          ilike(column, `%${filter.v}%`)
        )
      } else if (filter.op === 'eq') {
        sqlFilters.push(
          eq(column, filter.v)
        )
      }
    }
  }

  return sqlFilters
}

export function withFilters<T extends PgSelect>(
  qb: T,
  filters: SQL[]
) {
  return filters.length ? qb.where(and(...filters)) : qb
}
