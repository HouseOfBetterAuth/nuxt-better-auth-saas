import type { file, user } from '~~/server/database/schema'

export type User = typeof user.$inferSelect
export type FileRecord = typeof file.$inferSelect

export type ChatRole = 'user' | 'assistant'

export type NonEmptyArray<T> = [T, ...T[]]

export interface ChatMessage {
  id: string
  role: ChatRole
  parts: NonEmptyArray<{ type: 'text', text: string }>
  createdAt: Date
  payload?: Record<string, any> | null
}

export interface ChatLogEntry {
  id: string
  type: string
  message: string
  payload?: Record<string, any> | null
  createdAt: Date
}

export interface ChatActionSuggestion {
  type: 'suggest_generate_from_source'
  sourceContentId?: string | null
  sourceType?: string
  label?: string
}

export interface ChatSourceSnapshot {
  id: string
  sourceType: string
  ingestStatus: string
  title: string | null
  originalUrl?: string | null
  createdAt: Date
}

export interface ChatGenerationResult {
  content: Record<string, any>
  version: Record<string, any>
  markdown: string
  meta: Record<string, any>
}
