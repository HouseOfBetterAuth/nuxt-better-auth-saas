#!/usr/bin/env tsx
/**
 * Manual regression test for the organization creation workflow.
 *
 * Usage:
 *   pnpm dlx tsx tests/manual/organization-test.ts
 *
 * Environment variables:
 *   NUXT_TEST_APP_URL      -> Target host (default: http://localhost:3000)
 *   NUXT_TEST_EMAIL        -> Test user email (required)
 *   NUXT_TEST_PASSWORD     -> Test user password (required)
 *   NUXT_BETTER_AUTH_SECRET-> Used to mint a verification JWT for auto-verification (required)
 */

import type { APIRequestContext, APIResponse } from 'playwright-core'
import { resolve } from 'path'
import { createEmailVerificationToken } from 'better-auth/api'
import { config } from 'dotenv'
import { Pool } from 'pg'
import { request as playwrightRequest } from 'playwright-core'

try {
  config({ path: resolve(process.cwd(), '.env') })
} catch {
  // It is fine if the file does not exist.
}

const host = process.env.NUXT_TEST_APP_URL || 'http://localhost:3000'
const testEmail = process.env.NUXT_TEST_EMAIL
const testPassword = process.env.NUXT_TEST_PASSWORD
const betterAuthSecret = process.env.NUXT_BETTER_AUTH_SECRET
const normalizedEmail = testEmail?.toLowerCase()
const databaseUrl = process.env.NUXT_TEST_DATABASE_URL || process.env.DATABASE_URL
const dbPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null

if (!testEmail || !testPassword) {
  console.error('❌ NUXT_TEST_EMAIL and NUXT_TEST_PASSWORD are required (set them in your .env).')
  process.exit(1)
}

if (!betterAuthSecret) {
  console.error('❌ NUXT_BETTER_AUTH_SECRET is required to mint verification tokens during the test.')
  process.exit(1)
}

interface TestResult {
  step: string
  success: boolean
  message?: string
  data?: Record<string, any>
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface DbUser {
  id: string
  emailVerified: boolean
}

const getDbUser = async (): Promise<DbUser | null> => {
  if (!dbPool || !normalizedEmail)
    return null

  const result = await dbPool.query<DbUser>('select id, email_verified as "emailVerified" from "user" where lower(email) = lower($1) limit 1', [normalizedEmail])
  return result.rows[0] || null
}

const waitForEmailVerification = async (timeoutMs = 5000) => {
  if (!dbPool)
    return false
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const user = await getDbUser()
    if (user?.emailVerified)
      return true
    await sleep(250)
  }
  return false
}

const responseOk = (response: APIResponse): boolean => {
  try {
    return response.ok()
  } catch {
    const status = response.status()
    return status >= 200 && status < 300
  }
}

async function parseResponse(response: APIResponse) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.substring(0, 500) }
  }
}

async function signOut(context: APIRequestContext, results: TestResult[]) {
  console.log('Step 1: Signing out...')
  const response = await context.post('/api/auth/sign-out')
  const status = response.status()
  const ok = responseOk(response) || status === 401 || status === 415
  results.push({
    step: 'Sign Out',
    success: ok,
    message: `Status: ${status}`
  })
  console.log(`ℹ️  Sign out status: ${status}`)
}

async function signUp(context: APIRequestContext) {
  const response = await context.post('/api/auth/sign-up/email', {
    data: {
      email: testEmail,
      password: testPassword,
      name: testEmail.split('@')[0]
    }
  })
  return { response, data: await parseResponse(response) }
}

async function signIn(context: APIRequestContext) {
  const response = await context.post('/api/auth/sign-in/email', {
    data: {
      email: testEmail,
      password: testPassword
    }
  })
  return { response, data: await parseResponse(response) }
}

async function autoVerifyEmail(context: APIRequestContext, results: TestResult[]) {
  if (!normalizedEmail) {
    console.log('⚠️  Cannot auto verify without a normalized email address.')
    return false
  }

  console.log('Attempting automatic email verification...')
  const token = await createEmailVerificationToken(betterAuthSecret!, normalizedEmail)
  const response = await context.get('/api/auth/verify-email', {
    params: { token }
  })
  const data = await parseResponse(response)
  const ok = responseOk(response)
  if (!ok) {
    results.push({
      step: 'Email Verification',
      success: false,
      message: `Status: ${response.status()}`,
      data
    })
    console.log('❌ Email verification request failed:', response.status(), data)
    return false
  }

  const verified = await waitForEmailVerification()
  results.push({
    step: 'Email Verification',
    success: verified,
    message: verified ? 'Email verified via /api/auth/verify-email' : 'Verification endpoint succeeded but email is still unverified',
    data: verified ? undefined : data
  })

  if (!verified) {
    console.log('⚠️  Verification endpoint succeeded but the user still appears unverified in the database.')
    return false
  }

  console.log('✅ Email verified successfully.')
  await sleep(500)
  return true
}

async function ensureAuthenticatedSession(context: APIRequestContext, results: TestResult[]) {
  console.log('\nStep 2: Ensuring authenticated session...')
  let { response, data } = await signIn(context)
  let status = response.status()
  let ok = responseOk(response)
  console.log(`   Sign in response: ${status} ${ok ? 'OK' : 'FAILED'}`)
  if (!ok) {
    console.log('   Sign in payload:', data)
  }

  if (!ok && data?.code === 'INVALID_EMAIL_OR_PASSWORD') {
    console.log('User not found. Creating test user...')
    const { response: signUpResponse, data: signUpData } = await signUp(context)
    const signUpOk = responseOk(signUpResponse)
    if (!signUpOk) {
      throw new Error(`Sign up failed: ${signUpResponse.status()} -> ${JSON.stringify(signUpData)}`)
    }
    await sleep(500)
    ;({ response, data } = await signIn(context))
    status = response.status()
    ok = responseOk(response)
  }

  if (!ok && data?.code === 'EMAIL_NOT_VERIFIED') {
    const verified = await autoVerifyEmail(context, results)
    if (!verified) {
      throw new Error('Email verification failed. Check resend logs for the verification link.')
    }
    ;({ response, data } = await signIn(context))
    status = response.status()
    ok = responseOk(response)
    console.log(`   Sign in after verification: ${status} ${ok ? 'OK' : 'FAILED'}`)
    if (!ok) {
      console.log('   Payload:', data)
    }
  }

  if (!ok) {
    throw new Error(`Sign in failed: ${status} -> ${JSON.stringify(data)}`)
  }

  if (!data?.user?.email) {
    throw new Error(`Sign in succeeded but no user information returned. Response: ${JSON.stringify(data)}`)
  }

  results.push({
    step: 'Sign In',
    success: true,
    message: `Signed in as ${data?.user?.email}`
  })
  console.log(`✅ Signed in as ${data?.user?.email}`)
}

async function verifySession(context: APIRequestContext, results: TestResult[]) {
  console.log('\nStep 3: Verifying session...')
  const response = await context.get('/api/auth/get-session')
  const data = await parseResponse(response)
  const ok = responseOk(response)
  if (!ok || !data?.user) {
    throw new Error('Session lookup failed - cannot continue without a valid session.')
  }
  results.push({
    step: 'Verify Session',
    success: true,
    message: `Session user: ${data.user.email}`,
    data: { emailVerified: data.user.emailVerified }
  })
  console.log(`✅ Session verified for ${data.user.email} (verified: ${data.user.emailVerified})`)
}

async function createOrganization(context: APIRequestContext, results: TestResult[]) {
  console.log('\nStep 4: Creating organization...')
  const slug = `test-org-${Date.now()}`
  const response = await context.post('/api/auth/organization/create', {
    data: { name: 'Test Organization', slug }
  })
  const data = await parseResponse(response)
  const ok = responseOk(response)
  if (!ok) {
    throw new Error(`Organization creation failed: ${response.status()} -> ${JSON.stringify(data)}`)
  }
  const organizationId = data?.id ?? data?.organization?.id
  const organizationName = data?.name ?? data?.organization?.name ?? slug
  if (!organizationId) {
    throw new Error(`Organization creation returned no id: ${JSON.stringify(data)}`)
  }
  results.push({
    step: 'Create Organization',
    success: true,
    message: `Created org ${organizationName}`,
    data: { id: organizationId, slug: data?.slug ?? data?.organization?.slug ?? slug }
  })
  console.log(`✅ Organization created (${organizationId})`)
  return organizationId as string
}

async function setActiveOrganization(context: APIRequestContext, organizationId: string, results: TestResult[]) {
  console.log('\nStep 5: Setting active organization...')
  const response = await context.post('/api/auth/organization/set-active', {
    data: { organizationId }
  })
  const ok = responseOk(response)
  const status = response.status()
  const body = ok ? undefined : await parseResponse(response)
  results.push({
    step: 'Set Active Organization',
    success: ok,
    message: `Status: ${status}`,
    data: body
  })
  if (!ok) {
    throw new Error(`Failed to set active org: ${status} -> ${JSON.stringify(body)}`)
  }
  console.log('✅ Active organization updated.')
}

async function fetchFullData(context: APIRequestContext, results: TestResult[]) {
  console.log('\nStep 6: Fetching /api/organization/full-data...')
  const response = await context.get('/api/organization/full-data')
  const data = await parseResponse(response)
  const ok = responseOk(response)
  results.push({
    step: 'Full Data Endpoint',
    success: ok && !!data.organization,
    message: data.organization ? `Org: ${data.organization.name}` : 'No organization returned',
    data: { hasOrg: !!data.organization }
  })
  if (!ok) {
    throw new Error(`full-data failed: ${response.status()} -> ${JSON.stringify(data)}`)
  }
  console.log('✅ full-data endpoint responded with organization data.')
}

async function fetchIntegrations(context: APIRequestContext, results: TestResult[]) {
  console.log('\nStep 7: Fetching /api/organization/integrations...')
  const response = await context.get('/api/organization/integrations')
  const data = await parseResponse(response)
  const ok = responseOk(response)
  results.push({
    step: 'Integrations Endpoint',
    success: ok,
    message: `Status: ${response.status()}`,
    data: { hasData: !!data }
  })
  if (!ok) {
    throw new Error(`integrations failed: ${response.status()} -> ${JSON.stringify(data)}`)
  }
  console.log('✅ integrations endpoint responded successfully.')
}

async function testOrganizationCreation(): Promise<void> {
  const results: TestResult[] = []
  console.log('🧪 Testing organization creation after re-authentication\n')
  console.log(`Host:  ${host}`)
  console.log(`Email: ${testEmail}\n`)

  const context = await playwrightRequest.newContext({
    baseURL: host,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      Origin: host,
      Referer: `${host}/`
    }
  })

  try {
    await signOut(context, results)
    await ensureAuthenticatedSession(context, results)
    await verifySession(context, results)
    const orgId = await createOrganization(context, results)
    await setActiveOrganization(context, orgId, results)
    await fetchFullData(context, results)
    await fetchIntegrations(context, results)

    console.log(`\n${'='.repeat(60)}`)
    console.log('📊 Test Summary')
    console.log('='.repeat(60))
    const allPassed = results.every(result => result.success)
    for (const result of results) {
      const icon = result.success ? '✅' : '❌'
      console.log(`${icon} ${result.step}: ${result.message || 'OK'}`)
      if (result.data && !result.success) {
        console.log('   Details:', JSON.stringify(result.data, null, 2))
      }
    }
    console.log('='.repeat(60))
    console.log(allPassed ? '✅ All checks passed' : '❌ Some steps failed')
    console.log('='.repeat(60))

    if (!allPassed) {
      process.exit(1)
    }
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message)
    process.exit(1)
  } finally {
    await context.dispose()
    if (dbPool) {
      await dbPool.end().catch(() => {})
    }
  }
}

testOrganizationCreation()
