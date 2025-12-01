#!/usr/bin/env tsx

/**
 * Manual Chat Test Runner
 *
 * Run this script to manually test chat functionality:
 * npx tsx tests/manual/chat-runner.ts
 */

import { chatTestScenarios, createChatTestRunner } from '../utils/chatTestUtils'

async function runManualTests() {
  console.log('🤖 Starting Manual Chat Tests...\n')

  const runner = createChatTestRunner()

  try {
    // Test 1: Basic content creation
    console.log('📝 Test 1: Basic Content Creation')
    console.log('='.repeat(50))

    const contentResult = await chatTestScenarios.basicContentCreation(runner)
    console.log('✅ Success:', contentResult.success)
    console.log('📄 Content ID:', contentResult.contentId)
    console.log('📋 Transcript:')
    console.log(contentResult.transcript)
    console.log('\n')

    // Test 2: Section editing (if content was created)
    if (contentResult.contentId) {
      console.log('✏️  Test 2: Section Editing')
      console.log('='.repeat(50))

      const editResult = await chatTestScenarios.sectionEditing(runner, contentResult.contentId)
      console.log('✅ Success:', editResult.success)
      console.log('📋 Response:', editResult.response.assistantMessage)
      console.log('\n')
    }

    // Test 3: Multi-turn conversation
    runner.reset()
    console.log('💬 Test 3: Multi-turn Conversation')
    console.log('='.repeat(50))

    const conversationResult = await chatTestScenarios.multiTurnConversation(runner)
    console.log('✅ Messages sent:', conversationResult.messageCount)
    console.log('🔗 Session maintained:', conversationResult.sessionMaintained)
    console.log('📋 Transcript:')
    console.log(conversationResult.transcript)
    console.log('\n')

    // Test 4: URL processing
    runner.reset()
    console.log('🔗 Test 4: URL Processing')
    console.log('='.repeat(50))

    const urlResult = await chatTestScenarios.urlProcessing(runner)
    console.log('✅ Has actions:', urlResult.hasActions)
    console.log('📊 Action count:', urlResult.actionCount)
    console.log('\n')

    console.log('🎉 All manual tests completed!')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Custom test scenarios
async function runCustomScenario() {
  console.log('🎯 Running Custom Scenario...\n')

  const runner = createChatTestRunner()

  try {
    // Simulate a real user workflow
    console.log('User: I need help writing a blog post about sustainable living')
    const response1 = await runner.sendMessage(
      'I need help writing a blog post about sustainable living for beginners'
    )
    console.log('Assistant:', response1.assistantMessage)
    console.log('')

    console.log('User: Generate the blog post now')
    const response2 = await runner.sendMessage('Generate this blog post', {
      type: 'generate_content',
      contentType: 'blog_post',
      transcript: 'Sustainable living week recap: I explored composting, neighborhood swaps, and cutting down waste.'
    })
    console.log('Assistant:', response2.assistantMessage)
    console.log('Content created with ID:', response2.generation?.content?.id)
    console.log('')

    if (response2.generation?.content?.id) {
      console.log('User: Make the introduction more engaging')
      const response3 = await runner.patchSectionFlow(
        response2.generation.content.id,
        'intro',
        'Make the introduction more engaging with a compelling hook and statistics',
        'Introduction'
      )
      console.log('Assistant:', response3.assistantMessage)
    }

    console.log('\n📋 Full Conversation:')
    console.log(runner.getTranscript())
  } catch (error) {
    console.error('❌ Custom scenario failed:', error)
  }
}

// Run tests based on command line argument
const testType = process.argv[2] || 'basic'

if (testType === 'custom') {
  runCustomScenario()
} else {
  runManualTests()
}
