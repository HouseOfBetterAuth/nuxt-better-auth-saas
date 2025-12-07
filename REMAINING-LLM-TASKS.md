# Legacy Items To Remove
- Old chat action types (`ChatAction*` in `server/types/api.ts`, client helpers that still construct `action` payloads, and any server branches looking for `body.action` when we no longer pass them).
- Dedicated “chat generate” and “section patch” API endpoints that duplicate the tool logic (`/api/chat/[sessionId]/create-content`, unused `content/generate.post.ts` variants, etc.).
- Manual source ingestion scaffolding that predates the YouTube/manual tools (stale `processedSources`, `sessionSourceId` juggling, “legacy transcript” logs).
- Chat UI branches that render different layouts or thinking indicators for old workflows (workspace layout variants, unused components).
- Any feature flags or prompt text referencing “actions” or “plan preview buttons” now replaced by the LLM agent flow.
- Redundant logging/telemetry from the old stack (e.g., `source_detected`, `generation_complete` log types) once tool-specific logs land.

# LLM Tooling – Remaining Work

We made the first backend step toward an LLM-driven `/api/chat` by letting the agent decide when to run `generate_content` or `patch_section`. Everything below captures the rest of the plan so we can resume quickly.

## 1. Chat Agent & `/api/chat`
- **Richer agent context:** feed workspace summaries, ready sources, and recent tool outcomes instead of just IDs so intent classification is accurate.
- **Multi-pass orchestration:** after each tool execution, append the tool result + arguments back into the conversation and let the model respond (or queue another tool) before we persist an assistant reply.
- **Structured tool logs:** emit `tool_started`, `tool_succeeded`, `tool_failed`, `tool_retrying` entries with `{ toolName, args, result }` so UI indicators and audit trails match reality.
- **Response payload:** return `agentContext` (readySources, ingestFailures, lastAction, etc.) so clients can render state without re-deriving it.
- **Error guardrails:** cap tool retries, surface meaningful fallback replies, and ensure publish remains human-gated even if the LLM asks.

## 2. Tool Catalog
- **YouTube ingestion tool:** expose the existing ingest pipeline so the agent can fetch captions/link a source before drafting.
- **Manual transcript tool:** allow users to explicitly save pasted transcripts (or let the agent do it) instead of forcing everything through generate_content.
- **Metadata/frontmatter tool:** wrap the `update_metadata` flow so “rename this draft” or “change the slug” doesn’t route through patch_section.
- **(Optional) Re-enrich tool:** surface schema/SEO refresh so “update structured data” requests have a first-class tool.

## 3. Source & Draft Flow
- Let `generate_content` accept inline `sourceText` without creating a source record unless the user asks to save it.
- Keep explicit ingest endpoints (`/api/actions/*`) for deterministic integrations, but ensure they reuse the same service functions the tools call.
- Clean up any dead code that only existed to support the old action payloads (legacy ChatAction types, UI helpers, duplicate handlers).

## 4. Frontend Alignment
- Update chat composables/components so they send **only** natural language + session context; stop constructing `action` objects client-side.
- Display the new `agentContext` (ready sources, tool failures, metadata changes) inside the chat widget and workspace header.
- Normalize the chat experience across home + workspace routes (single layout, thinking indicators tied to tool logs).

## 5. Observability & UX
- Map the new `tool_*` logs to richer thinking indicators (“Running patch_section…”, “Retrying ingest_youtube…”).
- Log the last successful tool/action into the session metadata so we can resume conversations intelligently.
- Capture ingestion failure summaries and include them in both the response payload and the follow-up agent prompt.

## 6. Follow-up Housekeeping
- Document the new tool-driven `/api/chat` contract (natural language in, agentContext + logs out) and mark the legacy action-based behavior as deprecated.
- Add integration tests (or at least manual scripts) that simulate tool calls end-to-end to protect against regressions.
- Revisit build tooling/CI (e.g., higher Node heap for Nitro) once the refactor lands so deployments stay reliable.

> Once these items are complete, the entire stack (backend agent + UI) will operate in a true “LLM selects tools” loop, with explicit `/api/actions/*` endpoints remaining as deterministic fallbacks for integrations.
