import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { CreateIntegrationInput, IntegrationCapabilities, UpdateIntegrationInput } from '~~/server/types/integration'

import { and, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { GITHUB_INTEGRATION_MATCH_SCOPES } from '~~/shared/constants/githubScopes'
import { GOOGLE_INTEGRATION_MATCH_SCOPES } from '~~/shared/constants/googleScopes'
import { getIntegrationAdapter } from './adapters'

const parseScopes = (scope: string | null | undefined): string[] =>
  scope?.split(/[, ]+/).map(scopeEntry => scopeEntry.trim()).filter(Boolean) ?? []

const hasRequiredScopes = (scopeList: string[], required: readonly string[]): boolean =>
  required.every(scopeEntry => scopeList.includes(scopeEntry))

const OAUTH_INTEGRATIONS: Array<{
  type: string
  providerId: string
  requiredScopes: readonly string[]
  name: string
  capabilities?: IntegrationCapabilities
}> = [
  {
    type: 'youtube',
    providerId: 'google',
    requiredScopes: GOOGLE_INTEGRATION_MATCH_SCOPES.youtube,
    name: 'YouTube',
    capabilities: { ingest: true }
  },
  {
    type: 'google_drive',
    providerId: 'google',
    requiredScopes: GOOGLE_INTEGRATION_MATCH_SCOPES.google_drive,
    name: 'Google Drive',
    capabilities: { ingest: true }
  },
  {
    type: 'github',
    providerId: 'github',
    requiredScopes: GITHUB_INTEGRATION_MATCH_SCOPES.github,
    name: 'GitHub',
    capabilities: { sync: true }
  }
]

export const assertIntegrationManager = async (
  db: NodePgDatabase<typeof schema>,
  userId: string,
  organizationId: string
) => {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(schema.member.organizationId, organizationId),
      eq(schema.member.userId, userId)
    )
  })

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Organization owner or admin access required'
    })
  }
}

export const listOrganizationIntegrations = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string
) => {
  return db
    .select()
    .from(schema.integration)
    .where(eq(schema.integration.organizationId, organizationId))
}

export const syncOrganizationOAuthIntegrations = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string
) => {
  const members = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId))

  if (members.length === 0) {
    return [] as typeof schema.integration.$inferSelect[]
  }

  const userIds = members.map(memberRecord => memberRecord.userId)

  const accounts = await db
    .select()
    .from(schema.account)
    .where(inArray(schema.account.userId, userIds))

  for (const account of accounts) {
    const scopes = parseScopes(account.scope)

    for (const integrationDef of OAUTH_INTEGRATIONS) {
      if (account.providerId !== integrationDef.providerId)
        continue

      if (!hasRequiredScopes(scopes, integrationDef.requiredScopes))
        continue

      await db
        .insert(schema.integration)
        .values({
          organizationId,
          type: integrationDef.type,
          name: integrationDef.name,
          authType: 'oauth',
          accountId: account.id,
          capabilities: integrationDef.capabilities ?? null,
          isActive: true
        })
        .onConflictDoNothing({
          target: [
            schema.integration.organizationId,
            schema.integration.type,
            schema.integration.accountId
          ]
        })
    }
  }

  return listOrganizationIntegrations(db, organizationId)
}

export const listOrganizationIntegrationsWithAccounts = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string
) => {
  const integrations = await listOrganizationIntegrations(db, organizationId)

  if (integrations.length === 0) {
    return [] as Array<typeof schema.integration.$inferSelect & {
      provider?: string
      status?: string
      scopes?: string | null
      connectedByUserId?: string | null
      connectedByUserName?: string | null
      connectedByUserEmail?: string | null
      expiresAt?: Date | null
    }>
  }

  const accountIds = integrations
    .map(integration => integration.accountId)
    .filter((id): id is string => Boolean(id))

  const accounts = accountIds.length
    ? await db
        .select()
        .from(schema.account)
        .where(inArray(schema.account.id, accountIds))
    : []

  const accountById = new Map(accounts.map(acc => [acc.id, acc]))
  const userIds = Array.from(new Set(accounts.map(acc => acc.userId)))

  const users = userIds.length
    ? await db
        .select({
          id: schema.user.id,
          name: schema.user.name,
          email: schema.user.email
        })
        .from(schema.user)
        .where(inArray(schema.user.id, userIds))
    : []

  const userById = new Map(users.map(user => [user.id, user]))
  const now = new Date()

  return integrations.map((integration) => {
    const account = integration.accountId ? accountById.get(integration.accountId) : null
    const connectedUser = account?.userId ? userById.get(account.userId) : null
    const isExpired = account?.accessTokenExpiresAt ? account.accessTokenExpiresAt < now : false

    const status = integration.authType === 'oauth'
      ? account
        ? (isExpired ? 'expired' : 'connected')
        : 'disconnected'
      : integration.isActive ? 'active' : 'inactive'

    return {
      ...integration,
      provider: integration.type,
      status,
      scopes: account?.scope ?? null,
      connectedByUserId: account?.userId ?? null,
      connectedByUserName: connectedUser?.name ?? null,
      connectedByUserEmail: connectedUser?.email ?? null,
      expiresAt: account?.accessTokenExpiresAt ?? null
    }
  })
}

export const getOrganizationIntegrationSyncMetadata = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string
) => {
  const organizationRecord = await db.query.organization.findFirst({
    columns: { lastSyncedAt: schema.organization.lastSyncedAt },
    where: eq(schema.organization.id, organizationId)
  })

  return organizationRecord?.lastSyncedAt ?? null
}

export const updateOrganizationIntegrationSyncMetadata = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  lastSyncedAt: Date
) => {
  await db
    .update(schema.organization)
    .set({ lastSyncedAt })
    .where(eq(schema.organization.id, organizationId))
}

export const getOrganizationIntegration = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  integrationId: string
) => {
  const [integration] = await db
    .select()
    .from(schema.integration)
    .where(and(
      eq(schema.integration.organizationId, organizationId),
      eq(schema.integration.id, integrationId)
    ))
    .limit(1)

  return integration ?? null
}

export const createOrganizationIntegration = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateIntegrationInput
) => {
  const [integration] = await db
    .insert(schema.integration)
    .values({
      organizationId,
      type: input.type,
      name: input.name,
      authType: input.authType,
      accountId: input.accountId ?? null,
      baseUrl: input.baseUrl ?? null,
      config: input.config ?? null,
      capabilities: input.capabilities ?? null,
      isActive: input.isActive ?? true
    })
    .returning()

  return integration
}

export const updateOrganizationIntegration = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  integrationId: string,
  input: UpdateIntegrationInput
) => {
  const updatePayload: Partial<typeof schema.integration.$inferInsert> = {}

  if (input.type !== undefined) {
    updatePayload.type = input.type
  }
  if (input.name !== undefined) {
    updatePayload.name = input.name
  }
  if (input.authType !== undefined) {
    updatePayload.authType = input.authType
  }
  if (input.accountId !== undefined) {
    updatePayload.accountId = input.accountId
  }
  if (input.baseUrl !== undefined) {
    updatePayload.baseUrl = input.baseUrl
  }
  if (input.config !== undefined) {
    updatePayload.config = input.config
  }
  if (input.capabilities !== undefined) {
    updatePayload.capabilities = input.capabilities
  }
  if (input.isActive !== undefined) {
    updatePayload.isActive = input.isActive
  }

  const [integration] = await db
    .update(schema.integration)
    .set({
      ...updatePayload,
      updatedAt: new Date()
    })
    .where(and(
      eq(schema.integration.organizationId, organizationId),
      eq(schema.integration.id, integrationId)
    ))
    .returning()

  return integration ?? null
}

export const deleteOrganizationIntegration = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  integrationId: string
) => {
  const deleted = await db
    .delete(schema.integration)
    .where(and(
      eq(schema.integration.organizationId, organizationId),
      eq(schema.integration.id, integrationId)
    ))
    .returning({ id: schema.integration.id })

  return deleted.length > 0
}

export const testOrganizationIntegration = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  integrationId: string,
  options?: { payload?: Record<string, any> }
) => {
  const integration = await getOrganizationIntegration(db, organizationId, integrationId)

  if (!integration) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Integration not found'
    })
  }

  const adapter = getIntegrationAdapter(integration.type)
  return adapter.testConnection(integration, { db }, options)
}
