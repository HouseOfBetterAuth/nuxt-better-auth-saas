# Chat Frontend UI Plan (Nuxt UI v4)

## Goals

- Define a **clean, reusable frontend-only chat UI** using Nuxt UI v4.
- Use Nuxt UI chat primitives (`UChatMessage`, `UChatMessages`, `UChatPrompt`, `UChatPromptSubmit`, `UChatPalette`).
- Keep everything **UI-only** for now: no API calls, no LLM wiring.
- Fit naturally into existing Nuxt SaaS structure and naming.

### Reference implementation

- Follow the structure from [nuxt-ui-templates/chat](https://github.com/nuxt-ui-templates/chat/tree/main) as the canonical UI starting point.
- Mirror its layout patterns (dashboard shell, prompt in footer, scrollable messages) using Nuxt UI components rather than custom wrappers.
- When external fetching is unavailable, keep the layout aligned with the documented component examples so we can swap in the template markup once access is restored.

---

## High-Level Architecture

- **Chat domain is UI-only** in v1: local state, mock data, no persistence.
- All reusable chat widgets live under `app/components/chat/`.
- One or more pages consume those widgets:
  - `/chat` (public/user-facing chat playground)
  - optionally `/admin/chat` later (operator/admin console).

Data stays in component-local state using `ref`/`computed` and a shared `ChatMessage` type.

---

## Shared Types (Frontend Only)

Add chat types to `shared/utils/types.ts` (or a similar shared file):

```ts
export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: Date
  // Future fields: sources, status, error flags, etc.
}
```

These types are used by all chat components and pages so the UI remains consistent if we later wire to a backend.

---

## Components Directory Structure

Create `app/components/chat/` with the following foundational components:

- `app/components/chat/ChatMessageUser.vue`
- `app/components/chat/ChatMessageAssistant.vue`
- `app/components/chat/ChatMessagesList.vue`
- `app/components/chat/ChatPaletteShell.vue` (optional, but planned)

### 1. `ChatMessageUser.vue`

**Purpose:**

- Thin wrapper around `UChatMessage` for user messages.
- Standardizes avatar, alignment, and styling for the `user` role.

**Key props (frontend-only contract):**

- `message: ChatMessage` (required)

**Internal behavior:**

- Renders `UChatMessage` with:
  - `role="user"`
  - `:avatar` based on `message` (e.g. initials, optional avatar URL).
  - Default layout for right-side alignment.

### 2. `ChatMessageAssistant.vue`

**Purpose:**

- Thin wrapper around `UChatMessage` for assistant messages.
- Standardizes assistant avatar, color, actions (copy, retry – UI only).

**Key props:**

- `message: ChatMessage` (required)

**Internal behavior:**

- Renders `UChatMessage` with:
  - `role="assistant"`
  - `:avatar` configured for an assistant/bot identity.
  - Optional `:actions` array (copy, etc.), purely UI-only for now.

### 3. `ChatMessagesList.vue`

**Purpose:**

- Wraps `UChatMessages` and renders an ordered list of chat messages.
- Decides which component (`ChatMessageUser` vs `ChatMessageAssistant`) to use based on `message.role`.

**Key props:**

- `messages: ChatMessage[]` (required)

**Internal behavior:**

- Uses `UChatMessages` as the container.
- Iterates `messages` and renders the appropriate message component.
- Can accept a `class` or `density` prop for layout tweaks.

### 4. `ChatPaletteShell.vue` (planned)

**Purpose:**

- Wraps `UChatPalette` to create an overlay-style chatbot UI.
- Composes `ChatMessagesList` in the scrollable area and inline `UChatPrompt` in the footer.

**Key props & events:**

- Props:
  - `messages: ChatMessage[]` (required)
  - `open: boolean` — whether the palette is visible.
- Events:
  - `update:open(value: boolean)` — for controlling visibility.
  - `submit(prompt: string)` — forwarded from inline prompt.

**Internal behavior:**

- Uses `UChatPalette` layout slots:
  - Main content: `ChatMessagesList`.
  - Footer: `UChatPrompt` + `UChatPromptSubmit`.
- No business logic — merely a layout shell.

---

## Pages Using the Chat Components

### `/chat` — Demo Chat Page

Create `app/pages/chat/index.vue` as a **demo playground** for the chat UI.

**Purpose:**

- Showcase the chat components in isolation.
- Provide a clean place to later plug in real APIs.

**Behavior (frontend-only):**

- Holds `const messages = ref<ChatMessage[]>(initialMockMessages)`.
- Handles `submit(prompt)` from `UChatPrompt` by:
  - Pushing a `user` message into `messages`.
  - Optionally pushing a fake `assistant` message after a short timeout (mock response).
- Uses `ChatMessagesList` to render conversation.

**Layout:**

- Uses standard app layout (no special layout file required).
- Content structure:
  - Title / description.
  - Main chat card or panel using Nuxt UI primitives (`UCard`, `UContainer`, etc.).
  - Inside the card:
    - `ChatMessagesList` (scrollable area).
    - `UChatPrompt` with `UChatPromptSubmit` (sticky at bottom).

### (Optional) `/admin/chat`

Create `app/pages/admin/chat.vue` later if we need an admin/operator console.

- Reuses `ChatMessagesList` and `UChatPrompt`.
- Can later be wired to organization-specific sessions.
- For now, identical behavior to `/chat` but under the admin routing.

---

## Styling & Theming

- Leverage existing Nuxt UI theme and tokens.
- Chat-specific styles should be kept minimal and colocated:
  - For component-specific tweaks, use `<style scoped>` inside each chat component.
  - Prefer utility classes and Nuxt UI props (e.g. `size`, `variant`) before custom CSS.
- Avoid global CSS changes for v1 of chat UI.

---

## State & Mock Data Strategy

- All state is **client-side only**:
  - `ref<ChatMessage[]>(...)` in pages or top-level components.
  - No calls to `/api` or external services.
- Use simple mock data for the demo page:

  ```ts
  const initialMockMessages: ChatMessage[] = [
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! Ask me anything about your content workflows.',
      createdAt: new Date()
    }
  ]
  ```

- Message IDs can be generated with `crypto.randomUUID()` or a simple incremental counter for the frontend demo.

---

## Integration Points for Future Backend Wiring

Although we are **not** wiring any backend now, we define stable touchpoints:

- `UChatPrompt` `submit(prompt: string)` event is where future code will:
  - Call a chat API.
  - Track loading states.
  - Handle errors.
- Pages (`/chat`, `/admin/chat`) are responsible for:
  - Adding `user` messages to `messages`.
  - Adding/updating `assistant` messages when responses arrive.
- `ChatPaletteShell` provides a ready overlay surface that can later:
  - Be opened from a global button (e.g. in the header).
  - Be tied to per-page context (e.g. content IDs, source IDs) via props.

The UI contracts in this document should remain stable so that future backend/LLM work can plug in without restructuring the frontend.

---

## Next Steps (Frontend Only)

1. Add `ChatMessage` / `ChatRole` types to `shared/utils/types.ts`.
2. Implement foundational components under `app/components/chat/`:
   - `ChatMessageUser.vue`
   - `ChatMessageAssistant.vue`
   - `ChatMessagesList.vue`
   - Inline `UChatPrompt` usage
3. Create `/chat` demo page using these components and mock data.
4. Optionally implement `ChatPaletteShell.vue` and wire it into a test route or a temporary button.

All steps above intentionally avoid any backend logic so the chat UI remains a clean, drop-in foundation for later integrations.
