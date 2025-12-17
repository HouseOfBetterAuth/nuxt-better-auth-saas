#!/usr/bin/env tsx

/** Troubleshoot anonymous auth + org resolution + chat persistence (direct DB). */

import * as dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

interface Args {
  userId?: string
  sessionToken?: string
  orgId?: string
  conversationId?: string
  scan?: boolean
  scanLimit?: number
  fixDefaultOrg?: string
  fixActiveOrg?: string
  fixOrgOwner?: string
  apply?: boolean
  statActivity?: boolean
  locks?: boolean
  explainConversations?: boolean
  explainVerification?: boolean
  verificationIdentifier?: string
  statementTimeoutMs?: number
  orgDeep?: boolean
  conversationDeep?: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { scanLimit: 50, statementTimeoutMs: 30000 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]

    const requireValue = (flag: string) => {
      if (i + 1 >= argv.length) {
        console.error(`❌ Missing value for ${flag}`)
        console.error('Run with --help to see usage.')
        process.exit(2)
      }
      i++
      return argv[i]
    }

    if (a === '--userId') {
      out.userId = requireValue(a)
    } else if (a === '--sessionToken') {
      out.sessionToken = requireValue(a)
    } else if (a === '--orgId') {
      out.orgId = requireValue(a)
    } else if (a === '--conversationId') {
      out.conversationId = requireValue(a)
    } else if (a === '--scan') {
      out.scan = true
    } else if (a === '--scanLimit') {
      const raw = requireValue(a)
      const parsed = Number.parseInt(raw, 10)
      if (!Number.isFinite(parsed)) {
        console.error(`❌ Invalid value for --scanLimit: "${raw}" (expected an integer)`)
        process.exit(2)
      }
      out.scanLimit = parsed
    } else if (a === '--fixDefaultOrg') {
      out.fixDefaultOrg = requireValue(a)
    } else if (a === '--fixActiveOrg') {
      out.fixActiveOrg = requireValue(a)
    } else if (a === '--fixOrgOwner') {
      out.fixOrgOwner = requireValue(a)
    } else if (a === '--apply') {
      out.apply = true
    } else if (a === '--statActivity') {
      out.statActivity = true
    } else if (a === '--locks') {
      out.locks = true
    } else if (a === '--explainConversations') {
      out.explainConversations = true
    } else if (a === '--explainVerification') {
      out.explainVerification = true
    } else if (a === '--verificationIdentifier') {
      out.verificationIdentifier = requireValue(a)
    } else if (a === '--statementTimeoutMs') {
      const raw = requireValue(a)
      const parsed = Number.parseInt(raw, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error(`❌ Invalid value for --statementTimeoutMs: "${raw}" (expected a positive integer)`)
        process.exit(2)
      }
      out.statementTimeoutMs = parsed
    } else if (a === '--orgDeep') {
      out.orgDeep = true
    } else if (a === '--conversationDeep') {
      out.conversationDeep = true
    } else if (a === '--help' || a === '-h') {
      printHelpAndExit(0)
    }
  }
  return out
}

function printHelpAndExit(code: number) {
  console.log(
    [
      '',
      'Troubleshoot chat/anonymous/orgs (direct DB inspection)',
      '',
      'Modes:',
      '  --scan',
      '  --userId <id>',
      '  --sessionToken <token>',
      '  --orgId <id>',
      '  --conversationId <id>',
      '  --statActivity',
      '  --locks',
      '  --explainConversations',
      '  --explainVerification [--verificationIdentifier <identifier>]',
      '  --orgDeep (when using --orgId: include message/log summaries)',
      '  --conversationDeep (when using --conversationId: include messages/logs)',
      '',
      'Scan options:',
      '  --scanLimit <n> (default: 50)',
      '',
      'Diagnostics options:',
      '  --statementTimeoutMs <n> (default: 30000)',
      '',
      'Optional fixes (require --apply):',
      '  --fixDefaultOrg <orgId>',
      '  --fixActiveOrg <orgId> (requires --sessionToken)',
      '  --fixOrgOwner <userId> (requires --orgId)',
      ''
    ].join('\n')
  )
  process.exit(code)
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    const ms = Date.now() - start
    console.log(`- ${label}: ${ms}ms`)
  }
}

function printSection(title: string) {
  console.log(`\n=== ${title} ===`)
}

function assertDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set')
    process.exit(1)
  }
}

function maskToken(
  token: unknown,
  opts?: {
    prefix?: number
    suffix?: number
  }
) {
  if (typeof token !== 'string') {
    return token
  }
  const prefix = opts?.prefix ?? 8
  const suffix = opts?.suffix ?? 4
  if (token.length <= prefix + suffix) {
    return `${token.slice(0, Math.min(prefix, token.length))}…`
  }
  return `${token.slice(0, prefix)}…${token.slice(-suffix)}`
}

async function runScan(client: pg.PoolClient, scanLimit: number) {
  const limit = Number.isFinite(scanLimit) && scanLimit > 0 ? scanLimit : 50

  printSection('Scan: users with dangling default_organization_id')
  const danglingDefaults = await timed('scan dangling user.default_organization_id', async () => {
    const res = await client.query(
      `SELECT u.id as user_id, u.email, u.is_anonymous, u.default_organization_id
       FROM "user" u
       LEFT JOIN "organization" o ON o.id = u.default_organization_id
       WHERE u.default_organization_id IS NOT NULL
         AND o.id IS NULL
       ORDER BY u.updated_at DESC NULLS LAST, u.created_at DESC
       LIMIT $1`,
      [limit]
    )
    return res.rows as any[]
  })
  console.table(danglingDefaults)

  printSection('Scan: sessions with dangling active_organization_id')
  const danglingActiveOrgs = await timed('scan dangling session.active_organization_id', async () => {
    const res = await client.query(
      `SELECT s.id as session_id, s.user_id, s.expires_at, s.active_organization_id
       FROM "session" s
       LEFT JOIN "organization" o ON o.id = s.active_organization_id
       WHERE s.active_organization_id IS NOT NULL
         AND o.id IS NULL
       ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
       LIMIT $1`,
      [limit]
    )
    return res.rows as any[]
  })
  console.table(danglingActiveOrgs)

  printSection('Scan: anonymous users missing default_organization_id')
  const anonMissingDefault = await timed('scan anon users missing default org', async () => {
    const res = await client.query(
      `SELECT u.id as user_id, u.email, u.created_at, u.updated_at FROM "user" u WHERE u.is_anonymous = true AND (u.default_organization_id IS NULL OR u.default_organization_id = '') ORDER BY u.updated_at DESC NULLS LAST, u.created_at DESC LIMIT $1`,
      [limit]
    )
    return res.rows as any[]
  })
  console.table(anonMissingDefault)

  if (anonMissingDefault.length > 0) {
    printSection('Details: anon users missing default_organization_id (memberships + sessions)')
    const userIds = anonMissingDefault.map(r => String(r.user_id))
    const details = await timed('detail anon missing default', async () => {
      const res = await client.query(
        `WITH first_membership AS (SELECT DISTINCT ON (m.user_id) m.user_id, m.organization_id, m.created_at FROM "member" m WHERE m.user_id = ANY($1::text[]) ORDER BY m.user_id, m.created_at ASC), session_counts AS (SELECT s.user_id, COUNT(*)::int as session_count FROM "session" s WHERE s.user_id = ANY($1::text[]) GROUP BY s.user_id), member_counts AS (SELECT m.user_id, COUNT(*)::int as member_count FROM "member" m WHERE m.user_id = ANY($1::text[]) GROUP BY m.user_id) SELECT u.id as user_id, u.email, COALESCE(mc.member_count, 0) as member_count, fm.organization_id as first_membership_org_id, (o.id IS NOT NULL) as first_membership_org_exists, o.slug as first_membership_org_slug, o.is_anonymous as first_membership_org_is_anonymous, COALESCE(sc.session_count, 0) as session_count FROM "user" u LEFT JOIN first_membership fm ON fm.user_id = u.id LEFT JOIN "organization" o ON o.id = fm.organization_id LEFT JOIN session_counts sc ON sc.user_id = u.id LEFT JOIN member_counts mc ON mc.user_id = u.id WHERE u.id = ANY($1::text[]) ORDER BY u.updated_at DESC NULLS LAST, u.created_at DESC`,
        [userIds]
      )
      return res.rows as any[]
    })
    console.table(details)
  }

  printSection('Scan: anonymous orgs without owner membership')
  const anonOrgsWithoutOwner = await timed('scan anon orgs missing owner', async () => {
    const res = await client.query(
      `SELECT o.id as organization_id, o.slug, o.created_at FROM "organization" o LEFT JOIN "member" m ON m.organization_id = o.id AND m.role = 'owner' WHERE o.is_anonymous = true AND m.id IS NULL ORDER BY o.created_at DESC LIMIT $1`,
      [limit]
    )
    return res.rows as any[]
  })
  console.table(anonOrgsWithoutOwner)

  if (anonOrgsWithoutOwner.length > 0) {
    printSection('Details: anon orgs without owner (member counts)')
    const orgIds = anonOrgsWithoutOwner.map(r => String(r.organization_id))
    const details = await timed('detail anon orgs missing owner', async () => {
      const res = await client.query(
        `WITH member_stats AS (SELECT m.organization_id, COUNT(*)::int as member_count, COUNT(*) FILTER (WHERE m.role = 'owner')::int as owner_count FROM "member" m WHERE m.organization_id = ANY($1::text[]) GROUP BY m.organization_id) SELECT o.id as organization_id, o.slug, o.created_at, COALESCE(ms.member_count, 0) as member_count, COALESCE(ms.owner_count, 0) as owner_count FROM "organization" o LEFT JOIN member_stats ms ON ms.organization_id = o.id WHERE o.id = ANY($1::text[]) ORDER BY o.created_at DESC`,
        [orgIds]
      )
      return res.rows as any[]
    })
    console.table(details)
  }
}

async function inspectOrg(client: pg.PoolClient, orgId: string) {
  printSection('Organization')
  const orgRow = await timed('select organization', async () => {
    const res = await client.query(
      `SELECT id, slug, name, is_anonymous, created_at FROM "organization" WHERE id = $1 LIMIT 1`,
      [orgId]
    )
    return res.rows[0] as any | undefined
  })

  if (!orgRow) {
    console.error('❌ No organization row found for orgId', orgId)
  } else {
    console.log({ organization: orgRow })
  }

  printSection('Users referencing this org (default_organization_id)')
  const users = await timed('select users by default_organization_id', async () => {
    const res = await client.query(
      `SELECT id as user_id, email, is_anonymous, created_at, updated_at FROM "user" WHERE default_organization_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 50`,
      [orgId]
    )
    return res.rows as any[]
  })
  console.table(users)

  printSection('Sessions referencing this org (active_organization_id)')
  const sessions = await timed('select sessions by active_organization_id', async () => {
    const res = await client.query(
      `SELECT id as session_id, user_id, expires_at, created_at, updated_at FROM "session" WHERE active_organization_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 50`,
      [orgId]
    )
    return res.rows as any[]
  })
  console.table(sessions)

  printSection('Memberships for this org')
  const members = await timed('select members by organization_id', async () => {
    const res = await client.query(
      `SELECT m.id as member_id, m.role, m.created_at as member_created_at, u.id as user_id, u.email, u.is_anonymous FROM "member" m JOIN "user" u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY m.created_at ASC LIMIT 100`,
      [orgId]
    )
    return res.rows as any[]
  })
  console.table(members)

  printSection('Recent conversations for this org')
  const convs = await timed('select conversations by org', async () => {
    const res = await client.query(
      `SELECT id, created_by_user_id, status, created_at, updated_at FROM "conversation" WHERE organization_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 20`,
      [orgId]
    )
    return res.rows as any[]
  })
  console.table(convs)
}

async function inspectConversation(client: pg.PoolClient, conversationId: string, deep: boolean) {
  printSection('Conversation')
  const conversation = await timed('select conversation', async () => {
    const res = await client.query(
      `SELECT id, organization_id, created_by_user_id, source_content_id, status, created_at, updated_at
       FROM "conversation"
       WHERE id = $1
       LIMIT 1`,
      [conversationId]
    )
    return res.rows[0] as any | undefined
  })

  if (!conversation) {
    console.error('❌ No conversation row found for conversationId', conversationId)
    return
  }

  console.log({ conversation })

  if (!deep) {
    return
  }

  printSection('Conversation message stats')
  const stats = await timed('select message counts', async () => {
    const res = await client.query(
      `SELECT
         COUNT(*)::int as total,
         COUNT(*) FILTER (WHERE role = 'user')::int as user_count,
         COUNT(*) FILTER (WHERE role = 'assistant')::int as assistant_count,
         MIN(created_at) as first_message_at,
         MAX(created_at) as last_message_at
       FROM "conversation_message"
       WHERE conversation_id = $1`,
      [conversationId]
    )
    return res.rows[0] as any
  })
  console.log(stats)

  printSection('Recent messages (last 20)')
  const recentMessages = await timed('select recent messages', async () => {
    const res = await client.query(
      `SELECT id, role, created_at, LEFT(content, 160) as content_preview
       FROM "conversation_message"
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [conversationId]
    )
    return res.rows as any[]
  })
  console.table(recentMessages)

  printSection('Recent conversation logs (last 50)')
  const recentLogs = await timed('select recent conversation logs', async () => {
    const res = await client.query(
      `SELECT id, type, created_at, LEFT(message, 200) as message_preview
       FROM "conversation_log"
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [conversationId]
    )
    return res.rows as any[]
  })
  console.table(recentLogs)
}

export function generateId() {
  // Member.id is a text PK with no default; requires Node 20+ for crypto.randomUUID().
  if (typeof (globalThis.crypto as any)?.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID() is not available. Please use Node 20+.')
  }
  return (globalThis.crypto as any).randomUUID()
}

async function fixOrphanAnonymousOrgOwner(client: pg.PoolClient, args: Args) {
  if (!args.orgId) {
    console.error('❌ --fixOrgOwner requires --orgId')
    process.exit(2)
  }
  if (!args.fixOrgOwner) {
    console.error('❌ Missing --fixOrgOwner <userId>')
    process.exit(2)
  }

  const orgId = args.orgId
  const userId = args.fixOrgOwner

  printSection('Fix: attach owner membership to org (dry-run unless --apply)')

  const orgRow = await timed('select organization for fix', async () => {
    const res = await client.query(
      `SELECT id, slug, is_anonymous
       FROM "organization"
       WHERE id = $1
       LIMIT 1`,
      [orgId]
    )
    return res.rows[0] as any | undefined
  })
  if (!orgRow) {
    console.error('❌ Organization not found:', orgId)
    process.exit(2)
  }
  if (!orgRow.is_anonymous) {
    console.error('❌ Refusing: org is not anonymous (is_anonymous=false):', { orgId, slug: orgRow.slug })
    process.exit(2)
  }

  const userRow = await timed('select user for fix', async () => {
    const res = await client.query(
      `SELECT id, email, is_anonymous
       FROM "user"
       WHERE id = $1
       LIMIT 1`,
      [userId]
    )
    return res.rows[0] as any | undefined
  })
  if (!userRow) {
    console.error('❌ User not found:', userId)
    process.exit(2)
  }

  const existingOwnerCount = await timed('check existing owner membership count', async () => {
    const res = await client.query(
      `SELECT COUNT(*)::int as owner_count
       FROM "member"
       WHERE organization_id = $1 AND role = 'owner'`,
      [orgId]
    )
    return (res.rows[0]?.owner_count as number) ?? 0
  })
  if (existingOwnerCount > 0) {
    console.log('✅ Org already has an owner membership; no action needed.', { orgId, owner_count: existingOwnerCount })
    return
  }

  const existingMembership = await timed('check existing membership for user+org', async () => {
    const res = await client.query(
      `SELECT id, role, created_at
       FROM "member"
       WHERE organization_id = $1 AND user_id = $2
       LIMIT 1`,
      [orgId, userId]
    )
    return res.rows[0] as any | undefined
  })
  if (existingMembership) {
    console.log('⚠️ User already has a membership in this org; promoting to owner is not implemented by this fix.', {
      orgId,
      userId,
      membership: existingMembership
    })
    console.log('   If you want, we can add a safe promotion path too (UPDATE member SET role=\'owner\').')
    return
  }

  if (!args.apply) {
    console.error('❌ Refusing to write without --apply')
    console.error('   Would insert owner membership:', { orgId, userId, userEmail: userRow.email, orgSlug: orgRow.slug })
    process.exit(2)
  }

  await client.query('BEGIN')
  try {
    const memberId = generateId()
    await timed('insert member(owner)', async () => {
      await client.query(
        `INSERT INTO "member" (id, organization_id, user_id, role, created_at)
         VALUES ($1, $2, $3, 'owner', NOW())`,
        [memberId, orgId, userId]
      )
    })
    await client.query('COMMIT')
    console.log('✅ Inserted owner membership:', { memberId, orgId, userId })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}

async function printExplainRows(rows: Array<{ [k: string]: any }>) {
  const lines: string[] = []
  for (const r of rows) {
    const line = r['QUERY PLAN'] ?? r.query_plan ?? Object.values(r)[0]
    if (typeof line === 'string') {
      lines.push(line)
    }
  }
  console.log(lines.join('\n'))
}

function parseStatementTimeoutMs(
  input: unknown,
  {
    defaultMs = 30_000,
    maxMs = 600_000
  }: { defaultMs?: number, maxMs?: number } = {}
) {
  const n = input === undefined || input === null || input === '' ? defaultMs : Number(input)
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid statementTimeoutMs: ${String(input)}`)
  }
  const int = Math.trunc(n)
  if (int < 0) {
    throw new Error(`statementTimeoutMs must be >= 0 (got ${int})`)
  }
  if (int > maxMs) {
    throw new Error(`statementTimeoutMs too large (max ${maxMs}ms, got ${int})`)
  }
  return int
}

async function runDiagnostics(client: pg.PoolClient, args: Args) {
  const timeoutMs = parseStatementTimeoutMs(args.statementTimeoutMs)
  await timed(`set statement_timeout=${timeoutMs}ms`, async () => {
    // Use set_config so the value is fully parameterized (no SQL concatenation).
    // statement_timeout accepts a numeric string in milliseconds.
    await client.query(`SELECT set_config('statement_timeout', $1, true);`, [String(timeoutMs)])
  })

  if (args.statActivity) {
    printSection('pg_stat_activity (top 50, current DB)')
    const activity = await timed('select pg_stat_activity', async () => {
      const res = await client.query(
        `SELECT
           pid,
           usename,
           application_name,
           client_addr,
           state,
           wait_event_type,
           wait_event,
           now() - query_start as query_age,
           now() - xact_start as xact_age,
           LEFT(query, 200) as query
         FROM pg_stat_activity
         WHERE datname = current_database()
         ORDER BY query_start DESC NULLS LAST
         LIMIT 50`
      )
      return res.rows as any[]
    })
    console.table(activity)
  }

  if (args.locks) {
    printSection('Locks (waiting first, top 50)')
    const locks = await timed('select waiting locks', async () => {
      const res = await client.query(
        `SELECT
           a.pid,
           a.usename,
           a.state,
           a.wait_event_type,
           a.wait_event,
           now() - a.query_start as query_age,
           l.locktype,
           l.mode,
           l.granted,
           LEFT(a.query, 160) as query
         FROM pg_locks l
         JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE a.datname = current_database()
         ORDER BY l.granted ASC, a.query_start DESC NULLS LAST
         LIMIT 50`
      )
      return res.rows as any[]
    })
    console.table(locks)
  }

  if (args.explainConversations) {
    printSection('EXPLAIN (ANALYZE, BUFFERS): conversations list query')

    let orgId = args.orgId
    if (!orgId) {
      const guess = await timed('pick orgId from most recent conversation', async () => {
        const res = await client.query(
          `SELECT organization_id
           FROM "conversation"
           WHERE organization_id IS NOT NULL AND organization_id <> ''
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
           LIMIT 1`
        )
        return res.rows[0]?.organization_id as string | undefined
      })
      orgId = guess
    }

    if (!orgId) {
      console.error('❌ Cannot EXPLAIN conversations: no --orgId provided and no conversations found to infer one.')
    } else {
      console.log('Using organization_id:', orgId)
      const explain = await timed('explain conversations query', async () => {
        const res = await client.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT c.id, c.updated_at, NULLIF(c.metadata->>'title', '') as title
           FROM "conversation" c
           WHERE c.organization_id = $1
           ORDER BY c.updated_at DESC, c.id DESC
           LIMIT $2`,
          [orgId, 41]
        )
        return res.rows as any[]
      })
      await printExplainRows(explain)
    }
  }

  if (args.explainVerification) {
    printSection('EXPLAIN (ANALYZE, BUFFERS): verification lookup query')

    let identifier = args.verificationIdentifier
    if (!identifier) {
      const guess = await timed('pick identifier from most recent verification row', async () => {
        const res = await client.query(
          `SELECT identifier
           FROM "verification"
           ORDER BY created_at DESC
           LIMIT 1`
        )
        return res.rows[0]?.identifier as string | undefined
      })
      identifier = guess
    }

    if (!identifier) {
      console.error('❌ Cannot EXPLAIN verification: no --verificationIdentifier provided and no verification rows found.')
    } else {
      console.log('Using identifier:', identifier)
      const explain = await timed('explain verification query', async () => {
        const res = await client.query(
          `EXPLAIN (ANALYZE, BUFFERS)
           SELECT id, identifier, value, expires_at, created_at, updated_at
           FROM "verification"
           WHERE identifier = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [identifier]
        )
        return res.rows as any[]
      })
      await printExplainRows(explain)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  assertDatabaseUrl()

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()

  try {
    if (args.statActivity || args.locks || args.explainConversations || args.explainVerification) {
      await runDiagnostics(client, args)
    }

    if (args.fixOrgOwner) {
      await fixOrphanAnonymousOrgOwner(client, args)
      printSection('Done')
      console.log('Fix complete.')
      return
    }

    if (args.scan) {
      await runScan(client, args.scanLimit ?? 50)
      printSection('Done')
      console.log('Scan complete. Fix dangling default_organization_id / active_organization_id to unblock org resolution.')
      return
    }

    if (args.orgId && !args.userId && !args.sessionToken) {
      await inspectOrg(client, args.orgId)
      if (args.orgDeep) {
        printSection('Org deep inspection: conversation message + log summaries (last 20 convs)')
        const summaries = await timed('summarize messages/logs by conversation', async () => {
          const res = await client.query(
            `WITH recent_convs AS (
               SELECT id
               FROM "conversation"
               WHERE organization_id = $1
               ORDER BY updated_at DESC NULLS LAST, created_at DESC
               LIMIT 20
             ),
             msg_counts AS (
               SELECT
                 cm.conversation_id,
                 COUNT(*)::int as message_count,
                 COUNT(*) FILTER (WHERE cm.role = 'user')::int as user_message_count,
                 COUNT(*) FILTER (WHERE cm.role = 'assistant')::int as assistant_message_count,
                 MAX(cm.created_at) as last_message_at
               FROM "conversation_message" cm
               WHERE cm.conversation_id IN (SELECT id FROM recent_convs)
               GROUP BY cm.conversation_id
             ),
             log_counts AS (
               SELECT
                 cl.conversation_id,
                 COUNT(*)::int as log_count,
                 MAX(cl.created_at) as last_log_at
               FROM "conversation_log" cl
               WHERE cl.conversation_id IN (SELECT id FROM recent_convs)
               GROUP BY cl.conversation_id
             )
             SELECT
               c.id as conversation_id,
               c.created_by_user_id,
               c.status,
               c.updated_at,
               COALESCE(mc.message_count, 0) as message_count,
               COALESCE(mc.user_message_count, 0) as user_message_count,
               COALESCE(mc.assistant_message_count, 0) as assistant_message_count,
               mc.last_message_at,
               COALESCE(lc.log_count, 0) as log_count,
               lc.last_log_at
             FROM "conversation" c
             LEFT JOIN msg_counts mc ON mc.conversation_id = c.id
             LEFT JOIN log_counts lc ON lc.conversation_id = c.id
             WHERE c.organization_id = $1
               AND c.id IN (SELECT id FROM recent_convs)
             ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC`,
            [args.orgId]
          )
          return res.rows as any[]
        })
        console.table(summaries)
      }
      printSection('Done')
      console.log('Org inspection complete.')
      return
    }

    if (args.conversationId && !args.userId && !args.sessionToken && !args.orgId) {
      await inspectConversation(client, args.conversationId, !!args.conversationDeep)
      printSection('Done')
      console.log('Conversation inspection complete.')
      return
    }

    if (!args.userId && !args.sessionToken) {
      printHelpAndExit(1)
    }

    let userId = args.userId

    if (!userId && args.sessionToken) {
      printSection('Resolve userId from session token')
      const sessionRow = await timed('select session by token', async () => {
        const res = await client.query(
          `SELECT id, token, user_id, active_organization_id, expires_at, created_at, updated_at
           FROM "session"
           WHERE token = $1
           LIMIT 1`,
          [args.sessionToken]
        )
        return res.rows[0] as any | undefined
      })

      if (!sessionRow) {
        console.error('❌ No session row found for provided --sessionToken')
        process.exit(1)
      }

      userId = sessionRow.user_id
      console.log({ session: { ...sessionRow, token: maskToken(sessionRow.token) } })
    }

    if (!userId) {
      console.error('❌ Could not resolve userId')
      process.exit(1)
    }

    printSection('User')
    const userRow = await timed('select user', async () => {
      const res = await client.query(
        `SELECT id, email, name, is_anonymous, default_organization_id, created_at, updated_at
         FROM "user"
         WHERE id = $1
         LIMIT 1`,
        [userId]
      )
      return res.rows[0] as any | undefined
    })

    if (!userRow) {
      console.error('❌ No user row found for userId', userId)
      process.exit(1)
    }

    console.log({ user: userRow })

    const relevantOrgIds = new Set<string>()
    if (userRow.default_organization_id) {
      relevantOrgIds.add(String(userRow.default_organization_id))
    }
    if (args.orgId) {
      relevantOrgIds.add(args.orgId)
    }

    printSection('Recent sessions (most recent first)')
    const sessions = await timed('select sessions by user_id', async () => {
      const res = await client.query(
        `SELECT id, token, user_id, active_organization_id, expires_at, created_at, updated_at
         FROM "session"
         WHERE user_id = $1
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 10`,
        [userId]
      )
      return res.rows as any[]
    })

    if (sessions.length === 0) {
      console.warn('⚠️  No rows found in "session" table for this userId. If you are using cookie-only sessions or sessions are pruned, use --scan or pass an active --sessionToken.')
    }

    for (const s of sessions) {
      if (s.active_organization_id) {
        relevantOrgIds.add(String(s.active_organization_id))
      }
    }

    console.table(sessions.map(s => ({
      id: s.id,
      expires_at: s.expires_at,
      updated_at: s.updated_at,
      active_organization_id: s.active_organization_id,
      token_preview: typeof s.token === 'string' ? `${s.token.slice(0, 8)}…` : null
    })))

    printSection('Memberships')
    const memberships = await timed('select members joined to org', async () => {
      const res = await client.query(
        `SELECT m.id as member_id, m.role, m.created_at as member_created_at,
                o.id as organization_id, o.slug, o.name, o.is_anonymous as organization_is_anonymous
         FROM "member" m
         JOIN "organization" o ON o.id = m.organization_id
         WHERE m.user_id = $1
         ORDER BY m.created_at ASC`,
        [userId]
      )
      return res.rows as any[]
    })

    memberships.forEach(m => relevantOrgIds.add(String(m.organization_id)))

    console.table(memberships.map(m => ({
      organization_id: m.organization_id,
      slug: m.slug,
      name: m.name,
      role: m.role,
      org_is_anonymous: m.organization_is_anonymous,
      member_created_at: m.member_created_at
    })))

    if (relevantOrgIds.size > 0) {
      printSection('Organizations (for all referenced org IDs)')
      const orgIds = Array.from(relevantOrgIds)

      const orgs = await timed('select organizations by ids', async () => {
        const res = await client.query(
          `SELECT id, slug, name, is_anonymous, created_at
           FROM "organization"
           WHERE id = ANY($1::text[])`,
          [orgIds]
        )
        return res.rows as any[]
      })

      const orgById = new Map(orgs.map(o => [String(o.id), o]))

      console.table(orgIds.map((id) => {
        const o = orgById.get(id)
        return {
          id,
          exists: !!o,
          slug: o?.slug ?? null,
          name: o?.name ?? null,
          is_anonymous: o?.is_anonymous ?? null
        }
      }))

      const defaultOrgId = userRow.default_organization_id ? String(userRow.default_organization_id) : null
      if (defaultOrgId && !orgById.get(defaultOrgId)) {
        console.error('\n❌ Dangling default_organization_id detected on user:', {
          userId,
          default_organization_id: defaultOrgId
        })
        console.error('   This will break use-active-organization and can stall /api/chat follow-ups.')
      }

      if (args.fixDefaultOrg || args.fixActiveOrg) {
        if (!args.apply) {
          console.error('\n❌ Refusing to write without --apply')
          console.error('   Re-run with --apply to perform updates.')
          process.exit(2)
        }

        if (args.fixDefaultOrg && !orgById.get(args.fixDefaultOrg)) {
          console.error('❌ --fixDefaultOrg orgId does not exist in organization table:', args.fixDefaultOrg)
          process.exit(2)
        }
        if (args.fixActiveOrg && !orgById.get(args.fixActiveOrg)) {
          console.error('❌ --fixActiveOrg orgId does not exist in organization table:', args.fixActiveOrg)
          process.exit(2)
        }
        if (args.fixActiveOrg && !args.sessionToken) {
          console.error('❌ --fixActiveOrg requires --sessionToken (so we know which session row to update)')
          process.exit(2)
        }

        printSection('Apply fixes (transaction)')
        await client.query('BEGIN')
        try {
          if (args.fixDefaultOrg) {
            await timed('update user.default_organization_id', async () => {
              await client.query(
                `UPDATE "user"
                 SET default_organization_id = $1
                 WHERE id = $2`,
                [args.fixDefaultOrg, userId]
              )
            })
            console.log('✅ Updated user.default_organization_id', { userId, default_organization_id: args.fixDefaultOrg })
          }

          if (args.fixActiveOrg) {
            await timed('update session.active_organization_id', async () => {
              await client.query(
                `UPDATE "session"
                 SET active_organization_id = $1
                 WHERE token = $2`,
                [args.fixActiveOrg, args.sessionToken]
              )
            })
            console.log('✅ Updated session.active_organization_id', { token: `${args.sessionToken.slice(0, 8)}…`, active_organization_id: args.fixActiveOrg })
          }

          await client.query('COMMIT')
        } catch (e) {
          await client.query('ROLLBACK')
          throw e
        }
      }

      // Chat persistence quick sanity: show recent conversations for any org we have
      printSection('Recent conversations (by referenced orgs)')
      const convs = await timed('select latest conversations', async () => {
        const res = await client.query(
          `SELECT id, organization_id, created_by_user_id, status, created_at, updated_at
           FROM "conversation"
           WHERE organization_id = ANY($1::text[])
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
           LIMIT 20`,
          [orgIds]
        )
        return res.rows as any[]
      })

      console.table(convs.map(c => ({
        id: c.id,
        organization_id: c.organization_id,
        created_by_user_id: c.created_by_user_id,
        status: c.status,
        updated_at: c.updated_at,
        created_at: c.created_at
      })))
    }

    printSection('Done')
    console.log('If default_organization_id was dangling, fix it (or recreate the org) and retry /api/auth/organization/use-active-organization.')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
