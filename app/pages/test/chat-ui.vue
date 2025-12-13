<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { computed, ref, watch } from 'vue'
import ChatConversationMessages from '~/components/chat/ChatConversationMessages.vue'
import PromptComposer from '~/components/chat/PromptComposer.vue'

// Use no layout for full-width control
definePageMeta({
  layout: false
})

// Only show this page in development
const runtimeConfig = useRuntimeConfig()
const isDevelopment = computed(() => runtimeConfig.public.appEnv === 'development')

// Redirect if not in development
if (!isDevelopment.value && import.meta.client) {
  navigateTo('/')
}

// Mode (mock only, but still need it for scenarios)
const mode = ref<'chat' | 'agent'>('agent')

// UI state
const debugEvents = ref<Array<{ type: string, data: any, timestamp: Date }>>([])
const promptSubmitting = ref(false)

// Timing control - adjust simulation speed
// Realistic times: source_ingest ~3min, content_write ~5min, others ~2min
// Speed multiplier: 1.0 = realistic, 0.1 = 10x faster, 0.01 = 100x faster
const simulationSpeed = ref(0.1) // Default to 10x faster for testing
const speedOptions = [
  { value: 1.0, label: 'Realistic (slow)', description: 'Real-world timing' },
  { value: 0.1, label: 'Fast (10x)', description: 'Good for testing' },
  { value: 0.01, label: 'Very Fast (100x)', description: 'Quick iteration' }
]

// Mock conversation state
const mockMessages = ref<ChatMessage[]>([])
const mockStatus = ref<'ready' | 'submitted' | 'streaming' | 'error'>('ready')
const mockConversationId = ref<string | null>(null)
const mockStreamingToolCalls = ref<Map<string, {
  toolCallId: string
  toolName: string
  status: 'preparing' | 'running' | 'success' | 'error'
  progressMessage?: string
  args?: Record<string, any>
  result?: any
  error?: string
}>>(new Map())

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
    type: 'status:change',
    data: { status: newStatus },
    timestamp: new Date()
  })
}, { immediate: false })

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
    id: 'youtube-ingest',
    name: 'YouTube Ingest (Heavy)',
    description: 'Long-running: YouTube transcript + content generation',
    prompt: 'Create content from this YouTube video: https://youtube.com/watch?v=example',
    mode: 'agent' as const,
    tools: ['source_ingest', 'content_write'],
    timing: 'heavy' // Long-running operations
  },
  {
    id: 'context-ingest',
    name: 'Context Ingest (Medium)',
    description: 'Medium: Text processing + content generation',
    prompt: 'Create content from this text: [paste your text here]',
    mode: 'agent' as const,
    tools: ['source_ingest', 'content_write'],
    timing: 'medium'
  },
  {
    id: 'edit-section',
    name: 'Edit Section (Quick)',
    description: 'Quick: Read + edit operation',
    prompt: 'Make the introduction section more engaging',
    mode: 'agent' as const,
    tools: ['read_content', 'edit_section'],
    timing: 'quick'
  },
  {
    id: 'update-metadata',
    name: 'Update Metadata (Quick)',
    description: 'Quick: Read + metadata update',
    prompt: 'Change the title to "New Title" and set status to published',
    mode: 'agent' as const,
    tools: ['read_content', 'edit_metadata'],
    timing: 'quick'
  },
  {
    id: 'read-content',
    name: 'Read Content (Chat)',
    description: 'Chat mode: Simple read operation',
    prompt: 'Show me the content with ID abc-123',
    mode: 'chat' as const,
    tools: ['read_content'],
    timing: 'quick'
  },
  {
    id: 'list-content',
    name: 'List Content (Chat)',
    description: 'Chat mode: List operation',
    prompt: 'Show me all my content',
    mode: 'chat' as const,
    tools: ['read_content_list'],
    timing: 'quick'
  },
  {
    id: 'workspace-summary',
    name: 'Workspace Summary (Chat)',
    description: 'Chat mode: Summary generation',
    prompt: 'Give me a summary of my workspace',
    mode: 'chat' as const,
    tools: ['read_workspace_summary'],
    timing: 'medium'
  },
  {
    id: 'multi-tool',
    name: 'Multi-Tool Sequence',
    description: 'Multiple tools in sequence',
    prompt: 'Read content abc-123, then edit the introduction section to be more engaging',
    mode: 'agent' as const,
    tools: ['read_content', 'edit_section'],
    timing: 'medium'
  },
  {
    id: 'complex-workflow',
    name: 'Complex Workflow (Heavy)',
    description: 'Full workflow: Ingest → Read → Edit → Update',
    prompt: 'Ingest this YouTube video, read the generated content, edit the intro section, and update the metadata',
    mode: 'agent' as const,
    tools: ['source_ingest', 'read_content', 'edit_section', 'edit_metadata'],
    timing: 'heavy'
  },
  {
    id: 'tool-error',
    name: 'Tool Error Scenario',
    description: 'Simulate a tool failure to test error handling',
    prompt: 'Try to ingest an invalid YouTube URL',
    mode: 'agent' as const,
    tools: ['source_ingest'],
    timing: 'quick',
    simulateError: true
  },
  {
    id: 'long-content-write',
    name: 'Long Content Write (Heavy)',
    description: 'Simulate long content generation',
    prompt: 'Create a comprehensive 5000-word article about AI agents',
    mode: 'agent' as const,
    tools: ['content_write'],
    timing: 'heavy'
  }
]

// Mock SSE event simulator
const simulateEvent = async (eventType: string, data: any) => {
  console.log(`[Mock SSE] ${eventType}:`, data)
  debugEvents.value.push({
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
  return toolMessages[step % toolMessages.length] || toolMessages[toolMessages.length - 1]
}

const resetConversation = () => {
  mockMessages.value = []
  mockStatus.value = 'ready'
  mockConversationId.value = null
  mockStreamingToolCalls.value.clear()
  prompt.value = ''
  clearDebugEvents()
}

const simulateAgentTurn = async (messageText: string) => {
  const text = messageText
  const scenario = scenarios.find(s => text.includes(s.prompt) || text === s.prompt)
  const shouldSimulateError = scenario?.simulateError || false

  mockStatus.value = 'submitted'
  promptSubmitting.value = true
  mockStreamingToolCalls.value.clear()

  // Add user message
  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: new Date()
  }
  mockMessages.value.push(userMessage)

  // Clear prompt after submitting
  prompt.value = ''

  await delay(500)
  mockStatus.value = 'streaming'

  // Simulate conversation:update
  mockConversationId.value = crypto.randomUUID()
  await simulateEvent('conversation:update', { conversationId: mockConversationId.value })

  // Simulate tool:preparing
  const toolCallId1 = crypto.randomUUID()
  mockStreamingToolCalls.value.set(toolCallId1, {
    toolCallId: toolCallId1,
    toolName: 'source_ingest',
    status: 'preparing'
  })
  await simulateEvent('tool:preparing', {
    toolCallId: toolCallId1,
    toolName: 'source_ingest',
    timestamp: new Date().toISOString()
  })

  await delay(800)

  // Simulate tool:start
  const tool1 = mockStreamingToolCalls.value.get(toolCallId1)
  if (tool1) {
    tool1.status = 'running'
    tool1.args = {
      sourceType: 'youtube',
      youtubeUrl: 'https://youtube.com/watch?v=example'
    }
  }
  await simulateEvent('tool:start', {
    toolCallId: toolCallId1,
    toolName: 'source_ingest',
    timestamp: new Date().toISOString()
  })

  // Simulate realistic progress updates for source_ingest
  const progressSteps1 = 4
  for (let i = 0; i < progressSteps1; i++) {
    const progressMsg = getProgressMessages('source_ingest', i)
    if (tool1) {
      tool1.progressMessage = progressMsg
    }
    await simulateEvent('tool:progress', {
      toolCallId: toolCallId1,
      message: progressMsg,
      timestamp: new Date().toISOString()
    })
    await delay(shouldSimulateError && i === 2 ? 500 : 2000) // Simulate error on step 3 if error scenario
  }

  // Simulate tool:complete (with error if scenario requires it)
  const tool1Result = shouldSimulateError
    ? null
    : {
        sourceContentId: crypto.randomUUID(),
        sourceType: 'youtube',
        ingestStatus: 'ingested',
        sourceContent: {
          id: crypto.randomUUID(),
          title: 'Introduction to AI Agents',
          ingestStatus: 'ingested'
        }
      }

  if (tool1) {
    tool1.status = shouldSimulateError ? 'error' : 'success'
    tool1.result = tool1Result
    tool1.error = shouldSimulateError ? 'Failed to fetch YouTube transcript: Video not found or private' : undefined
  }

  await simulateEvent('tool:complete', {
    toolCallId: toolCallId1,
    toolName: 'source_ingest',
    success: !shouldSimulateError,
    result: tool1Result,
    error: shouldSimulateError ? 'Failed to fetch YouTube transcript: Video not found or private' : undefined,
    timestamp: new Date().toISOString()
  })

  // If error scenario, stop here and show error message
  if (shouldSimulateError) {
    const errorMessageId = crypto.randomUUID()
    const errorText = 'I encountered an error while trying to ingest the YouTube video. The video URL appears to be invalid or the video is private.'

    mockMessages.value.push({
      id: errorMessageId,
      role: 'assistant',
      parts: [{ type: 'text', text: errorText }],
      createdAt: new Date()
    })

    await simulateEvent('message:complete', {
      messageId: errorMessageId,
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

    await simulateEvent('done', {})
    mockStatus.value = 'ready'
    promptSubmitting.value = false
    return
  }

  await delay(500)

  // Simulate second tool:preparing
  const toolCallId2 = crypto.randomUUID()
  mockStreamingToolCalls.value.set(toolCallId2, {
    toolCallId: toolCallId2,
    toolName: 'content_write',
    status: 'preparing'
  })
  await simulateEvent('tool:preparing', {
    toolCallId: toolCallId2,
    toolName: 'content_write',
    timestamp: new Date().toISOString()
  })

  await delay(600)

  // Simulate tool:start
  const tool2 = mockStreamingToolCalls.value.get(toolCallId2)
  if (tool2) {
    tool2.status = 'running'
    tool2.args = {
      action: 'create',
      sourceContentId: tool1Result.sourceContentId
    }
  }
  await simulateEvent('tool:start', {
    toolCallId: toolCallId2,
    toolName: 'content_write',
    timestamp: new Date().toISOString()
  })

  // Simulate realistic progress updates for content_write (longer operation)
  const progressSteps2 = 6
  for (let i = 0; i < progressSteps2; i++) {
    const progressMsg = getProgressMessages('content_write', i)
    if (tool2) {
      tool2.progressMessage = progressMsg
    }
    await simulateEvent('tool:progress', {
      toolCallId: toolCallId2,
      message: progressMsg,
      timestamp: new Date().toISOString()
    })
    await delay(3000) // Longer delays for content generation
  }

  // Simulate tool:complete
  const tool2Result = {
    contentId: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    content: {
      id: crypto.randomUUID(),
      title: 'Introduction to AI Agents',
      slug: 'introduction-to-ai-agents'
    }
  }
  if (tool2) {
    tool2.status = 'success'
    tool2.result = tool2Result
  }
  await simulateEvent('tool:complete', {
    toolCallId: toolCallId2,
    toolName: 'content_write',
    success: true,
    result: tool2Result,
    error: undefined,
    timestamp: new Date().toISOString()
  })

  await delay(500)

  // Simulate message chunks
  const assistantMessageId = crypto.randomUUID()
  let currentAssistantMessageText = ''

  // Create temporary assistant message for streaming
  const tempAssistantMessage: ChatMessage = {
    id: assistantMessageId,
    role: 'assistant',
    parts: [{ type: 'text', text: '' }],
    createdAt: new Date()
  }
  mockMessages.value.push(tempAssistantMessage)

  const assistantText = 'I\'ve successfully created content from the YouTube video. The content includes a comprehensive introduction to AI agents with sections covering key concepts, use cases, and implementation strategies.'

  for (let i = 0; i < assistantText.length; i += 3) {
    const chunk = assistantText.slice(i, i + 3)
    currentAssistantMessageText += chunk

    // Update the message in place
    const msgIndex = mockMessages.value.findIndex(m => m.id === assistantMessageId)
    if (msgIndex >= 0) {
      const existingMessage = mockMessages.value[msgIndex]
      if (existingMessage) {
        mockMessages.value[msgIndex] = {
          id: existingMessage.id,
          role: existingMessage.role,
          parts: [{ type: 'text', text: currentAssistantMessageText }],
          createdAt: existingMessage.createdAt,
          payload: existingMessage.payload
        }
      }
    }

    await simulateEvent('message:chunk', {
      messageId: assistantMessageId,
      chunk
    })
    await delay(30)
  }

  // Simulate message:complete
  await simulateEvent('message:complete', {
    messageId: assistantMessageId,
    message: assistantText
  })

  await delay(500)

  // Simulate messages:complete (authoritative snapshot)
  const finalAssistantMessage: ChatMessage = {
    id: assistantMessageId,
    role: 'assistant',
    parts: [
      { type: 'text', text: assistantText },
      {
        type: 'tool_call',
        toolCallId: toolCallId1,
        toolName: 'source_ingest',
        status: 'success',
        args: tool1?.args,
        result: tool1Result,
        timestamp: new Date().toISOString()
      },
      {
        type: 'tool_call',
        toolCallId: toolCallId2,
        toolName: 'content_write',
        status: 'success',
        args: tool2?.args,
        result: tool2Result,
        timestamp: new Date().toISOString()
      }
    ],
    createdAt: new Date()
  }

  // Replace temporary message with final message
  const msgIndex = mockMessages.value.findIndex(m => m.id === assistantMessageId)
  if (msgIndex >= 0) {
    mockMessages.value[msgIndex] = finalAssistantMessage
  }

  // Simulate log:entry events (tool_started, tool_succeeded)
  await simulateEvent('log:entry', {
    id: crypto.randomUUID(),
    type: 'tool_started',
    message: 'Tool source_ingest started',
    payload: {
      toolName: 'source_ingest',
      args: tool1?.args
    },
    createdAt: new Date().toISOString()
  })

  await simulateEvent('log:entry', {
    id: crypto.randomUUID(),
    type: 'tool_succeeded',
    message: 'Tool source_ingest executed successfully',
    payload: {
      toolName: 'source_ingest',
      args: tool1?.args,
      result: tool1Result
    },
    createdAt: new Date().toISOString()
  })

  await simulateEvent('log:entry', {
    id: crypto.randomUUID(),
    type: 'tool_started',
    message: 'Tool content_write started',
    payload: {
      toolName: 'content_write',
      args: tool2?.args
    },
    createdAt: new Date().toISOString()
  })

  await simulateEvent('log:entry', {
    id: crypto.randomUUID(),
    type: 'tool_succeeded',
    message: 'Tool content_write executed successfully',
    payload: {
      toolName: 'content_write',
      args: tool2?.args,
      result: tool2Result
    },
    createdAt: new Date().toISOString()
  })

  // Simulate messages:complete (authoritative snapshot - matches real API structure)
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
    logs: [
      {
        id: crypto.randomUUID(),
        type: 'tool_started',
        message: 'Tool source_ingest started',
        payload: { toolName: 'source_ingest', args: tool1?.args },
        createdAt: new Date().toISOString()
      },
      {
        id: crypto.randomUUID(),
        type: 'tool_succeeded',
        message: 'Tool source_ingest executed successfully',
        payload: { toolName: 'source_ingest', args: tool1?.args, result: tool1Result },
        createdAt: new Date().toISOString()
      },
      {
        id: crypto.randomUUID(),
        type: 'tool_started',
        message: 'Tool content_write started',
        payload: { toolName: 'content_write', args: tool2?.args },
        createdAt: new Date().toISOString()
      },
      {
        id: crypto.randomUUID(),
        type: 'tool_succeeded',
        message: 'Tool content_write executed successfully',
        payload: { toolName: 'content_write', args: tool2?.args, result: tool2Result },
        createdAt: new Date().toISOString()
      }
    ]
  })

  // Simulate agentContext:update
  await simulateEvent('agentContext:update', {
    readySources: [
      {
        id: tool1Result.sourceContentId,
        title: tool1Result.sourceContent?.title || 'Introduction to AI Agents',
        sourceType: 'youtube',
        ingestStatus: 'ingested',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    ingestFailures: [],
    lastAction: 'content_write',
    toolHistory: [
      {
        toolName: 'source_ingest',
        invocation: { name: 'source_ingest', arguments: tool1?.args },
        result: { success: true, result: tool1Result }
      },
      {
        toolName: 'content_write',
        invocation: { name: 'content_write', arguments: tool2?.args },
        result: { success: true, result: tool2Result }
      }
    ],
    intentSnapshot: null
  })

  // Simulate conversation:final
  await simulateEvent('conversation:final', {
    conversationId: mockConversationId.value
  })

  // Simulate done
  await simulateEvent('done', {})

  mockStatus.value = 'ready'
  promptSubmitting.value = false
  mockStreamingToolCalls.value.clear()
}

// Handle scenario click - start it immediately
const handleScenarioClick = async (scenario: typeof scenarios[0]) => {
  if (isBusy.value)
    return
  mode.value = scenario.mode
  resetConversation()
  await simulateAgentTurn(scenario.prompt)
}

// Handle prompt submit
const handlePromptSubmit = async (value: string) => {
  if (!value.trim() || isBusy.value) {
    return
  }
  await simulateAgentTurn(value)
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
              size="xs"
            >
              {{ activeStatus }}
            </UBadge>
          </div>

          <!-- Quick Controls -->
          <div class="space-y-2">
            <!-- Simulation Speed Control -->
            <div>
              <label class="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                Speed
              </label>
              <UInputMenu
                v-model="simulationSpeed"
                :items="speedOptions.map(opt => ({ value: opt.value, label: opt.label }))"
                value-key="value"
                label-key="label"
                variant="outline"
                size="xs"
                :disabled="isBusy"
                class="w-full"
              >
                <template #leading>
                  <UIcon
                    name="i-lucide-gauge"
                    class="w-3 h-3"
                  />
                </template>
              </UInputMenu>
            </div>

            <UButton
              variant="outline"
              size="xs"
              :disabled="isBusy"
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
            <div class="space-y-2">
              <UButton
                v-for="scenario in scenarios"
                :key="scenario.id"
                variant="outline"
                size="xs"
                class="w-full justify-start text-left h-auto py-1.5"
                :disabled="isBusy"
                @click="handleScenarioClick(scenario)"
              >
                <div class="flex-1 text-left min-w-0">
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <div class="font-medium text-xs truncate">
                      {{ scenario.name }}
                    </div>
                    <UBadge
                      :color="scenario.mode === 'agent' ? 'primary' : 'neutral'"
                      variant="soft"
                      size="xs"
                    >
                      {{ scenario.mode }}
                    </UBadge>
                  </div>
                  <div class="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">
                    {{ scenario.description }}
                  </div>
                </div>
              </UButton>
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
              size="xs"
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
            v-for="(event, idx) in debugEvents.slice().reverse()"
            :key="idx"
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
