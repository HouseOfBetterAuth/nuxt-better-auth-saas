interface IndicatorPreset {
  label: string
  message: string
}

const PRESETS = {
  thinking: {
    label: 'Thinking',
    message: 'Thinking...'
  },
  generating: {
    label: 'Generating',
    message: 'Generating response...'
  }
} as const satisfies Record<string, IndicatorPreset>

export function resolveAiThinkingIndicator(input: {
  status?: string | null
  fallbackMessage?: string
  activeSince?: Date | string | number | null
  currentActivity?: 'thinking' | 'streaming' | null
  currentToolName?: string | null
}): IndicatorPreset {
  // Priority 1: Use currentActivity state (most accurate for streaming)
  if (input.currentActivity === 'streaming') {
    return PRESETS.generating
  }

  if (input.currentActivity === 'thinking') {
    return PRESETS.thinking
  }

  // Priority 2: Use status
  const status = (input.status || '').toLowerCase()
  if (status === 'streaming') {
    return PRESETS.generating
  }

  if (status === 'submitted') {
    return PRESETS.thinking
  }

  // Fallback
  if (input.fallbackMessage) {
    return {
      label: 'Working',
      message: input.fallbackMessage
    }
  }

  return PRESETS.thinking
}
