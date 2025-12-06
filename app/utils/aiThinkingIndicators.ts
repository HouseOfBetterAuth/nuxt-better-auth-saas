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
    label: 'Collecting sources',
    message: 'Collecting links and transcripts...'
  },
  drafting: {
    label: 'Drafting',
    message: 'Drafting content right now...'
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
  content_generated: 'saving',
  generation_complete: 'finishing',
  section_patched: 'updating',
  user_message: 'thinking'
}

const STATUS_TO_PRESET: Record<string, keyof typeof PRESETS> = {
  submitted: 'thinking',
  streaming: 'drafting'
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

export function resolveAiThinkingIndicator(input: {
  status?: string | null
  logs?: AiThinkingLogEntry[] | null
  fallbackMessage?: string
}): IndicatorPreset {
  const latestLog = getLatestLog(input.logs)
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
