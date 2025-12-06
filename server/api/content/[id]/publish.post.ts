import type { PublishContentRequestBody } from '~~/server/types/content'
import { getRouterParams, readBody } from 'h3'
import { publishContentVersion } from '~~/server/services/content/publish'
import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateOptionalUUID, validateRequestBody, validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)

  const { id } = getRouterParams(event)
  const contentId = validateUUID(id, 'id')
  const body = await readBody<PublishContentRequestBody>(event)

  validateRequestBody(body)

  const versionId = body.versionId ? validateOptionalUUID(body.versionId, 'versionId') : null

  const result = await publishContentVersion(db, {
    organizationId,
    contentId,
    versionId,
    userId: user.id
  })

  return {
    content: result.content,
    version: result.version,
    file: result.file,
    publication: result.publication,
    filePayload: result.filePayload
  }
})
