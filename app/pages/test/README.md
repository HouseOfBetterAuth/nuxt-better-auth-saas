# Test Pages

This directory contains feature-flagged test pages that are only visible in development mode.

## Agent Mode UI Mock (`/test/agent-mode-ui`)

This page provides a mock implementation of the agent mode conversation UI with tool usage visualization. It simulates the SSE (Server-Sent Events) stream that the real chat API would send, allowing us to:

1. **Review the UI** before implementing the real API integration
2. **Test tool call visualization** with realistic timing and states
3. **Validate component behavior** with mocked data
4. **Design the user experience** for agent mode interactions

### Features Mocked

- **SSE Events**: Simulates all SSE events from the chat API:
  - `conversation:update` - Conversation state changes
  - `tool:preparing` - Tool call detected but arguments not yet complete
  - `tool:start` - Tool execution started
  - `tool:progress` - Progress updates for long-running operations
  - `tool:complete` - Tool execution completed
  - `message:chunk` - Incremental LLM text chunks
  - `message:complete` - LLM text generation finished
  - `messages:complete` - Authoritative message list from database
  - `done` - Stream completion signal

- **Tool Call States**: Shows tool calls in different states:
  - `preparing` - Tool call detected, waiting for arguments
  - `running` - Tool execution in progress
  - `success` - Tool execution completed successfully
  - `error` - Tool execution failed

- **Real Components**: Uses actual chat components:
  - `ChatMessageContent` - For rendering assistant messages
  - `AgentStatus` - For displaying tool call status

### Usage

1. Navigate to `/test/agent-mode-ui` in development mode
2. Click "Simulate Agent Turn" to see a mock conversation
3. Observe the tool calls, progress messages, and final message
4. Use this as a reference when implementing the real API integration

### Notes

- This page is **only visible in development mode** (`NODE_ENV === 'development'`)
- The mock data simulates a typical agent workflow:
  1. User sends a prompt
  2. Agent prepares and runs `source_ingest` tool
  3. Agent prepares and runs `content_write` tool
  4. Agent responds with a text message
- All timing is simulated with realistic delays to match expected API behavior
