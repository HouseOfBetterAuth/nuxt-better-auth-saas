export interface AiThinkingLogEntry {
  type?: string | null
  message?: string | null
  createdAt?: string | Date | null
}

interface IndicatorPreset {
  label: string
  message: string
}

const PRESETS = {
  thinking: {
    label: 'Thinking',
    message: 'Analyzing your request...'
  },
  collecting: {
    label: 'Transcribing',
    message: 'Transcribing your source...'
  },
  drafting: {
    label: 'Drafting',
    message: 'Drafting your post right now...'
  },
  updating: {
    label: 'Updating',
    message: 'Applying changes to your draft...'
  },
  saving: {
    label: 'Saving',
    message: 'Saving your draft and syncing sections...'
  },
  finishing: {
    label: 'Finishing up',
    message: 'Wrapping up the latest draft updates...'
  }
} as const satisfies Record<string, IndicatorPreset>

const LOG_TYPE_TO_PRESET: Record<string, keyof typeof PRESETS> = {
  user_message: 'thinking'
}

const STATUS_TO_PRESET: Record<string, keyof typeof PRESETS> = {
  submitted: 'thinking',
  streaming: 'collecting'
}

function getLatestLog(logs?: AiThinkingLogEntry[] | null): AiThinkingLogEntry | null {
  if (!Array.isArray(logs) || logs.length === 0)
    return null

  return logs.reduce<AiThinkingLogEntry | null>((latest, current) => {
    const latestTime = latest?.createdAt ? new Date(latest.createdAt).getTime() : -Infinity
    const currentTime = current?.createdAt ? new Date(current.createdAt).getTime() : -Infinity
    return currentTime > latestTime ? current : latest
  }, null)
}

function normalizeTimestamp(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isFinite(time) ? time : null
}

export function resolveAiThinkingIndicator(input: {
  status?: string | null
  logs?: AiThinkingLogEntry[] | null
  fallbackMessage?: string
  activeSince?: Date | string | number | null
  currentActivity?: 'llm_thinking' | 'tool_executing' | 'streaming_message' | null
  currentToolName?: string | null
}): IndicatorPreset {
  const activeSinceTime = normalizeTimestamp(input.activeSince)
  const scopedLogs = activeSinceTime
    ? (input.logs ?? []).filter((log) => {
        const logTime = normalizeTimestamp(log.createdAt)
        return logTime == null || logTime >= activeSinceTime
      })
    : input.logs

  const latestLog = getLatestLog(scopedLogs)

  // Priority 1: Use currentActivity state (most accurate for streaming)
  if (input.currentActivity === 'tool_executing' && input.currentToolName) {
    const toolDisplayName = input.currentToolName.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    return {
      label: 'Running',
      message: `Running ${toolDisplayName}...`
    }
  }

  if (input.currentActivity === 'streaming_message') {
    return {
      label: 'Generating',
      message: 'Generating response...'
    }
  }

  if (input.currentActivity === 'llm_thinking') {
    return PRESETS.thinking
  }

  // Priority 2: Handle tool_* log types with custom messages
  if (latestLog?.type && latestLog.type.toLowerCase().startsWith('tool_')) {
    const payload = latestLog as any
    const toolName = payload?.payload?.toolName || 'tool'
    const toolDisplayName = toolName.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    const logTypeLower = latestLog.type.toLowerCase()

    if (logTypeLower === 'tool_started') {
      return {
        label: 'Running',
        message: `Running ${toolDisplayName}...`
      }
    }
    if (logTypeLower === 'tool_retrying') {
      return {
        label: 'Retrying',
        message: `Retrying ${toolDisplayName}...`
      }
    }
    if (logTypeLower === 'tool_failed') {
      return {
        label: 'Error',
        message: `${toolDisplayName} failed. Retrying...`
      }
    }
    if (logTypeLower === 'tool_succeeded') {
      return {
        label: 'Complete',
        message: `${toolDisplayName} completed successfully.`
      }
    }
  }

  const presetFromLog = latestLog?.type ? LOG_TYPE_TO_PRESET[(latestLog.type || '').toLowerCase()] : null

  if (presetFromLog && PRESETS[presetFromLog]) {
    const preset = PRESETS[presetFromLog]
    if (preset)
      return preset
  }

  const presetFromStatus = input.status ? STATUS_TO_PRESET[(input.status || '').toLowerCase()] : null
  if (presetFromStatus && PRESETS[presetFromStatus]) {
    const preset = PRESETS[presetFromStatus]
    if (preset)
      return preset
  }

  if (input.fallbackMessage) {
    return {
      label: 'Working',
      message: input.fallbackMessage
    }
  }

  return PRESETS.thinking
}
