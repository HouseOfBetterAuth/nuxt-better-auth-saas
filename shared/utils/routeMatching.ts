export type LocaleCode = string

function normalizeLocaleCodes(locales: readonly LocaleCode[]): string[] {
  return locales
    .map(l => (typeof l === 'string' ? l.trim() : ''))
    .filter(Boolean)
}

/**
 * Strips a leading locale prefix from a URL path if the first segment matches one
 * of the provided locale codes.
 *
 * Examples:
 * - stripLocalePrefix('/en/foo', ['en']) => '/foo'
 * - stripLocalePrefix('/en-US/foo', ['en-US']) => '/foo'
 * - stripLocalePrefix('/foo', ['en']) => '/foo'
 */
export function stripLocalePrefix(path: string, locales: readonly LocaleCode[]): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const [firstSegment] = normalizedPath.split('/').filter(Boolean)
  if (!firstSegment)
    return normalizedPath

  const localeCodes = normalizeLocaleCodes(locales)
  if (!localeCodes.includes(firstSegment))
    return normalizedPath

  const remaining = normalizedPath.slice(`/${firstSegment}`.length)
  return remaining.startsWith('/') ? remaining : `/${remaining}`
}

/**
 * Returns true if the path (optionally locale-prefixed) matches:
 *   /anonymous-[...]/conversations
 */
export function isAnonymousWorkspaceConversationRoute(path: string, locales: readonly LocaleCode[]): boolean {
  const pathWithoutLocale = stripLocalePrefix(path, locales)
  const convoMatch = pathWithoutLocale.match(/^\/([^/]+)\/conversations(?:\/|$)/)
  return Boolean(convoMatch?.[1]?.startsWith('anonymous-'))
}
