import type { NonEmptyArray } from './types'

export type IntentRequirementField = 'topic' | 'goal' | 'audience' | 'format'

export const REQUIRED_INTENT_FIELDS: IntentRequirementField[] = ['topic', 'goal', 'audience', 'format']

export type IntentFieldConfidence = 'unknown' | 'low' | 'medium' | 'high'

export interface IntentField<TValue> {
  value: TValue
  confidence: IntentFieldConfidence
  sourceMessageIds: string[]
  summary?: string | null
}

export interface IntentGap {
  field: IntentRequirementField
  question: string
}

export type IntentReadinessState = 'collecting' | 'needs_clarification' | 'ready_to_plan' | 'ready_to_generate'

export interface ConversationIntentFields {
  topic: IntentField<string | null>
  goal: IntentField<string | null>
  audience: IntentField<string | null>
  format: IntentField<string | null>
  tone: IntentField<string | null>
  mustInclude: IntentField<string[]>
  constraints: IntentField<string[]>
}

export interface ConversationIntentSnapshot {
  version: number
  readiness: IntentReadinessState
  updatedAt: string
  fields: ConversationIntentFields
  missing: IntentGap[]
  notes?: string | null
}

export const DEFAULT_CLARIFYING_QUESTIONS: Record<IntentRequirementField, string> = {
  topic: 'What is the main topic or subject you want to cover?',
  goal: 'What outcome should this content drive (e.g., educate, convert, entertain)?',
  audience: 'Who is the primary audience or reader for this content?',
  format: 'What content format do you want (blog post, email, landing page, etc.)?'
}

export interface IntentClarifyingQuestion {
  field: IntentRequirementField
  question: string
}

export type IntentOrchestratorAction = 'clarify' | 'plan' | 'generate'

export interface IntentSnapshotUpdate {
  topic?: string | null
  goal?: string | null
  audience?: string | null
  format?: string | null
  tone?: string | null
  mustInclude?: NonEmptyArray<string> | string[] | null
  constraints?: NonEmptyArray<string> | string[] | null
  clarifyingQuestions?: IntentClarifyingQuestion[]
  notes?: string | null
}
