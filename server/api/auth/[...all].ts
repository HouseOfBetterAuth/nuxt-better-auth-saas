import { useServerAuth } from '~~/server/utils/auth'

export default defineEventHandler((event) => {
  const serverAuth = useServerAuth()
  return serverAuth.handler(toWebRequest(event))
})
