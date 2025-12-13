<script setup lang="ts">
import type { Step } from './ProgressStep.vue'
import { computed } from 'vue'

interface Props {
  step: Step
}

const props = defineProps<Props>()

// Sensitive field names to redact (case-insensitive)
const SENSITIVE_FIELDS = [
  'apiKey',
  'apikey',
  'api_key',
  'password',
  'passwd',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'secret',
  'secretKey',
  'secret_key',
  'auth',
  'authorization',
  'credential',
  'credentials',
  'privateKey',
  'private_key',
  'sessionId',
  'session_id'
]

// Recursively redact sensitive data from an object
function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData)
  }
  if (typeof obj === 'object') {
    const redacted: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase()
      const isSensitive = SENSITIVE_FIELDS.some(field => keyLower.includes(field.toLowerCase()))
      if (isSensitive && typeof value === 'string') {
        redacted[key] = value.length > 0 ? '***REDACTED***' : value
      } else if (isSensitive && value !== null && value !== undefined) {
        redacted[key] = '***REDACTED***'
      } else {
        redacted[key] = redactSensitiveData(value)
      }
    }
    return redacted
  }
  return obj
}

// Format tool arguments for display (truncate long values)
const formattedArgs = computed(() => {
  if (!props.step.args) {
    return null
  }
  try {
    // Redact sensitive data before stringifying
    const sanitized = redactSensitiveData(props.step.args)
    const formatted = JSON.stringify(sanitized, null, 2)
    // Truncate if too long
    if (formatted.length > 200) {
      return `${formatted.slice(0, 200)}...`
    }
    return formatted
  } catch {
    return '[Unable to display arguments]'
  }
})

// Format tool result for display
const formattedResult = computed(() => {
  if (!props.step.result) {
    return null
  }
  if (typeof props.step.result === 'string') {
    return props.step.result
  }
  let formatted: string
  try {
    formatted = JSON.stringify(props.step.result, null, 2)
  } catch (error) {
    // Fallback for unserializable results (e.g., circular references)
    const errorInfo = error instanceof Error ? ` (${error.message})` : ''
    formatted = `[Unserializable result]${errorInfo}: ${String(props.step.result)}`
  }
  // Truncate if too long
  if (formatted.length > 500) {
    return `${formatted.slice(0, 500)}...`
  }
  return formatted
})

const showArgs = computed(() => !!formattedArgs.value)
const showResult = computed(() => props.step.status === 'success' && formattedResult.value)
</script>

<template>
  <div class="tool-execution-step space-y-2">
    <!-- Progress Message -->
    <div
      v-if="step.progressMessage && (step.status === 'running' || step.status === 'preparing')"
      class="text-xs text-muted-600 dark:text-muted-400 italic"
    >
      {{ step.progressMessage }}
    </div>

    <!-- Tool Arguments (if available and not too long) -->
    <details
      v-if="showArgs"
      class="text-xs"
    >
      <summary class="cursor-pointer text-muted-600 dark:text-muted-400 hover:text-muted-900 dark:hover:text-muted-100">
        Arguments
      </summary>
      <pre class="mt-1 p-2 rounded bg-muted/30 dark:bg-muted-700/30 font-mono text-xs overflow-x-auto">{{ formattedArgs }}</pre>
    </details>

    <!-- Success Result -->
    <details
      v-if="showResult"
      class="text-xs"
    >
      <summary class="cursor-pointer text-success-600 dark:text-success-400 hover:text-success-900 dark:hover:text-success-100">
        Result
      </summary>
      <pre class="mt-1 p-2 rounded bg-success-50 dark:bg-success-900/20 font-mono text-xs overflow-x-auto max-h-32 overflow-y-auto">{{ formattedResult }}</pre>
    </details>

    <!-- Error Display -->
    <div
      v-if="step.status === 'error' && step.error"
      class="p-2 rounded border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400"
    >
      <UIcon
        name="i-lucide-alert-circle"
        class="h-3 w-3 inline mr-1"
      />
      {{ step.error }}
    </div>
  </div>
</template>
