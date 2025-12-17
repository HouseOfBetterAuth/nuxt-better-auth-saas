import { getServerAuth } from '~~/server/utils/auth'

export default defineEventHandler((event) => {
  const serverAuth = getServerAuth()
  return serverAuth.handler(toWebRequest(event))
})
