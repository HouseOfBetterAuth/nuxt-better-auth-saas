export const GOOGLE_USERINFO_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
] as const

const GOOGLE_YOUTUBE_CORE_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl'
] as const

const GOOGLE_DRIVE_CORE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly'
] as const

export const GOOGLE_INTEGRATION_SCOPES = {
  youtube: [...GOOGLE_USERINFO_SCOPES, ...GOOGLE_YOUTUBE_CORE_SCOPES],
  google_drive: [...GOOGLE_USERINFO_SCOPES, ...GOOGLE_DRIVE_CORE_SCOPES]
} as const

export const GOOGLE_INTEGRATION_MATCH_SCOPES = {
  youtube: [...GOOGLE_YOUTUBE_CORE_SCOPES],
  google_drive: [...GOOGLE_DRIVE_CORE_SCOPES]
} as const

export type GoogleIntegrationProvider = keyof typeof GOOGLE_INTEGRATION_SCOPES
