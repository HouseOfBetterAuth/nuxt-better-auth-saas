import type { PgColumn } from 'drizzle-orm/pg-core'
import { getTableColumns, sql } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import * as schema from '~~/server/db/schema'
import { isValidTable } from '~~/server/utils/db'

const pathSchema = z.object({
  tableName: z.string().min(1),
  columnName: z.string().min(1)
})

export default eventHandler(async (event) => {
  const params = await getValidatedRouterParams(event, pathSchema.parse)

  const { tableName, columnName } = params
  if (!isValidTable(tableName)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: 'INVALID_TABLE_NAME',
      message: 'Invalid Table Name'
    })
  }

  const table = schema[tableName]
  if (!(table instanceof PgTable)) {
    throw createError(
      {
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: 'INVALID_TABLE_TYPE',
        message: 'Invalid Table Name'
      }
    )
  }
  const columns = getTableColumns(table)

  if (!(columnName in columns)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: 'INVALID_COLUMN_NAME',
      message: 'Invalid Column Name'
    })
  }

  const db = await useDB(event)

  const columnKey = columnName as keyof typeof columns
  const column = table[columnKey] as PgColumn
  const countQuery = db.select({ column, count: sql<number>`cast(count(*) as int)` })
    .from(table)
    .groupBy(column)

  const result = await countQuery
  return result
})
