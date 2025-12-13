#!/usr/bin/env tsx

/**
 * Enhanced debug script to test endpoint performance and identify complexity
 *
 * Tests both anonymous and signed-in user flows to identify:
 * - Where signed-in users unnecessarily go through anonymous checks
 * - Performance bottlenecks
 * - Unnecessary complexity that should be removed
 *
 * Usage:
 *   pnpm dlx tsx scripts/debug-endpoint-hangs.ts
 *
 * Output: debug-endpoint-analysis.json (gitignored)
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import { config as loadEnv } from 'dotenv'

loadEnv()

const BASE_URL = process.env.DEBUG_BASE_URL || 'http://localhost:3000'
const TIMEOUT_MS = 30000 // 30 seconds
const OUTPUT_FILE = 'debug-endpoint-analysis.json'

interface EndpointTest {
  path: string
  method: string
  body?: any
  description: string
}

interface TestResult {
  endpoint: string
  method: string
  userType: 'anonymous' | 'signed-in'
  status: number | 'timeout' | 'error'
  duration: number
  error?: string
  headers?: Record<string, string>
  responseSize?: number
  timing?: {
    dns?: number
    connect?: number
    ttfb?: number // Time to first byte
    download?: number
    lastChunk?: number
  }
}

interface EndpointAnalysis {
  endpoint: string
  method: string
  anonymousResult: TestResult | null
  signedInResult: TestResult | null
  complexityIssues: string[]
  performanceIssues: string[]
  recommendations: string[]
}

interface AnalysisReport {
  timestamp: string
  baseUrl: string
  endpoints: EndpointAnalysis[]
  summary: {
    totalEndpoints: number
    slowEndpoints: number
    complexityIssues: number
    anonymousVsSignedInComparison: {
      endpointsWithDifferentBehavior: number
      endpointsWithUnnecessaryAnonymousChecks: number
    }
  }
}

const endpoints: EndpointTest[] = [
  { path: '/api/content', method: 'GET', description: 'List content (should block anonymous)' },
  { path: '/api/conversations', method: 'GET', description: 'List conversations (allows anonymous)' },
  { path: '/api/conversations?limit=10', method: 'GET', description: 'List conversations with pagination' },
  { path: '/api/auth/organization/use-active-organization', method: 'GET', description: 'Get active organization' },
  { path: '/api/chat', method: 'POST', description: 'Chat endpoint (Chat Mode)', body: { message: 'test', mode: 'chat' } },
  { path: '/api/chat', method: 'POST', description: 'Chat endpoint (Agent Mode)', body: { message: 'test', mode: 'agent' } }
]

async function testEndpoint(
  endpoint: string,
  method: string = 'GET',
  body?: any,
  cookies: string = '',
  userType: 'anonymous' | 'signed-in' = 'anonymous'
): Promise<TestResult> {
  const url = `${BASE_URL}${endpoint}`
  const startTime = Date.now()
  const timing: TestResult['timing'] = {}

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    // Measure DNS lookup and connection (approximate)
    const dnsStart = Date.now()
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': method === 'POST' && endpoint.includes('/chat') ? 'text/event-stream' : 'application/json',
        ...(cookies ? { Cookie: cookies } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    const connectTime = Date.now() - dnsStart
    timing.dns = connectTime
    timing.connect = connectTime

    // Time to first byte - measure when response starts
    const ttfbStart = Date.now()
    const responseText = await response.text()
    const ttfbTime = Date.now() - ttfbStart
    timing.ttfb = ttfbTime
    timing.download = Date.now() - startTime - ttfbTime

    const duration = Date.now() - startTime

    return {
      endpoint,
      method,
      userType,
      status: response.status,
      duration,
      headers: Object.fromEntries(response.headers.entries()),
      responseSize: responseText.length,
      timing
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    const isTimeout = error.name === 'AbortError' || duration >= TIMEOUT_MS

    return {
      endpoint,
      method,
      userType,
      status: isTimeout ? 'timeout' : 'error',
      duration,
      error: error.message,
      timing
    }
  }
}

async function testChatStreaming(
  cookies: string = '',
  userType: 'anonymous' | 'signed-in' = 'anonymous',
  mode: 'chat' | 'agent' = 'chat'
): Promise<TestResult & { timeline?: Record<string, number>, content?: string }> {
  const endpoint = `/api/chat?stream=true&mode=${mode}`
  const url = `${BASE_URL}/api/chat`
  const startTime = Date.now()
  let firstChunkTime: number | null = null
  let chunksReceived = 0
  let lastChunkTime: number | null = null

  // Track timeline events
  const timeline: Record<string, number> = {
    start: 0
  }

  // Track content
  let fullContent = ''

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(cookies ? { Cookie: cookies } : {})
      },
      body: JSON.stringify({
        message: 'test',
        mode
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const duration = Date.now() - startTime
      return {
        endpoint,
        method: 'POST',
        userType,
        status: response.status,
        duration,
        error: `HTTP ${response.status}`
      }
    }

    if (!response.body) {
      return {
        endpoint,
        method: 'POST',
        userType,
        status: 'error',
        duration: Date.now() - startTime,
        error: 'No response body'
      }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done)
          break

        if (chunksReceived === 0) {
          firstChunkTime = Date.now() - startTime
          timeline.ttfb = firstChunkTime
        }
        lastChunkTime = Date.now() - startTime
        chunksReceived++

        buffer += decoder.decode(value, { stream: true })

        // Split by double newline to handle SSE messages
        const messages = buffer.split('\n\n')
        // Keep the last partial message in buffer
        buffer = messages.pop() || ''

        for (const message of messages) {
          const lines = message.split('\n')
          let eventType = 'message'
          let data = ''

          for (const line of lines) {
            if (line.startsWith('event: '))
              eventType = line.slice(7).trim()
            if (line.startsWith('data: '))
              data = line.slice(6).trim()
          }

          if (eventType === 'message:chunk' && data) {
            try {
              const chunkData = JSON.parse(data)
              if (chunkData.chunk)
                fullContent += chunkData.chunk
            }
            catch {}
          }
          else if (eventType === 'message:complete' && data) {
            // Fallback if chunks missed? usually redundant.
          }
          else if (eventType === 'ping' && data) {
            try {
              const pingData = JSON.parse(data)
              if (pingData.stage) {
                timeline[pingData.stage] = Date.now() - startTime
              }
            }
            catch {}
          }
          else if (eventType.startsWith('tool:') && data) {
            try {
              const toolData = JSON.parse(data)
              const toolName = toolData.toolName || 'unknown'
              // Log first occurrence of each tool event type
              const eventKey = `${eventType} (${toolName})`
              if (!timeline[eventKey]) {
                timeline[eventKey] = Date.now() - startTime
              }
            }
            catch {}
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        throw error
      }
    }

    const duration = Date.now() - startTime
    timeline.total = duration

    return {
      endpoint,
      method: 'POST',
      userType,
      status: response.status,
      duration,
      responseSize: chunksReceived,
      timing: {
        ttfb: firstChunkTime || undefined,
        lastChunk: lastChunkTime || undefined
      },
      timeline,
      content: fullContent
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    const isTimeout = error.name === 'AbortError' || duration >= TIMEOUT_MS

    return {
      endpoint,
      method: 'POST',
      userType,
      status: isTimeout ? 'timeout' : 'error',
      duration,
      error: error.message
    }
  }
}

function analyzeEndpoint(
  endpoint: string,
  method: string,
  anonymousResult: TestResult | null,
  signedInResult: TestResult | null
): EndpointAnalysis {
  const issues: string[] = []
  const perfIssues: string[] = []
  const recommendations: string[] = []

  // Performance analysis
  const slowThreshold = 5000 // 5 seconds
  if (anonymousResult && anonymousResult.duration > slowThreshold) {
    perfIssues.push(`Anonymous user: ${anonymousResult.duration}ms (threshold: ${slowThreshold}ms)`)
  }
  if (signedInResult && signedInResult.duration > slowThreshold) {
    perfIssues.push(`Signed-in user: ${signedInResult.duration}ms (threshold: ${slowThreshold}ms)`)
  }

  // Complexity analysis
  if (anonymousResult && signedInResult) {
    // Check if signed-in users are going through unnecessary anonymous checks
    // If signed-in is slower than anonymous, that's suspicious
    if (signedInResult.duration > anonymousResult.duration * 1.2) {
      issues.push(`Signed-in user (${signedInResult.duration}ms) is slower than anonymous (${anonymousResult.duration}ms) - may be doing unnecessary anonymous checks`)
      recommendations.push('Review code path for signed-in users - they should be faster, not slower')
    }

    // Check if both paths have similar behavior when they shouldn't
    if (anonymousResult.status === signedInResult.status && anonymousResult.status === 200) {
      // Both succeed - check if endpoint should block anonymous
      if (endpoint === '/api/content') {
        issues.push('Both anonymous and signed-in users can access /api/content - endpoint should block anonymous')
        recommendations.push('Add explicit anonymous check: if (user.isAnonymous) throw 401')
      }
    }

    // Check if anonymous path is doing unnecessary work
    if (anonymousResult.duration > 3000 && signedInResult.duration < 1000) {
      issues.push(`Anonymous path (${anonymousResult.duration}ms) is much slower than signed-in (${signedInResult.duration}ms) - anonymous may be doing unnecessary database queries`)
      recommendations.push('Optimize anonymous user flow - cache or skip unnecessary queries')
    }
  }

  // Status code analysis
  if (anonymousResult?.status === 'timeout') {
    issues.push('Anonymous user request timed out')
    recommendations.push('Investigate why anonymous flow exceeds timeout - likely database query issue')
  }
  if (signedInResult?.status === 'timeout') {
    issues.push('Signed-in user request timed out')
    recommendations.push('Investigate why signed-in flow exceeds timeout')
  }

  // Check for unnecessary anonymous checks in signed-in flow
  if (signedInResult && anonymousResult && signedInResult.duration > 2000) {
    // If signed-in is slow, check if it's doing anonymous-specific work
    if (endpoint.includes('conversations') || endpoint.includes('chat')) {
      issues.push('Signed-in user flow may be executing anonymous-specific code paths unnecessarily')
      recommendations.push('Add early return for signed-in users: if (!user.isAnonymous) { /* fast path */ }')
    }
  }

  return {
    endpoint,
    method,
    anonymousResult,
    signedInResult,
    complexityIssues: issues,
    performanceIssues: perfIssues,
    recommendations
  }
}

async function main() {
  const scriptStartTime = Date.now()
  console.log('🚀 Enhanced Endpoint Analysis')
  console.log(`📍 Base URL: ${BASE_URL}`)
  console.log(`⏱️  Timeout: ${TIMEOUT_MS}ms\n`)

  const analyses: EndpointAnalysis[] = []

  // Test as anonymous user
  console.log('🔍 Testing as ANONYMOUS user...\n')
  const anonymousResults: Map<string, TestResult> = new Map()

  // Warm up anonymous session to exclude provisioning/creation time from metrics
  // Use a faster endpoint for warm-up (conversations is now optimized to be very fast)
  process.stdout.write('  🔥 Warming up anonymous session... ')
  const warmUpResult = await testEndpoint('/api/conversations', 'GET', undefined, '', 'anonymous')

  let anonymousCookie = ''
  if (warmUpResult.headers && warmUpResult.headers['set-cookie']) {
    const setCookie = warmUpResult.headers['set-cookie']
    // Handle array or string
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
    anonymousCookie = cookies.map(c => c.split(';')[0]).join('; ')
  }
  console.log('Done\n')

  // Test endpoints in parallel for faster execution
  console.log(`  Testing ${endpoints.length} endpoints in parallel...`)
  const endpointPromises = endpoints.map(async ({ path, method, body }) => {
    const shouldSendBody = ['POST', 'PUT', 'PATCH'].includes(method) && body
    const result = await testEndpoint(path, method, shouldSendBody ? body : undefined, anonymousCookie, 'anonymous')
    return { key: `${method}:${path}`, result, path, method }
  })

  // Wait for all tests to complete with progress
  let completed = 0
  const endpointResults = await Promise.all(
    endpointPromises.map(async (promise) => {
      const result = await promise
      completed++
      process.stdout.write(`\r  Progress: ${completed}/${endpoints.length} endpoints tested...`)
      return result
    })
  )
  console.log('') // New line after progress

  // Process results and log
  for (const { key, result, path, method } of endpointResults) {
    anonymousResults.set(key, result)
    process.stdout.write(`  ${method} ${path}... `)

    if (result.status === 'timeout') {
      console.log(`❌ TIMEOUT (${result.duration}ms)`)
    } else if (result.status === 'error') {
      console.log(`❌ ERROR: ${result.error}`)
    } else if (result.status >= 200 && result.status < 300) {
      console.log(`✅ ${result.status} (${result.duration}ms)`)
    } else if (result.status === 401 || result.status === 403) {
      console.log(`⚠️  ${result.status} (${result.duration}ms) - Expected for anonymous`)
    } else {
      console.log(`⚠️  ${result.status} (${result.duration}ms)`)
    }
  }

  // Test chat streaming separately
  process.stdout.write('  Testing POST /api/chat?stream=true (streaming)... ')
  const chatResult = await testChatStreaming(anonymousCookie, 'anonymous', 'chat')
  anonymousResults.set('POST:/api/chat?stream=true', chatResult)
  if (chatResult.status === 200) {
    console.log(`✅ ${chatResult.status} (first chunk: ${chatResult.timing?.ttfb}ms)`)
    if ((chatResult as any).timeline) {
      const timeline = (chatResult as any).timeline
      const sortedKeys = Object.keys(timeline).sort((a, b) => timeline[a] - timeline[b])
      sortedKeys.forEach((key) => {
        if (key !== 'start')
          console.log(`    ⏱️  ${key}: +${timeline[key]}ms`)
      })
    }
  } else {
    console.log(`❌ ${chatResult.status} (${chatResult.duration}ms)`)
  }

  // Test as signed-in user
  console.log('\n🔍 Testing as SIGNED-IN user...\n')

  const signedInResults: Map<string, TestResult> = new Map()
  let cookie = process.env.COOKIE || ''

  // Try to sign in programmatically if no cookie provided
  if (!cookie) {
    const testEmail = process.env.TEST_EMAIL || process.env.NUXT_TEST_EMAIL
    const testPassword = process.env.TEST_PASSWORD || process.env.NUXT_TEST_PASSWORD

    if (testEmail && testPassword) {
      console.log(`  Signing in as ${testEmail}...`)
      try {
        const signInResponse = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: testEmail,
            password: testPassword
          })
        })

        if (signInResponse.ok) {
          // Extract cookies from response headers
          // Note: fetch doesn't expose Set-Cookie headers directly for security
          // We need to use a cookie jar or store cookies manually
          // For now, we'll use a simple approach: store cookies from the response
          const setCookieHeader = signInResponse.headers.get('set-cookie')
          if (setCookieHeader) {
            // Extract all cookie name=value pairs
            const cookies: string[] = []
            const cookieStrings = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]

            for (const cookieStr of cookieStrings) {
              // Extract name=value from each cookie (before first semicolon)
              const cookieParts = cookieStr.split(';')
              if (cookieParts.length > 0) {
                cookies.push(cookieParts[0].trim())
              }
            }

            if (cookies.length > 0) {
              cookie = cookies.join('; ')
              console.log('  ✅ Signed in successfully\n')
            } else {
              console.log('  ⚠️  Sign in succeeded but no cookies found\n')
            }
          } else {
            console.log('  ⚠️  Sign in succeeded but no Set-Cookie header found\n')
            console.log('  💡 Tip: Some environments may not expose Set-Cookie headers')
            console.log('  💡 You can manually set COOKIE env var with session cookie\n')
          }
        } else {
          const errorData = await signInResponse.text()
          console.log(`  ⚠️  Sign in failed: ${signInResponse.status} - ${errorData.substring(0, 100)}\n`)
          console.log('  ⏭️  Skipping signed-in tests\n')
        }
      } catch (error: any) {
        console.log(`  ⚠️  Sign in error: ${error.message}\n`)
        console.log('  ⏭️  Skipping signed-in tests\n')
      }
    } else {
      console.log('  ⚠️  No TEST_EMAIL/TEST_PASSWORD env vars set')
      console.log('  ⚠️  Set TEST_EMAIL and TEST_PASSWORD to test signed-in user flows\n')
    }
  }

  if (cookie) {
    // Test endpoints in parallel for faster execution
    console.log(`  Testing ${endpoints.length} endpoints in parallel...`)
    const signedInPromises = endpoints.map(async ({ path, method, body }) => {
      const shouldSendBody = ['POST', 'PUT', 'PATCH'].includes(method) && body
      const result = await testEndpoint(path, method, shouldSendBody ? body : undefined, cookie, 'signed-in')
      return { key: `${method}:${path}`, result, path, method }
    })

    // Wait for all tests to complete with progress
    let completed = 0
    const signedInEndpointResults = await Promise.all(
      signedInPromises.map(async (promise) => {
        const result = await promise
        completed++
        process.stdout.write(`\r  Progress: ${completed}/${endpoints.length} endpoints tested...`)
        return result
      })
    )
    console.log('') // New line after progress

    // Process results and log
    for (const { key, result, path, method } of signedInEndpointResults) {
      signedInResults.set(key, result)
      process.stdout.write(`  ${method} ${path}... `)

      if (result.status === 'timeout') {
        console.log(`❌ TIMEOUT (${result.duration}ms)`)
      } else if (result.status === 'error') {
        console.log(`❌ ERROR: ${result.error}`)
      } else if (result.status >= 200 && result.status < 300) {
        console.log(`✅ ${result.status} (${result.duration}ms)`)
      } else {
        console.log(`⚠️  ${result.status} (${result.duration}ms)`)
      }
    }

    process.stdout.write('  Testing POST /api/chat?stream=true&mode=chat (Chat Mode)... ')
    const signedInChatModeResult = await testChatStreaming(cookie, 'signed-in', 'chat')
    if (signedInChatModeResult.status === 200) {
      console.log(`✅ ${signedInChatModeResult.status} (first: ${signedInChatModeResult.timing?.ttfb}ms, last: ${signedInChatModeResult.timing?.lastChunk}ms, total: ${signedInChatModeResult.duration}ms, chunks: ${signedInChatModeResult.responseSize})`)
      if ((signedInChatModeResult as any).content) {
        const content = (signedInChatModeResult as any).content
        console.log(`    📝  Content Length: ${content.length} chars`)
        console.log(`    📝  Preview: "${content.substring(0, 80).replace(/\n/g, ' ')}..."`)
      }
      if ((signedInChatModeResult as any).timeline) {
        const timeline = (signedInChatModeResult as any).timeline
        const sortedKeys = Object.keys(timeline).sort((a, b) => timeline[a] - timeline[b])
        sortedKeys.forEach((key) => {
          if (key !== 'start')
            console.log(`    ⏱️  ${key}: +${timeline[key]}ms`)
        })
      }
    } else {
      console.log(`❌ ${signedInChatModeResult.status} (${signedInChatModeResult.duration}ms)`)
    }

    process.stdout.write('  Testing POST /api/chat?stream=true&mode=agent (Agent Mode)... ')
    const signedInChatResult = await testChatStreaming(cookie, 'signed-in', 'agent')
    signedInResults.set('POST:/api/chat?stream=true', signedInChatResult)
    if (signedInChatResult.status === 200) {
      console.log(`✅ ${signedInChatResult.status} (first chunk: ${signedInChatResult.timing?.ttfb}ms)`)
      if ((signedInChatResult as any).timeline) {
        const timeline = (signedInChatResult as any).timeline
        const sortedKeys = Object.keys(timeline).sort((a, b) => timeline[a] - timeline[b])
        sortedKeys.forEach((key) => {
          if (key !== 'start')
            console.log(`    ⏱️  ${key}: +${timeline[key]}ms`)
        })
      }
    } else {
      console.log(`❌ ${signedInChatResult.status} (${signedInChatResult.duration}ms)`)
    }
  } else {
    console.log('  ⏭️  Skipping signed-in tests (no COOKIE env var set)')
  }

  // Analyze each endpoint
  console.log('\n📊 Analyzing endpoints...\n')

  for (const { path, method } of endpoints) {
    const key = `${method}:${path}`
    const anonymousResult = anonymousResults.get(key) || null
    const signedInResult = signedInResults.get(key) || null

    const analysis = analyzeEndpoint(path, method, anonymousResult, signedInResult)
    analyses.push(analysis)

    if (analysis.complexityIssues.length > 0 || analysis.performanceIssues.length > 0) {
      console.log(`\n  ${method} ${path}:`)
      if (analysis.performanceIssues.length > 0) {
        console.log(`    ⚠️  Performance: ${analysis.performanceIssues.join(', ')}`)
      }
      if (analysis.complexityIssues.length > 0) {
        console.log(`    ⚠️  Complexity: ${analysis.complexityIssues.join(', ')}`)
      }
      if (analysis.recommendations.length > 0) {
        console.log(`    💡 Recommendations: ${analysis.recommendations.join('; ')}`)
      }
    }
  }

  // Analyze chat endpoint
  const chatKey = 'POST:/api/chat?stream=true'
  const anonymousChatResult = anonymousResults.get(chatKey) || null
  const signedInChatResult = signedInResults.get(chatKey) || null
  const chatAnalysis = analyzeEndpoint('/api/chat?stream=true', 'POST', anonymousChatResult, signedInChatResult)
  analyses.push(chatAnalysis)

  // Generate summary (optimized with single pass)
  let slowEndpoints = 0
  let complexityIssues = 0
  let differentBehavior = 0
  let unnecessaryChecks = 0

  for (const analysis of analyses) {
    if ((analysis.anonymousResult && analysis.anonymousResult.duration > 5000)
      || (analysis.signedInResult && analysis.signedInResult.duration > 5000)) {
      slowEndpoints++
    }
    complexityIssues += analysis.complexityIssues.length
    if (analysis.anonymousResult && analysis.signedInResult
      && analysis.anonymousResult.status !== analysis.signedInResult.status) {
      differentBehavior++
    }
    if (analysis.anonymousResult && analysis.signedInResult
      && analysis.signedInResult.duration > analysis.anonymousResult.duration * 1.2) {
      unnecessaryChecks++
    }
  }

  const report: AnalysisReport = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    endpoints: analyses,
    summary: {
      totalEndpoints: analyses.length,
      slowEndpoints,
      complexityIssues,
      anonymousVsSignedInComparison: {
        endpointsWithDifferentBehavior: differentBehavior,
        endpointsWithUnnecessaryAnonymousChecks: unnecessaryChecks
      }
    }
  }

  // Write to file
  const outputPath = join(process.cwd(), OUTPUT_FILE)
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  const totalExecutionTime = Date.now() - scriptStartTime
  console.log(`\n✅ Analysis saved to: ${OUTPUT_FILE}`)
  console.log(`\n📈 Summary:`)
  console.log(`   - Total endpoints tested: ${report.summary.totalEndpoints}`)
  console.log(`   - Slow endpoints (>5s): ${report.summary.slowEndpoints}`)
  console.log(`   - Complexity issues found: ${report.summary.complexityIssues}`)
  console.log(`   - Endpoints with different behavior: ${report.summary.anonymousVsSignedInComparison.endpointsWithDifferentBehavior}`)
  console.log(`   - Endpoints with unnecessary anonymous checks: ${report.summary.anonymousVsSignedInComparison.endpointsWithUnnecessaryAnonymousChecks}`)
  console.log(`\n⏱️  Total execution time: ${(totalExecutionTime / 1000).toFixed(2)}s`)
}

main().catch((error) => {
  console.error('Debug script failed:', error)
  process.exit(1)
})
