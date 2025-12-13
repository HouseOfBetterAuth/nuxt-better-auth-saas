<script setup lang="ts">
import type { ChatMessage, MessagePart } from '#shared/utils/types'
import { computed, onMounted, ref, watch } from 'vue'
import ChatConversationMessages from '~/components/chat/ChatConversationMessages.vue'
import PromptComposer from '~/components/chat/PromptComposer.vue'

// Use no layout for full-width control
definePageMeta({
  layout: false
})

interface ActiveToolActivityState {
  toolCallId: string
  messageId: string
  toolName: string
  status: 'preparing' | 'running'
  args?: Record<string, any>
  progressMessage?: string
  startedAt: string
}

// Only show this page in development
const runtimeConfig = useRuntimeConfig()
const isDevelopment = computed(() => runtimeConfig.public.appEnv === 'development')

// Redirect if not in development - use onMounted to avoid hydration mismatch
onMounted(() => {
  if (!isDevelopment.value) {
    navigateTo('/')
  }
})

// Mode (mock only, but still need it for scenarios)
const mode = ref<'chat' | 'agent'>('agent')

// UI state
const debugEvents = ref<Array<{ id: string, type: string, data: any, timestamp: Date }>>([])
const promptSubmitting = ref(false)

// Timing control - adjust simulation speed
// Realistic times: source_ingest ~3min, content_write ~5min, others ~2min
// Speed multiplier: 1.0 = realistic, 0.1 = 10x faster, 0.01 = 100x faster
const simulationSpeed = ref(0.1) // Default to 10x faster for testing

const scenarioStates = [
  {
    value: 'start' as const,
    label: 'Tool Planned',
    description: 'LLM decided to call tools but has not started execution yet.'
  },
  {
    value: 'in_progress' as const,
    label: 'Tool Running',
    description: 'Tool execution is underway with progress streaming.'
  },
  {
    value: 'completed' as const,
    label: 'Tool Completed',
    description: 'Tool calls finished and the LLM streams its response.'
  }
]
type ScenarioState = (typeof scenarioStates)[number]['value']

// Mock conversation state
const mockMessages = ref<ChatMessage[]>([])
const mockStatus = ref<'ready' | 'submitted' | 'streaming' | 'error'>('ready')
const mockConversationId = ref<string | null>(null)
const isCancelled = ref(false) // Flag to cancel ongoing operations
const currentSimulationState = ref<ScenarioState>('completed')
const currentRunningScenario = ref<typeof scenarios[0] | null>(null)

const currentActivityState = useState<'thinking' | 'streaming' | null>('chat/current-activity', () => null)
const currentToolNameState = useState<string | null>('chat/current-tool-name', () => null)
const activeToolActivitiesState = useState<Map<string, ActiveToolActivityState>>('chat/active-tool-activities', () => new Map())

// Computed
const activeMessages = computed(() => mockMessages.value)
const activeStatus = computed(() => mockStatus.value)
const activeConversationId = computed(() => mockConversationId.value)
const activeErrorMessage = computed(() => null)
const isBusy = computed(() => mockStatus.value === 'streaming' || mockStatus.value === 'submitted')
const prompt = ref('')

// Watch for status changes to track debug events
watch(mockStatus, (newStatus) => {
  debugEvents.value.push({
    id: crypto.randomUUID(),
    type: 'status:change',
    data: { status: newStatus },
    timestamp: new Date()
  })
}, { immediate: false })

const setThinkingState = (toolName?: string | null) => {
  currentActivityState.value = 'thinking'
  currentToolNameState.value = toolName ?? null
}

const setStreamingState = () => {
  currentActivityState.value = 'streaming'
  currentToolNameState.value = null
}

const upsertActiveToolActivity = (toolCallId: string, patch: Partial<ActiveToolActivityState>) => {
  if (!toolCallId) {
    return null
  }
  const next = new Map(activeToolActivitiesState.value)
  const existing = next.get(toolCallId) ?? null
  const messageId = patch.messageId ?? existing?.messageId
  if (!messageId) {
    return null
  }
  const merged: ActiveToolActivityState = {
    toolCallId,
    messageId,
    toolName: patch.toolName ?? existing?.toolName ?? 'Tool',
    status: patch.status ?? existing?.status ?? 'preparing',
    args: patch.args ?? existing?.args,
    progressMessage: patch.progressMessage ?? existing?.progressMessage,
    startedAt: patch.startedAt ?? existing?.startedAt ?? new Date().toISOString()
  }
  next.set(toolCallId, merged)
  activeToolActivitiesState.value = next
  return merged
}

const removeActiveToolActivity = (toolCallId: string) => {
  if (!toolCallId) {
    return {
      removed: null as ActiveToolActivityState | null,
      remaining: activeToolActivitiesState.value.size
    }
  }
  const next = new Map(activeToolActivitiesState.value)
  const removed = next.get(toolCallId) ?? null
  next.delete(toolCallId)
  activeToolActivitiesState.value = next
  return {
    removed,
    remaining: next.size
  }
}

const clearActiveToolActivities = () => {
  if (!activeToolActivitiesState.value.size) {
    return
  }
  activeToolActivitiesState.value = new Map()
}

let cancelResetHandle: ReturnType<typeof setTimeout> | null = null
let cancelResetToken = 0

const resetToReady = () => {
  clearActiveToolActivities()
  currentActivityState.value = null
  currentToolNameState.value = null
  mockStatus.value = 'ready'
  promptSubmitting.value = false
}

const ensureAssistantMessage = (messageId: string) => {
  const index = mockMessages.value.findIndex(message => message.id === messageId)
  if (index >= 0) {
    const existing = mockMessages.value[index]
    if (!existing.parts.some(part => part.type === 'text')) {
      mockMessages.value[index] = {
        ...existing,
        parts: [{ type: 'text', text: '' }, ...existing.parts]
      }
      return mockMessages.value[index]
    }
    return existing
  }

  const newMessage: ChatMessage = {
    id: messageId,
    role: 'assistant',
    parts: [{ type: 'text', text: '' }],
    createdAt: new Date()
  }
  mockMessages.value.push(newMessage)
  return newMessage
}

const updateAssistantMessageText = (messageId: string, text: string) => {
  const index = mockMessages.value.findIndex(message => message.id === messageId)
  if (index < 0) {
    ensureAssistantMessage(messageId)
    return updateAssistantMessageText(messageId, text)
  }

  const existing = mockMessages.value[index]
  const nextParts = [...existing.parts]
  const textPartIndex = nextParts.findIndex(part => part.type === 'text')
  if (textPartIndex >= 0) {
    nextParts[textPartIndex] = {
      ...nextParts[textPartIndex],
      text
    }
  } else {
    nextParts.unshift({ type: 'text', text })
  }

  mockMessages.value[index] = {
    ...existing,
    parts: nextParts
  }
}

const appendToolPartToMessage = (messageId: string, toolPart: Extract<MessagePart, { type: 'tool_call' }>) => {
  const index = mockMessages.value.findIndex(message => message.id === messageId)
  if (index < 0) {
    const message = ensureAssistantMessage(messageId)
    message.parts.push(toolPart)
    return
  }

  const existing = mockMessages.value[index]
  mockMessages.value[index] = {
    ...existing,
    parts: [...existing.parts, toolPart]
  }
}

// Clear debug events
const clearDebugEvents = () => {
  debugEvents.value = []
}

// Mode dropdown items (unused but kept for potential future use)
const _modeItems = computed(() => [
  { value: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
  { value: 'agent', label: 'Agent', icon: 'i-lucide-bot' }
])

// Tool definitions for display
const tools = {
  read: [
    { name: 'read_content', display: 'Read Content', description: 'Fetch a content item and its current version for inspection. Returns content metadata, version info, and sections.', availableIn: ['chat', 'agent'] },
    { name: 'read_section', display: 'Read Section', description: 'Fetch a specific section of a content item for inspection. Returns section text and metadata.', availableIn: ['chat', 'agent'] },
    { name: 'read_source', display: 'Read Source', description: 'Fetch a source content item (e.g. context) for inspection. Returns source content info including context text and chunk metadata.', availableIn: ['chat', 'agent'] },
    { name: 'read_content_list', display: 'List Content', description: 'List content items with optional filtering. Returns a paginated list of content items with metadata.', availableIn: ['chat', 'agent'] },
    { name: 'read_source_list', display: 'List Sources', description: 'List source content items (YouTube videos, manual context, etc.) with optional filtering. Returns a paginated list of source content.', availableIn: ['chat', 'agent'] },
    { name: 'read_workspace_summary', display: 'Workspace Summary', description: 'Get a formatted summary of a content workspace. Returns a human-readable summary of the content, its version, sections, and source.', availableIn: ['chat', 'agent'] }
  ],
  write: [
    { name: 'content_write', display: 'Write Content', description: 'Write or enrich content. Use action="create" to create new content from source, or action="enrich" to refresh frontmatter and JSON-LD structured data.', availableIn: ['agent'] },
    { name: 'edit_section', display: 'Edit Section', description: 'Edit a specific section of an existing content item using the user\'s instructions.', availableIn: ['agent'] },
    { name: 'edit_metadata', display: 'Update Metadata', description: 'Update metadata fields (title, slug, status, primaryKeyword, targetLocale, contentType) for an existing content item.', availableIn: ['agent'] }
  ],
  ingest: [
    { name: 'source_ingest', display: 'Ingest Source', description: 'Ingest source content from either a YouTube video or arbitrary context text. Use sourceType="youtube" or sourceType="context".', availableIn: ['agent'] }
  ]
}

// API endpoints (unused but kept for documentation)
const _apiEndpoints = [
  { method: 'POST', path: '/api/chat', description: 'Chat endpoint - LLM-driven tool selection with SSE streaming', modes: ['chat', 'agent'] },
  { method: 'GET', path: '/api/conversations', description: 'List conversations for the organization with artifact previews', modes: ['chat', 'agent'] },
  { method: 'POST', path: '/api/conversations', description: 'Create a new conversation', modes: ['chat', 'agent'] },
  { method: 'GET', path: '/api/conversations/[id]', description: 'Get a specific conversation by ID', modes: ['chat', 'agent'] },
  { method: 'GET', path: '/api/conversations/[id]/messages', description: 'Get messages for a specific conversation', modes: ['chat', 'agent'] }
]

// Test scenarios - designed to test different UX patterns
const scenarios = [
  {
    id: 'single-content-write',
    name: 'Write Content',
    description: 'Single tool call - content generation',
    prompt: 'Write content about AI agents',
    mode: 'agent' as const,
    tools: ['content_write']
  },
  {
    id: 'context-ingest',
    name: 'Ingest & Write',
    description: 'Source ingestion + content generation',
    prompt: 'Create content from this text: [paste your text here]',
    mode: 'agent' as const,
    tools: ['source_ingest', 'content_write']
  },
  {
    id: 'edit-section',
    name: 'Edit Section',
    description: 'Read + edit operation',
    prompt: 'Make the introduction section more engaging',
    mode: 'agent' as const,
    tools: ['read_content', 'edit_section']
  },
  {
    id: 'update-metadata',
    name: 'Update Metadata',
    description: 'Read + metadata update',
    prompt: 'Change the title to "New Title" and set status to published',
    mode: 'agent' as const,
    tools: ['read_content', 'edit_metadata']
  },
  {
    id: 'read-content',
    name: 'Read Content',
    description: 'Chat mode: Simple read operation',
    prompt: 'Show me the content with ID abc-123',
    mode: 'chat' as const,
    tools: ['read_content']
  },
  {
    id: 'list-content',
    name: 'List Content',
    description: 'Chat mode: List operation',
    prompt: 'Show me all my content',
    mode: 'chat' as const,
    tools: ['read_content_list']
  },
  {
    id: 'workspace-summary',
    name: 'Workspace Summary',
    description: 'Chat mode: Summary generation',
    prompt: 'Give me a summary of my workspace',
    mode: 'chat' as const,
    tools: ['read_workspace_summary']
  },
  {
    id: 'tool-error',
    name: 'Tool Error',
    description: 'Simulate a tool failure to test error handling',
    prompt: 'Try to ingest an invalid YouTube URL',
    mode: 'agent' as const,
    tools: ['source_ingest'],
    simulateError: true
  }
]

// Mock SSE event simulator
const simulateEvent = async (eventType: string, data: any) => {
  console.log(`[Mock SSE] ${eventType}:`, data)
  debugEvents.value.push({
    id: crypto.randomUUID(),
    type: `sse:${eventType}`,
    data,
    timestamp: new Date()
  })
}

// Helper to apply speed multiplier to delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms * simulationSpeed.value))

// Realistic progress messages for different tools
const getProgressMessages = (toolName: string, step: number): string => {
  const messages: Record<string, string[]> = {
    source_ingest: [
      'Fetching YouTube video metadata...',
      'Downloading transcript...',
      'Processing transcript chunks...',
      'Extracting key information...',
      'Storing source content...'
    ],
    content_write: [
      'Analyzing source material...',
      'Generating content outline...',
      'Writing introduction section...',
      'Writing main content sections...',
      'Generating conclusion...',
      'Formatting and structuring content...',
      'Finalizing content...'
    ],
    edit_section: [
      'Reading current section...',
      'Analyzing requested changes...',
      'Generating updated content...',
      'Applying edits...',
      'Validating changes...'
    ],
    edit_metadata: [
      'Reading current metadata...',
      'Validating new values...',
      'Updating metadata fields...',
      'Saving changes...'
    ],
    read_content: [
      'Fetching content from database...',
      'Loading version information...',
      'Retrieving sections...'
    ]
  }
  const toolMessages = messages[toolName] || ['Processing...', 'Working...', 'Almost done...']
  const index = step % toolMessages.length
  return toolMessages[index] ?? toolMessages[toolMessages.length - 1] ?? 'Processing...'
}

const resetConversation = () => {
  // Set cancellation flag to stop any ongoing async operations
  isCancelled.value = true
  // Clear state
  mockMessages.value = []
  mockStatus.value = 'ready'
  mockConversationId.value = null
  clearActiveToolActivities()
  currentActivityState.value = null
  currentToolNameState.value = null
  currentRunningScenario.value = null
  prompt.value = ''
  clearDebugEvents()
  // Reset cancellation flag after a brief delay to allow operations to check it
  cancelResetToken += 1
  const token = cancelResetToken
  if (cancelResetHandle) {
    clearTimeout(cancelResetHandle)
  }
  cancelResetHandle = setTimeout(() => {
    if (cancelResetToken === token) {
      isCancelled.value = false
      cancelResetHandle = null
    }
  }, 100)
}

// Add user message to the conversation
const addUserMessage = (text: string) => {
  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: new Date()
  }
  mockMessages.value.push(userMessage)
  prompt.value = ''
}

// Simulate tool execution with progress updates
const simulateToolExecution = async (
  toolCallId: string,
  toolName: string,
  args: Record<string, any>,
  progressSteps: number,
  shouldError: boolean,
  assistantMessageId: string,
  state: ScenarioState
): Promise<{ success: boolean, result: any, error?: string }> => {
  // Check if cancelled before starting
  if (isCancelled.value) {
    return { success: true, result: null }
  }

  ensureAssistantMessage(assistantMessageId)
  const startedAt = new Date().toISOString()

  // Simulate tool:preparing
  setThinkingState(toolName)
  upsertActiveToolActivity(toolCallId, {
    messageId: assistantMessageId,
    toolName,
    status: 'preparing',
    args,
    startedAt
  })
  await simulateEvent('tool:preparing', {
    toolCallId,
    toolName,
    messageId: assistantMessageId,
    timestamp: new Date().toISOString()
  })

  await delay(800)

  // Check if cancelled after delay
  if (isCancelled.value) {
    return { success: true, result: null }
  }

  // Simulate tool:start
  setThinkingState(toolName)
  upsertActiveToolActivity(toolCallId, {
    messageId: assistantMessageId,
    toolName,
    status: 'running',
    args
  })
  await simulateEvent('tool:start', {
    toolCallId,
    toolName,
    messageId: assistantMessageId,
    args,
    timestamp: new Date().toISOString()
  })

  // If previewing only the planning phase, stop here
  if (state === 'start') {
    return { success: true, result: null }
  }

  // Determine delay per step based on tool (content_write is longer)
  const stepDelay = toolName === 'content_write' ? 3000 : 2000

  // Simulate realistic progress updates
  if (state === 'in_progress') {
    // Show a few progress steps to demonstrate it's in progress, then stop
    // This shows the tool running with progress messages, but not completed
    const progressStepsToShow = Math.min(3, progressSteps) // Show up to 3 progress steps
    for (let i = 0; i < progressStepsToShow; i++) {
      // Check if cancelled
      if (isCancelled.value) {
        return { success: true, result: null }
      }
      const progressMsg = getProgressMessages(toolName, i)
      upsertActiveToolActivity(toolCallId, {
        messageId: assistantMessageId,
        progressMessage: progressMsg
      })
      await simulateEvent('tool:progress', {
        toolCallId,
        message: progressMsg,
        messageId: assistantMessageId,
        timestamp: new Date().toISOString()
      })
      await delay(stepDelay)
    }
    // Stop here without completing - tool stays in "running" state
    return { success: true, result: null }
  } else {
    // For "completed", run through all progress steps normally
    for (let i = 0; i < progressSteps; i++) {
      // Check if cancelled
      if (isCancelled.value) {
        return { success: true, result: null }
      }
      const progressMsg = getProgressMessages(toolName, i)
      upsertActiveToolActivity(toolCallId, {
        messageId: assistantMessageId,
        progressMessage: progressMsg
      })
      await simulateEvent('tool:progress', {
        toolCallId,
        message: progressMsg,
        messageId: assistantMessageId,
        timestamp: new Date().toISOString()
      })
      await delay(shouldError && i === 2 ? 500 : stepDelay)
    }
  }

  // Generate result based on tool name and error state (only for "completed")
  let result: any = null
  let error: string | undefined

  if (shouldError) {
    // Use specific error message for source_ingest
    if (toolName === 'source_ingest') {
      error = 'Failed to fetch YouTube transcript: Video not found or private'
    } else {
      error = `Failed to execute ${toolName}: Simulated error`
    }
  } else {
    // Generate appropriate result based on tool
    if (toolName === 'source_ingest') {
      result = {
        sourceContentId: crypto.randomUUID(),
        sourceType: args.sourceType || 'youtube',
        ingestStatus: 'ingested',
        sourceContent: {
          id: crypto.randomUUID(),
          title: 'Introduction to AI Agents',
          ingestStatus: 'ingested'
        }
      }
    } else if (toolName === 'content_write') {
      result = {
        contentId: crypto.randomUUID(),
        versionId: crypto.randomUUID(),
        content: {
          id: crypto.randomUUID(),
          title: 'Introduction to AI Agents',
          slug: 'introduction-to-ai-agents'
        }
      }
    } else {
      result = { success: true, toolName }
    }
  }

  await simulateEvent('tool:complete', {
    toolCallId,
    toolName,
    success: !shouldError,
    result,
    error,
    messageId: assistantMessageId,
    timestamp: new Date().toISOString()
  })

  const { removed } = removeActiveToolActivity(toolCallId)
  appendToolPartToMessage(assistantMessageId, {
    type: 'tool_call',
    toolCallId,
    toolName,
    status: shouldError ? 'error' : 'success',
    args,
    result,
    error,
    progressMessage: removed?.progressMessage,
    timestamp: new Date().toISOString()
  })

  if (!activeToolActivitiesState.value.size) {
    currentToolNameState.value = null
  }

  return { success: !shouldError, result, error }
}

// Simulate streaming assistant message with chunks
const simulateStreamingAssistantMessage = async (messageId: string, text: string) => {
  ensureAssistantMessage(messageId)
  setStreamingState()
  let currentText = ''

  // Stream text in chunks
  for (let i = 0; i < text.length; i += 3) {
    if (isCancelled.value) {
      return
    }

    const chunk = text.slice(i, i + 3)
    currentText += chunk

    updateAssistantMessageText(messageId, currentText)

    await simulateEvent('message:chunk', {
      messageId,
      chunk
    })
    await delay(30)
  }

  await simulateEvent('message:complete', {
    messageId,
    message: text
  })

  currentActivityState.value = null
}

// Emit all completion events (logs, messages, agent context, etc.)
const emitCompletionEvents = async (
  toolCalls: Array<{
    toolCallId: string
    toolName: string
    args?: Record<string, any>
    result?: any
    error?: string
  }>
) => {
  // Simulate log:entry events (tool_started, tool_succeeded)
  for (const tc of toolCalls) {
    if (!tc.error) {
      await simulateEvent('log:entry', {
        id: crypto.randomUUID(),
        type: 'tool_started',
        message: `Tool ${tc.toolName} started`,
        payload: {
          toolName: tc.toolName,
          args: tc.args
        },
        createdAt: new Date().toISOString()
      })

      await simulateEvent('log:entry', {
        id: crypto.randomUUID(),
        type: 'tool_succeeded',
        message: `Tool ${tc.toolName} executed successfully`,
        payload: {
          toolName: tc.toolName,
          args: tc.args,
          result: tc.result
        },
        createdAt: new Date().toISOString()
      })
    }
  }

  // Simulate messages:complete (authoritative snapshot)
  await simulateEvent('messages:complete', {
    messages: mockMessages.value.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.parts.find(p => p.type === 'text')?.text || '',
      createdAt: msg.createdAt,
      payload: msg.payload
    }))
  })

  // Simulate logs:complete (authoritative log snapshot)
  await simulateEvent('logs:complete', {
    logs: toolCalls
      .filter(tc => !tc.error)
      .flatMap(tc => [
        {
          id: crypto.randomUUID(),
          type: 'tool_started' as const,
          message: `Tool ${tc.toolName} started`,
          payload: { toolName: tc.toolName, args: tc.args },
          createdAt: new Date().toISOString()
        },
        {
          id: crypto.randomUUID(),
          type: 'tool_succeeded' as const,
          message: `Tool ${tc.toolName} executed successfully`,
          payload: { toolName: tc.toolName, args: tc.args, result: tc.result },
          createdAt: new Date().toISOString()
        }
      ])
  })

  // Simulate agentContext:update (only if we have source_ingest result)
  const sourceIngestCall = toolCalls.find(tc => tc.toolName === 'source_ingest' && tc.result)
  if (sourceIngestCall?.result) {
    await simulateEvent('agentContext:update', {
      readySources: [
        {
          id: sourceIngestCall.result.sourceContentId,
          title: sourceIngestCall.result.sourceContent?.title || 'Introduction to AI Agents',
          sourceType: sourceIngestCall.result.sourceType || 'youtube',
          ingestStatus: 'ingested',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      ingestFailures: [],
      lastAction: toolCalls[toolCalls.length - 1]?.toolName || null,
      toolHistory: toolCalls
        .filter(tc => !tc.error)
        .map(tc => ({
          toolName: tc.toolName,
          invocation: { name: tc.toolName, arguments: tc.args },
          result: { success: true, result: tc.result }
        })),
      intentSnapshot: null
    })
  }

  // Simulate conversation:final
  await simulateEvent('conversation:final', {
    conversationId: mockConversationId.value
  })

  // Simulate done
  await simulateEvent('done', {})
}

const simulateAgentTurn = async (messageText: string, state: ScenarioState = 'completed') => {
  // Reset cancellation flag at start of new turn
  isCancelled.value = false

  const text = messageText
  const scenario = scenarios.find(s => text.includes(s.prompt) || text === s.prompt)
  const shouldSimulateError = scenario?.simulateError || false
  const toolsToRun = scenario?.tools || ['source_ingest', 'content_write'] // Default to multi-tool

  clearActiveToolActivities()
  currentActivityState.value = null
  currentToolNameState.value = null

  mockStatus.value = 'submitted'
  promptSubmitting.value = true

  // Add user message
  addUserMessage(text)
  const assistantMessageId = crypto.randomUUID()
  ensureAssistantMessage(assistantMessageId)

  await delay(500)

  // Check if cancelled
  if (isCancelled.value) {
    resetToReady()
    return
  }

  mockStatus.value = 'streaming'

  // Simulate conversation:update
  mockConversationId.value = crypto.randomUUID()
  await simulateEvent('conversation:update', { conversationId: mockConversationId.value })

  const toolCalls: Array<{
    toolCallId: string
    toolName: string
    status: 'success' | 'error'
    args?: Record<string, any>
    result?: any
    error?: string
  }> = []

  // Simulate tool executions based on scenario
  let previousResult: any = null

  for (let i = 0; i < toolsToRun.length; i++) {
    // Check if cancelled before processing each tool
    if (isCancelled.value) {
      resetToReady()
      return
    }

    const toolName = toolsToRun[i]
    const toolCallId = crypto.randomUUID()
    let toolArgs: Record<string, any> = {}
    let progressSteps = 4

    // Set up tool-specific args
    if (toolName === 'source_ingest') {
      toolArgs = {
        sourceType: 'youtube',
        youtubeUrl: 'https://youtube.com/watch?v=example'
      }
      progressSteps = 4
    } else if (toolName === 'content_write') {
      toolArgs = {
        action: 'create',
        sourceContentId: previousResult?.sourceContentId || crypto.randomUUID()
      }
      progressSteps = 6
    } else if (toolName === 'read_content') {
      toolArgs = { contentId: 'abc-123' }
      progressSteps = 2
    } else if (toolName === 'edit_section') {
      toolArgs = { contentId: 'abc-123', sectionId: 'intro' }
      progressSteps = 3
    } else if (toolName === 'edit_metadata') {
      toolArgs = { contentId: 'abc-123', title: 'New Title', status: 'published' }
      progressSteps = 2
    }

    const shouldError = shouldSimulateError && i === 0 // Error on first tool if error scenario
    const toolExecution = await simulateToolExecution(
      toolCallId,
      toolName,
      toolArgs,
      progressSteps,
      shouldError,
      assistantMessageId,
      state
    )

    // Check if cancelled after tool execution
    if (isCancelled.value) {
      resetToReady()
      return
    }

    // If error scenario and this is the first tool, stop here
    if (shouldError) {
      const errorText = toolName === 'source_ingest'
        ? 'I encountered an error while trying to ingest the YouTube video. The video URL appears to be invalid or the video is private.'
        : `I encountered an error while executing ${toolName}. Please try again.`

      updateAssistantMessageText(assistantMessageId, errorText)

      await simulateEvent('message:complete', {
        messageId: assistantMessageId,
        message: errorText
      })

      await simulateEvent('messages:complete', {
        messages: mockMessages.value.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.parts.find(p => p.type === 'text')?.text || '',
          createdAt: msg.createdAt,
          payload: msg.payload
        }))
      })

      clearActiveToolActivities()
      currentActivityState.value = null
      currentToolNameState.value = null

      await simulateEvent('done', {})
      resetToReady()
      return
    }

    // Only add to toolCalls if the tool completed
    if (state === 'completed') {
      toolCalls.push({
        toolCallId,
        toolName,
        status: toolExecution.success ? 'success' : 'error',
        args: toolArgs,
        result: toolExecution.result,
        error: toolExecution.error
      })
    }

    previousResult = toolExecution.result
    if (i < toolsToRun.length - 1) {
      await delay(500)
      // Check if cancelled after delay between tools
      if (isCancelled.value) {
        resetToReady()
        return
      }
    }
  }

  // Check if cancelled before finalizing
  if (isCancelled.value) {
    resetToReady()
    return
  }

  // If state is "start" or "in_progress", keep tools running and don't complete
  if (state !== 'completed') {
    promptSubmitting.value = false
    return
  }

  await delay(500)

  // Check if cancelled before generating assistant message
  if (isCancelled.value) {
    resetToReady()
    return
  }

  // Generate appropriate assistant message based on tools
  let assistantText = ''
  if (toolsToRun.includes('content_write')) {
    assistantText = 'I\'ve successfully created content from the YouTube video. The content includes a comprehensive introduction to AI agents with sections covering key concepts, use cases, and implementation strategies.'
  } else if (toolsToRun.includes('edit_section')) {
    assistantText = 'I\'ve updated the introduction section to be more engaging and compelling.'
  } else if (toolsToRun.includes('edit_metadata')) {
    assistantText = 'I\'ve successfully updated the metadata for the content item.'
  } else if (toolsToRun.includes('read_content')) {
    assistantText = 'Here is the content you requested. [Content details would appear here]'
  } else {
    assistantText = 'I\'ve completed the requested operation successfully.'
  }

  // Simulate streaming assistant message
  await simulateStreamingAssistantMessage(assistantMessageId, assistantText)

  // Check if cancelled after streaming
  if (isCancelled.value) {
    resetToReady()
    return
  }

  await delay(500)

  // Check if cancelled before finalizing
  if (isCancelled.value) {
    resetToReady()
    return
  }

  // Emit all completion events
  await emitCompletionEvents(toolCalls)

  clearActiveToolActivities()
  currentActivityState.value = null
  currentToolNameState.value = null
  currentRunningScenario.value = null

  mockStatus.value = 'ready'
  promptSubmitting.value = false
}

// Handle scenario click - start it with current selected state
const handleScenarioRun = async (scenario: typeof scenarios[0]) => {
  // If busy, cancel current simulation first
  if (isBusy.value) {
    isCancelled.value = true
    // Wait a bit for cancellation to take effect
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  currentRunningScenario.value = scenario
  mode.value = scenario.mode
  await simulateAgentTurn(scenario.prompt, currentSimulationState.value)
}

// Handle state change in controls
const handleStateChange = async (state: ScenarioState) => {
  currentSimulationState.value = state

  // If simulation is running, cancel it and restart with new state
  if (isBusy.value && currentRunningScenario.value) {
    isCancelled.value = true
    // Wait a bit for cancellation to take effect
    await new Promise(resolve => setTimeout(resolve, 100))
    // Restart the current scenario with the new state
    mode.value = currentRunningScenario.value.mode
    await simulateAgentTurn(currentRunningScenario.value.prompt, state)
  }
}

// Handle prompt submit
const handlePromptSubmit = async (value: string) => {
  if (!value.trim() || isBusy.value) {
    return
  }
  await simulateAgentTurn(value, 'completed')
}

// Mock handlers for ChatConversationMessages
const handleCopy = (message: ChatMessage) => {
  const text = message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join(' ')
  if (import.meta.client && navigator.clipboard) {
    navigator.clipboard.writeText(text)
  }
}

const handleRegenerate = (message: ChatMessage) => {
  // Mock regenerate - just log for now
  console.log('Regenerate:', message.id)
}

const handleSendAgain = (message: ChatMessage) => {
  // Send again - use the message text as new prompt
  const text = message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join(' ')
  if (text) {
    prompt.value = text
    handlePromptSubmit(text)
  }
}

const handleShare = (message: ChatMessage) => {
  // Mock share - just log for now
  console.log('Share:', message.id)
}
</script>

<template>
  <div
    v-if="isDevelopment"
    class="fixed inset-0 w-screen h-screen flex overflow-hidden"
  >
    <!-- Left Panel: Controls (Thinner) -->
    <div class="w-80 min-w-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto">
        <!-- Header -->
        <div class="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
          <div class="flex items-center justify-between mb-2">
            <h1 class="text-base font-bold">
              Controls
            </h1>
            <UBadge
              :color="activeStatus === 'streaming' ? 'primary' : activeStatus === 'error' ? 'error' : 'neutral'"
              variant="soft"
            >
              {{ activeStatus }}
            </UBadge>
          </div>

          <!-- Quick Controls -->
          <div class="space-y-2">
            <UButton
              variant="outline"
              size="xs"
              icon="i-lucide-refresh-cw"
              class="w-full"
              @click="resetConversation"
            >
              Reset
            </UButton>

            <div
              v-if="activeConversationId"
              class="text-xs text-gray-600 dark:text-gray-400"
            >
              <span>Conv:</span>
              <code class="ml-1 font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs">
                {{ activeConversationId.slice(0, 8) }}
              </code>
            </div>

            <div class="space-y-2">
              <div class="text-xs font-semibold text-gray-800 dark:text-gray-200">
                Preview States
              </div>
              <div class="flex flex-col gap-1">
                <UButton
                  v-for="preset in scenarioStates"
                  :key="preset.value"
                  :variant="currentSimulationState === preset.value ? 'solid' : 'outline'"
                  class="w-full justify-start"
                  @click="handleStateChange(preset.value)"
                >
                  {{ preset.label }}
                </UButton>
              </div>
            </div>
          </div>
        </div>

        <!-- Content Sections -->
        <div class="p-3 space-y-4">
          <!-- Test Scenarios -->
          <div>
            <h2 class="text-sm font-semibold mb-2 flex items-center gap-2">
              <UIcon
                name="i-lucide-play-circle"
                class="h-4 w-4"
              />
              Scenarios
            </h2>
            <div class="space-y-3">
              <div
                v-for="scenario in scenarios"
                :key="scenario.id"
                class="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 space-y-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                @click="handleScenarioRun(scenario)"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-xs font-semibold text-gray-900 dark:text-gray-50 truncate">
                      {{ scenario.name }}
                    </p>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">
                      {{ scenario.description }}
                    </p>
                  </div>
                  <div class="flex flex-col gap-1 items-end shrink-0">
                    <UBadge
                      :color="scenario.mode === 'agent' ? 'primary' : 'neutral'"
                      variant="soft"
                    >
                      {{ scenario.mode }}
                    </UBadge>
                  </div>
                </div>
                <div class="text-[11px] text-gray-500 dark:text-gray-400">
                  <span class="font-semibold text-gray-700 dark:text-gray-200">Tools:</span>
                  {{ scenario.tools.join(' → ') }}
                </div>
              </div>
            </div>
          </div>

          <!-- Tools Info -->
          <div>
            <h2 class="text-sm font-semibold mb-2 flex items-center gap-2">
              <UIcon
                name="i-lucide-wrench"
                class="h-4 w-4"
              />
              Tools
            </h2>
            <div class="space-y-1 text-xs">
              <div class="text-gray-600 dark:text-gray-400">
                <span class="font-medium">Read:</span> {{ tools.read.length }} tools
              </div>
              <div class="text-gray-600 dark:text-gray-400">
                <span class="font-medium">Write:</span> {{ tools.write.length }} tools
              </div>
              <div class="text-gray-600 dark:text-gray-400">
                <span class="font-medium">Ingest:</span> {{ tools.ingest.length }} tools
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Middle Panel: Chat UI + Debug (IDE Layout) -->
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden relative bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
      <!-- Chat Content (Top) -->
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto py-4 px-4 sm:px-6">
          <div class="w-full flex flex-col justify-center">
            <div class="space-y-8">
              <!-- Chat Messages -->
              <ChatConversationMessages
                :messages="activeMessages"
                :display-messages="activeMessages"
                :conversation-id="activeConversationId"
                :status="activeStatus"
                :ui-status="activeStatus"
                :error-message="activeErrorMessage"
                :is-busy="isBusy"
                :prompt-submitting="promptSubmitting"
                @copy="handleCopy"
                @regenerate="handleRegenerate"
                @send-again="handleSendAgain"
                @share="handleShare"
              />
            </div>
          </div>
        </div>

        <!-- Main chat input -->
        <div class="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
          <PromptComposer
            v-model="prompt"
            placeholder="Type your message or click a scenario to test..."
            :disabled="isBusy"
            :status="promptSubmitting ? 'submitted' : activeStatus"
            @submit="handlePromptSubmit"
          />
        </div>
      </div>

      <!-- Debug Panel (Bottom, like IDE console) -->
      <div
        class="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex flex-col"
        style="height: 300px;"
      >
        <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <h3 class="text-sm font-semibold flex items-center gap-2">
            <UIcon
              name="i-lucide-terminal"
              class="h-4 w-4"
            />
            Debug Events
            <UBadge
              variant="soft"
            >
              {{ debugEvents.length }}
            </UBadge>
          </h3>
          <UButton
            variant="ghost"
            size="xs"
            icon="i-lucide-trash-2"
            @click="clearDebugEvents"
          >
            Clear
          </UButton>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
          <div
            v-for="event in debugEvents.slice().reverse()"
            :key="event.id"
            class="p-2 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-primary-600 dark:text-primary-400 mb-1">
                  {{ event.type }}
                </div>
                <pre class="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{{ JSON.stringify(event.data, null, 2) }}</pre>
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">
                {{ event.timestamp.toLocaleTimeString() }}
              </div>
            </div>
          </div>
          <div
            v-if="debugEvents.length === 0"
            class="text-xs text-gray-500 dark:text-gray-500 text-center py-8"
          >
            No debug events yet. Events will appear here when you interact with the chat.
          </div>
        </div>
      </div>
    </div>

    <!-- Right Panel: Component & API Info -->
    <div class="w-80 min-w-0 border-l border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto">
        <!-- Header -->
        <div class="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
          <h2 class="text-lg font-bold">
            Component & API Info
          </h2>
        </div>

        <div class="p-4 space-y-6">
          <!-- Active Components -->
          <div>
            <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
              <UIcon
                name="i-lucide-layers"
                class="h-4 w-4"
              />
              Active Components
            </h3>
            <div class="space-y-2">
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium text-xs mb-1">
                  ChatConversationMessages
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  Main container for chat messages
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-500 space-y-0.5">
                  <div>• messages: {{ activeMessages.length }}</div>
                  <div>• conversationId: {{ activeConversationId ? 'set' : 'null' }}</div>
                  <div>• status: {{ activeStatus }}</div>
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium text-xs mb-1">
                  ChatMessageContent
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  Renders message content & tool calls
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-500">
                  Used for each message in ChatConversationMessages
                </div>
              </div>
              <div
                v-if="activeMessages.some(m => m.parts.some(p => p.type === 'tool_call'))"
                class="p-2 rounded border-2 border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-950/30"
              >
                <div class="font-medium text-xs mb-1 text-primary-700 dark:text-primary-300">
                  AgentProgressTracker
                </div>
                <div class="text-xs text-primary-600 dark:text-primary-400 mb-1">
                  Active - showing tool execution progress
                </div>
                <div class="text-xs text-primary-500 dark:text-primary-500 space-y-0.5">
                  <div>• Renders inside ChatMessageContent</div>
                  <div>• Shows: ToolExecutionStep components</div>
                  <div>• Tool calls: {{ activeMessages.reduce((acc, m) => acc + m.parts.filter(p => p.type === 'tool_call').length, 0) }}</div>
                </div>
              </div>
              <div
                v-else
                class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50"
              >
                <div class="font-medium text-xs mb-1 text-gray-500">
                  AgentProgressTracker
                </div>
                <div class="text-xs text-gray-500">
                  Inactive - no tool calls present
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium text-xs mb-1">
                  PromptComposer
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  Input component (always visible at bottom)
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-500">
                  • Emits: submit event<br>
                  • Status: {{ activeStatus }}
                </div>
              </div>
            </div>
          </div>

          <!-- Current State -->
          <div>
            <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
              <UIcon
                name="i-lucide-database"
                class="h-4 w-4"
              />
              Current State
            </h3>
            <div class="space-y-2 text-xs">
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-1">
                  Messages
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  {{ activeMessages.length }} message(s)
                </div>
                <div
                  v-if="activeMessages.length > 0"
                  class="mt-1 text-gray-500 dark:text-gray-500"
                >
                  Last: {{ activeMessages[activeMessages.length - 1]?.role }}
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-1">
                  Tool Calls
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  {{ activeMessages.reduce((acc, m) => acc + m.parts.filter(p => p.type === 'tool_call').length, 0) }} active
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-1">
                  Status
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  {{ activeStatus }}
                </div>
              </div>
            </div>
          </div>

          <!-- API Events Reference -->
          <div>
            <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
              <UIcon
                name="i-lucide-code"
                class="h-4 w-4"
              />
              SSE Events Reference
            </h3>
            <div class="space-y-1.5 text-xs">
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-0.5">
                  conversation:update
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  Conversation ID changes
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-0.5">
                  tool:preparing
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  Tool detected, waiting for args
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-0.5">
                  tool:start
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  Tool execution started
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-0.5">
                  tool:progress
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  Progress updates
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-0.5">
                  tool:complete
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  Tool finished (success/error)
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-0.5">
                  message:chunk
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  LLM text streaming
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-0.5">
                  messages:complete
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  Authoritative DB snapshot
                </div>
              </div>
            </div>
          </div>

          <!-- Component Hierarchy -->
          <div>
            <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
              <UIcon
                name="i-lucide-git-branch"
                class="h-4 w-4"
              />
              Component Tree
            </h3>
            <div class="text-xs font-mono text-gray-700 dark:text-gray-300 space-y-0.5 bg-white dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-800">
              <div>ChatConversationMessages</div>
              <div class="ml-3 text-gray-600 dark:text-gray-400">
                └─ UChatMessages
              </div>
              <div class="ml-6 text-gray-600 dark:text-gray-400">
                └─ ChatMessageContent
              </div>
              <div class="ml-9 text-gray-500 dark:text-gray-500">
                ├─ Text parts
              </div>
              <div
                v-if="activeMessages.some(m => m.parts.some(p => p.type === 'tool_call'))"
                class="ml-9 text-primary-600 dark:text-primary-400"
              >
                └─ AgentProgressTracker
              </div>
              <div
                v-if="activeMessages.some(m => m.parts.some(p => p.type === 'tool_call'))"
                class="ml-12 text-primary-500 dark:text-primary-500"
              >
                └─ ToolExecutionStep
              </div>
              <div class="ml-3 text-gray-600 dark:text-gray-400">
                └─ PromptComposer
              </div>
            </div>
          </div>

          <!-- Data Flow -->
          <div>
            <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
              <UIcon
                name="i-lucide-arrow-right-left"
                class="h-4 w-4"
              />
              Data Flow
            </h3>
            <div class="text-xs space-y-2">
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-1">
                  Mock SSE Events →
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  simulateEvent() generates events
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-1">
                  State Updates →
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  mockMessages, mockStatus updated
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-1">
                  Component Props →
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  Passed to ChatConversationMessages
                </div>
              </div>
              <div class="p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div class="font-medium mb-1">
                  Vue Reactivity →
                </div>
                <div class="text-gray-600 dark:text-gray-400">
                  Components auto-update on state change
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div
    v-else
    class="min-h-screen flex items-center justify-center"
  >
    <div class="text-center">
      <h1 class="text-2xl font-bold mb-2">
        Not Available
      </h1>
      <p class="text-gray-600 dark:text-gray-400">
        This test page is only available in development mode.
      </p>
    </div>
  </div>
</template>
