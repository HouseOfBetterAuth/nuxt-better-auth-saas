const LOOPBACK_HOSTS = new Set(['localhost', '::1'])
const INVALID_PRODUCTION_HOSTS = new Set(['0.0.0.0'])
const IPV4_LOOPBACK_REGEX = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

const isInvalidProductionHostname = (hostname: string) => {
  return LOOPBACK_HOSTS.has(hostname) || INVALID_PRODUCTION_HOSTS.has(hostname) || IPV4_LOOPBACK_REGEX.test(hostname)
}

const assertValidProductionUrl = (value: string) => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`NUXT_APP_URL must be a valid absolute URL. Received: ${value}`)
  }

  if (isInvalidProductionHostname(parsed.hostname)) {
    throw new Error('NUXT_APP_URL cannot be a localhost/loopback/wildcard address in production.')
  }
}

export const getAppUrl = (): string => {
  const nodeEnv = process.env.NODE_ENV || 'development'

  if (nodeEnv === 'test') {
    return process.env.NUXT_TEST_APP_URL || 'http://localhost:3000'
  }

  if (nodeEnv === 'production') {
    // In production, use NUXT_APP_URL (should be https://getquillio.com)
    // Fallback to getquillio.com if not set (though it should always be set)
    const url = process.env.NUXT_APP_URL || 'https://getquillio.com'
    assertValidProductionUrl(url)
    return url
  }

  // In development, always use localhost:3000 regardless of NUXT_APP_URL
  // This ensures OAuth callbacks work correctly in local development
  return 'http://localhost:3000'
}
