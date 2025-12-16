# Test Suite Documentation

## Overview

This test suite provides comprehensive coverage for:
- Tool registry and parsing
- Mode enforcement (chat vs agent)
- Chunking and vectorization pipeline
- Tool execution (source_ingest, content_write)
- End-to-end chat/agent mode behavior

## Test Structure

```bash
tests/
├── unit/                    # Unit tests (fast, isolated)
│   ├── chat/
│   │   ├── tools.test.ts           # Tool registry and parsing
│   │   └── mode-enforcement.test.ts # Mode guardrail logic
│   └── sourceContent/
│       └── chunking.test.ts        # Chunking algorithm
├── integration/             # Integration tests (with mocks)
│   └── chat/
│       ├── source-ingest.test.ts   # source_ingest tool
│       ├── content-write.test.ts   # content_write tool
│       └── execute-tool.test.ts    # Tool execution guardrails
├── e2e/                     # End-to-end tests (HTTP)
│   └── chat-modes.test.ts          # Chat vs agent mode E2E
└── utils/
    └── chatTestUtils.ts            # Shared test utilities
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test tests/unit/chat/tools.test.ts

# Run tests in watch mode
pnpm test --watch

# Run with coverage
pnpm coverage
```

## Test Coverage

### Unit Tests

**`tests/unit/chat/tools.test.ts`**
- ✅ Tool registry: Verifies all 10 tools are registered correctly
- ✅ Tool kinds: Verifies read/write/ingest classification
- ✅ Tool parsing: Tests parseChatToolCall with valid/invalid inputs
- ✅ Discriminator validation: Tests action and sourceType parameters

**`tests/unit/chat/mode-enforcement.test.ts`**
- ✅ Tool selection by mode: Chat mode only gets read tools
- ✅ Execution guardrails: Write/ingest tools blocked in chat mode
- ✅ Error message consistency: Verifies error message format

**`tests/unit/sourceContent/chunking.test.ts`**
- ✅ Basic chunking: Short/long text handling
- ✅ Paragraph boundary detection
- ✅ Determinism: Same input → same output
- ✅ Edge cases: Empty strings, long words, whitespace

### Integration Tests

**`tests/integration/chat/source-ingest.test.ts`**
- ✅ sourceType="context" path: Creates source content and chunks
- ✅ Mode enforcement: Blocks in chat mode
- ✅ Chunking integration: Verifies chunks are created

**`tests/integration/chat/content-write.test.ts`**
- ✅ action="create" validation: Requires source
- ✅ action="enrich" validation: Requires contentId
- ✅ Discriminator enforcement: Tests action-specific requirements

**`tests/integration/chat/execute-tool.test.ts`**
- ✅ Mode enforcement for all tools
- ✅ Error message consistency

### E2E Tests

**`tests/e2e/chat-modes.test.ts`**
- ✅ Chat mode: Read operations allowed
- ✅ Chat mode: Write operations blocked
- ✅ Agent mode: All operations allowed
- ✅ Tool name verification: No old tool names

## Test Utilities

**`tests/utils/chatTestUtils.ts`**
- `ChatTestRunner`: Helper class for chat API testing
- SSE stream parsing
- Conversation management

## Mocking Strategy

- **Vectorize/Embeddings**: Mocked in integration tests to avoid external API calls
- **Database**: Mocked with simple in-memory structures for unit tests
- **LLM Calls**: Not mocked in E2E tests (uses real API with test environment)

## Test Data Management

- Tests automatically archive conversations once before all tests (not before/after each)
- Uses anonymous user sessions for testing
- No persistent test data (cleanup after each test)

## Known Limitations

1. **Vectorization**: Tests mock embeddings to avoid Cloudflare API calls
   - Real embedding behavior is tested in production
   - Chunking logic is tested independently

2. **LLM Behavior**: E2E tests depend on LLM tool selection
   - Tests verify tool availability, not specific LLM decisions
   - Mode enforcement is tested at the guardrail level

## Adding New Tests

When adding new tools or features:

1. **Unit tests**: Add to `tests/unit/chat/tools.test.ts` for tool registry
2. **Integration tests**: Add to `tests/integration/chat/` for tool execution
3. **E2E tests**: Add to `tests/e2e/chat-modes.test.ts` for full flow

Follow existing patterns:
- Use `describe` blocks for logical grouping
- Use `it` blocks for individual test cases
- Mock external dependencies (DB, APIs)
- Clean up test data after each test
