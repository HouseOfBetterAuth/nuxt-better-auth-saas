import type { file, user } from '~~/server/database/schema'

export type User = typeof user.$inferSelect
export type FileRecord = typeof file.$inferSelect

export type ChatRole = 'user' | 'assistant'

export type NonEmptyArray<T> = [T, ...T[]]

export type MessagePart =
  | { type: 'text', text: string }
  | {
    type: 'tool_call'
    toolName: string
    status: 'running' | 'success' | 'error'
    args?: Record<string, any>
    result?: any
    error?: string
    timestamp?: string
  }

export interface ChatMessage {
  id: string
  role: ChatRole
  parts: NonEmptyArray<MessagePart>
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
