## AI Elements Vue Integration Roadmap

This document tracks the remaining UX features we want to adopt from the [AI Elements Vue](https://www.ai-elements-vue.com/) toolkit now that the codebase exposes a shared chat layout and state plumbing.

### Conversation Shell Enhancements
- **Rich message chrome** – avatars, timestamps, inline toolbars (copy, retry, vote), streaming indicators, and code block adornments.
- **Attachment & slash command composer** – chips for files/links, slash menu, temperature/token controls, and keyboard shortcut hints.
- **Agent/tool invocation cards** – render structured panels for tool calls with inputs/outputs, latency, and error states.

### Workflow Features
- **Conversation list & metadata** – leftrail of threads with model/persona badges, quick filters, and share/export buttons.
- **System prompt editor** – inline drawer to tweak system message, temperature, and max tokens per conversation.
- **Live status surfaces** – connection indicators, “assistant typing” pills, and inline diff snippets when a draft gets updated.

### Accessibility & Theming
- **Responsive header/footer scaffolds** – match AI Elements’ sticky header, footer, and sidebar interactions for tablets/mobile.
- **Keyboard navigation & focus management** – wrap message list and composer with the toolkit’s focus traps and hotkeys (`⌘K`, arrow to navigate messages, etc.).
- **Theme tokens** – migrate to AI Elements design tokens (radius, palette, typography) for a consistent look when we import their CSS bundle.

### Integration Tasks
- Run `npx ai-elements-vue add <components>` to scaffold the official chat shell, then swap our new `CodexChatLayout` usage with those generated components.
- Map our conversation state (`messages`, `status`, `actions`) to the toolkit’s provider/composables.
- Replace Nuxt UI prompts with `AiMessageInput` once we wire attachments, slash commands, and multi-tool support.

Once these items are complete we can remove the interim layout and rely entirely on AI Elements Vue for presentation while keeping the Codex business logic we implemented in this PR.***
