export interface AiThinkingLogEntry {
  type?: string | null
  message?: string | null
  createdAt?: string | Date | null
}

interface IndicatorPreset {
  label: string
  message: string
}

const PRESETS: Record<string, IndicatorPreset> = {
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
}

const LOG_TYPE_TO_PRESET: Record<string, keyof typeof PRESETS> = {
  source_detected: 'collecting',
  generation_started: 'drafting',
  content_generated: 'saving',
  generation_complete: 'finishing',
  section_patched: 'updating',
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
}): IndicatorPreset {
  const activeSinceTime = normalizeTimestamp(input.activeSince)
  const scopedLogs = activeSinceTime
    ? (input.logs ?? []).filter((log) => {
        const logTime = normalizeTimestamp(log.createdAt)
        return logTime == null || logTime >= activeSinceTime
      })
    : input.logs

  const latestLog = getLatestLog(scopedLogs)
  const presetFromLog = latestLog?.type ? LOG_TYPE_TO_PRESET[(latestLog.type || '').toLowerCase()] : null

  if (presetFromLog && PRESETS[presetFromLog])
    return PRESETS[presetFromLog]

  const presetFromStatus = input.status ? STATUS_TO_PRESET[(input.status || '').toLowerCase()] : null
  if (presetFromStatus && PRESETS[presetFromStatus])
    return PRESETS[presetFromStatus]

  if (input.fallbackMessage) {
    return {
      label: 'Working',
      message: input.fallbackMessage
    }
  }

  return PRESETS.thinking
}
