import { getPgPool } from './drivers'

export async function getDBStats() {
  const client = await getPgPool().connect()
  const dbStatsResult = await client.query(`
    SELECT
      numbackends as active_backends,
      xact_commit as commits,
      xact_rollback as rollbacks,
      blks_read,
      blks_hit,
      tup_returned,
      tup_fetched,
      tup_inserted,
      tup_updated,
      tup_deleted,
      conflicts,
      temp_files,
      temp_bytes,
      deadlocks
    FROM pg_stat_database
    WHERE datname = current_database()
  `)
  client.release()
  const dbStats = dbStatsResult.rows[0]
  if (!dbStats)
    throw new Error('Database statistics are unavailable')
  const totalBlocks = Number(dbStats.blks_read) + Number(dbStats.blks_hit)
  const cacheHitRatio = totalBlocks > 0 ? (Number(dbStats.blks_hit) / totalBlocks * 100) : 0

  return {
    activeBackends: Number(dbStats.active_backends),
    transactions: {
      commits: Number(dbStats.commits),
      rollbacks: Number(dbStats.rollbacks)
    },
    tuples: {
      returned: Number(dbStats.tup_returned),
      fetched: Number(dbStats.tup_fetched),
      inserted: Number(dbStats.tup_inserted),
      updated: Number(dbStats.tup_updated),
      deleted: Number(dbStats.tup_deleted)
    },
    cacheHitRatio: Math.round(cacheHitRatio * 100) / 100,
    conflicts: Number(dbStats.conflicts),
    deadlocks: Number(dbStats.deadlocks),
    tempFiles: {
      count: Number(dbStats.temp_files),
      bytes: Number(dbStats.temp_bytes)
    }
  }
}
