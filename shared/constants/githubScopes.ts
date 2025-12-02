export const GITHUB_BASE_SCOPES = [
  'read:user',
  'user:email'
] as const

const GITHUB_REPO_CORE_SCOPES = [
  'repo'
] as const

export const GITHUB_INTEGRATION_SCOPES = {
  github: [...GITHUB_BASE_SCOPES, ...GITHUB_REPO_CORE_SCOPES]
} as const

export const GITHUB_INTEGRATION_MATCH_SCOPES = {
  github: [...GITHUB_REPO_CORE_SCOPES]
} as const

export type GithubIntegrationProvider = keyof typeof GITHUB_INTEGRATION_SCOPES
