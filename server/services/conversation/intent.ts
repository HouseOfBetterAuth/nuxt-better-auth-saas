import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import type {
  ConversationIntentSnapshot,
  IntentField,
  IntentGap,
  IntentOrchestratorAction,
  IntentReadinessState,
  IntentRequirementField,
  IntentSnapshotUpdate
} from '~~/shared/utils/intent'
import { callChatCompletions } from '~~/server/utils/aiGateway'
import {
  DEFAULT_CLARIFYING_QUESTIONS,
  REQUIRED_INTENT_FIELDS
} from '~~/shared/utils/intent'

type ArrayField = IntentField<string[]>
type StringField = IntentField<string | null>

interface IntentExtractionResponse {
  topic?: string | null
  goal?: string | null
  audience?: string | null
  format?: string | null
  tone?: string | null
  mustInclude?: string[] | string | null
  constraints?: string[] | string | null
  clarifyingQuestions?: Array<{ field?: string, question: string }>
  notes?: string | null
}

export interface IntentOrchestratorResult {
  snapshot: ConversationIntentSnapshot
  action: IntentOrchestratorAction
  clarifyingQuestions: IntentGap[]
}

const INTENT_EXTRACTION_SYSTEM_PROMPT = `You analyze chat conversations to understand content-writing intent.

Return ONLY valid JSON that matches this schema:
{
  "topic": "string|null",
  "goal": "string|null",
  "audience": "string|null",
  "format": "string|null",
  "tone": "string|null",
  "mustInclude": ["string"],
  "constraints": ["string"],
  "clarifyingQuestions": [{"field": "<topic|goal|audience|format>", "question": "string"}],
  "notes": "string|null"
}

- Use null when information is missing.
- keep clarifyingQuestions short and actionable.
- Never include markdown or prose outside the JSON.`

const INTENT_EXTRACTION_USER_PROMPT = (transcript: string) => `Conversation transcript:
${transcript}

Extract the intent summary as JSON using the schema from the system prompt.`

function normalizeText(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed || null
}

function normalizeStringList(value?: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map(item => normalizeText(item) ?? '').filter(Boolean))]
  }

  if (typeof value === 'string') {
    const normalized = normalizeText(value)
    return normalized ? [normalized] : []
  }

  return []
}

function createStringField(initial?: StringField): StringField {
  return initial
    ? { ...initial }
    : { value: null, confidence: 'unknown', sourceMessageIds: [] }
}

function createArrayField(initial?: ArrayField): ArrayField {
  return initial
    ? { ...initial, value: [...initial.value] }
    : { value: [], confidence: 'unknown', sourceMessageIds: [] }
}

function mergeStringField(field: StringField, value: string | null, sourceMessageIds: string[] = []): StringField {
  if (value) {
    return {
      ...field,
      value,
      confidence: 'high',
      sourceMessageIds: Array.from(new Set([...(field.sourceMessageIds || []), ...sourceMessageIds]))
    }
  }
  return field
}

function mergeArrayField(field: ArrayField, values: string[], sourceMessageIds: string[] = []): ArrayField {
  if (!values.length) {
    return field
  }
  const merged = Array.from(new Set([...field.value, ...values]))
  return {
    ...field,
    value: merged,
    confidence: 'high',
    sourceMessageIds: Array.from(new Set([...(field.sourceMessageIds || []), ...sourceMessageIds]))
  }
}

function buildTranscript(messages: ChatCompletionMessage[]): string {
  return messages
    .map((message) => {
      const prefix = message.role.toUpperCase()
      return `${prefix}: ${message.content ?? ''}`.trim()
    })
    .filter(Boolean)
    .join('\n\n')
}

const collectUserMessageIds = (messages: ChatCompletionMessage[]): string[] => {
  const ids: string[] = []

  messages.forEach((message, index) => {
    if (message.role !== 'user') {
      return
    }

    let messageId: string | null = null
    if (typeof (message as any).id === 'string') {
      messageId = (message as any).id
    } else if (typeof (message as any).messageId === 'string') {
      messageId = (message as any).messageId
    } else {
      messageId = `user-${index}`
    }

    if (messageId) {
      ids.push(messageId)
    }
  })

  return ids
}

function extractJsonPayload(text: string): IntentExtractionResponse | null {
  const trimmed = text.trim()
  const withoutFences = trimmed.startsWith('```')
    ? trimmed.replace(/```json|```/gi, '').trim()
    : trimmed

  try {
    return JSON.parse(withoutFences)
  } catch {
    const jsonMatch = withoutFences.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return null
    }
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      return null
    }
  }
}

function createBaseSnapshot(previous?: ConversationIntentSnapshot | null): ConversationIntentSnapshot {
  const now = new Date().toISOString()

  return {
    version: (previous?.version ?? 0) + 1,
    readiness: 'collecting',
    updatedAt: now,
    notes: previous?.notes ?? null,
    fields: {
      topic: createStringField(previous?.fields.topic),
      goal: createStringField(previous?.fields.goal),
      audience: createStringField(previous?.fields.audience),
      format: createStringField(previous?.fields.format),
      tone: createStringField(previous?.fields.tone),
      mustInclude: createArrayField(previous?.fields.mustInclude),
      constraints: createArrayField(previous?.fields.constraints)
    },
    missing: previous?.missing ?? []
  }
}

function computeReadiness(
  snapshot: ConversationIntentSnapshot,
  previousSnapshot?: ConversationIntentSnapshot | null
): IntentReadinessState {
  const filledRequiredFields = REQUIRED_INTENT_FIELDS.filter((field) => {
    const value = snapshot.fields[field].value
    if (Array.isArray(value)) {
      return value.length > 0
    }
    return Boolean(value)
  })

  const requiredMissing = REQUIRED_INTENT_FIELDS.filter((field) => {
    const fieldValue = snapshot.fields[field].value
    return !fieldValue || (Array.isArray(fieldValue) && fieldValue.length === 0)
  })

  if (filledRequiredFields.length === 0) {
    return 'collecting'
  }

  if (requiredMissing.length > 0) {
    return 'needs_clarification'
  }

  const previousReady = previousSnapshot?.readiness
  if (previousReady === 'ready_to_plan' || previousReady === 'ready_to_generate') {
    return 'ready_to_generate'
  }

  return 'ready_to_plan'
}

function resolveClarifyingQuestions(
  responseQuestions: IntentExtractionResponse['clarifyingQuestions']
): IntentGap[] {
  if (!Array.isArray(responseQuestions)) {
    return []
  }

  return responseQuestions
    .map((question) => {
      const field = (question.field || '').trim().toLowerCase()
      if (!field) {
        return null
      }
      if (!REQUIRED_INTENT_FIELDS.includes(field as IntentRequirementField)) {
        return null
      }
      return {
        field: field as IntentRequirementField,
        question: question.question?.trim() || DEFAULT_CLARIFYING_QUESTIONS[field as IntentRequirementField]
      }
    })
    .filter((item): item is IntentGap => Boolean(item))
}

function fillMissingQuestions(readiness: IntentReadinessState, clarifying: IntentGap[]): IntentGap[] {
  if (readiness !== 'needs_clarification') {
    return []
  }

  const gapsByField = new Map<IntentRequirementField, IntentGap>()
  for (const gap of clarifying) {
    gapsByField.set(gap.field, gap)
  }

  for (const field of REQUIRED_INTENT_FIELDS) {
    if (!gapsByField.has(field)) {
      gapsByField.set(field, {
        field,
        question: DEFAULT_CLARIFYING_QUESTIONS[field]
      })
    }
  }

  return Array.from(gapsByField.values())
}

export function createEmptyIntentSnapshot(): ConversationIntentSnapshot {
  const now = new Date().toISOString()

  return {
    version: 1,
    readiness: 'collecting',
    updatedAt: now,
    notes: null,
    fields: {
      topic: { value: null, confidence: 'unknown', sourceMessageIds: [] },
      goal: { value: null, confidence: 'unknown', sourceMessageIds: [] },
      audience: { value: null, confidence: 'unknown', sourceMessageIds: [] },
      format: { value: null, confidence: 'unknown', sourceMessageIds: [] },
      tone: { value: null, confidence: 'unknown', sourceMessageIds: [] },
      mustInclude: { value: [], confidence: 'unknown', sourceMessageIds: [] },
      constraints: { value: [], confidence: 'unknown', sourceMessageIds: [] }
    },
    missing: REQUIRED_INTENT_FIELDS.map(field => ({
      field,
      question: DEFAULT_CLARIFYING_QUESTIONS[field]
    }))
  }
}

export async function deriveIntentSnapshotFromConversation(options: {
  conversationHistory: ChatCompletionMessage[]
  previousSnapshot?: ConversationIntentSnapshot | null
}): Promise<ConversationIntentSnapshot> {
  const { conversationHistory, previousSnapshot } = options

  if (!conversationHistory.length) {
    return previousSnapshot ?? createEmptyIntentSnapshot()
  }

  const transcript = buildTranscript(conversationHistory)
  if (!transcript.trim()) {
    return previousSnapshot ?? createEmptyIntentSnapshot()
  }

  let response: string
  try {
    response = await callChatCompletions({
      temperature: 0.2,
      maxTokens: 600,
      messages: [
        { role: 'system', content: INTENT_EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: INTENT_EXTRACTION_USER_PROMPT(transcript) }
      ]
    })
  } catch (error) {
    console.error('[deriveIntentSnapshotFromConversation] Failed to extract intent:', error)
    return previousSnapshot ?? createEmptyIntentSnapshot()
  }

  const parsed = extractJsonPayload(response) ?? {}

  const normalized: IntentSnapshotUpdate = {
    topic: normalizeText(parsed.topic),
    goal: normalizeText(parsed.goal),
    audience: normalizeText(parsed.audience),
    format: normalizeText(parsed.format),
    tone: normalizeText(parsed.tone),
    mustInclude: normalizeStringList(parsed.mustInclude),
    constraints: normalizeStringList(parsed.constraints),
    clarifyingQuestions: resolveClarifyingQuestions(parsed.clarifyingQuestions),
    notes: normalizeText(parsed.notes)
  }

  const snapshot = createBaseSnapshot(previousSnapshot)
  const userMessageIds = collectUserMessageIds(conversationHistory)

  snapshot.fields.topic = mergeStringField(snapshot.fields.topic, normalized.topic ?? null, userMessageIds)
  snapshot.fields.goal = mergeStringField(snapshot.fields.goal, normalized.goal ?? null, userMessageIds)
  snapshot.fields.audience = mergeStringField(snapshot.fields.audience, normalized.audience ?? null, userMessageIds)
  snapshot.fields.format = mergeStringField(snapshot.fields.format, normalized.format ?? null, userMessageIds)
  snapshot.fields.tone = mergeStringField(snapshot.fields.tone, normalized.tone ?? null, userMessageIds)
  snapshot.fields.mustInclude = mergeArrayField(snapshot.fields.mustInclude, normalized.mustInclude || [], userMessageIds)
  snapshot.fields.constraints = mergeArrayField(snapshot.fields.constraints, normalized.constraints || [], userMessageIds)
  snapshot.notes = normalized.notes ?? snapshot.notes ?? null

  const readiness = computeReadiness(snapshot, previousSnapshot)
  snapshot.readiness = readiness
  snapshot.missing = fillMissingQuestions(readiness, normalized.clarifyingQuestions || [])

  return snapshot
}

export async function orchestrateConversationIntent(options: {
  conversationHistory: ChatCompletionMessage[]
  previousSnapshot?: ConversationIntentSnapshot | null
}): Promise<IntentOrchestratorResult> {
  const snapshot = await deriveIntentSnapshotFromConversation(options)

  let action: IntentOrchestratorAction = 'clarify'
  if (snapshot.readiness === 'ready_to_plan') {
    action = 'plan'
  }

  if (snapshot.readiness === 'ready_to_generate') {
    action = 'generate'
  }

  return {
    snapshot,
    action,
    clarifyingQuestions: snapshot.missing
  }
}
