# LLM Codex Pipeline Plan (Nuxt + Python)

This document describes a **reusable, staged pipeline** for long-form sources (e.g. 30‑minute YouTube cooking videos) that turns transcripts into SEO‑ready MDX blogs with section‑level editing.

It is the source of truth for the Nuxt implementation and is grounded in what already exists in the current Python backend.

---

## 1. Goals

- **Codex‑style flow** for long videos:
  - Transcribing → reading → planning → writing sections → assembling → SEO → ready to publish.
- **Section‑first architecture**:
  - Outline + sections are first‑class, not an afterthought.
- **Reusability**:
  - Same pipeline works for any long `source_content` (YouTube today, Docs later).
- **Org‑scoped, Nuxt‑native**:
  - Reuse existing `organization` / better‑auth patterns and Drizzle ORM.

We intentionally avoid job/queue plumbing and extra SEO UI in v1; those can be layered on later.

---

## 2. Core Data Model (Summary)

We keep the existing entities from the prior plan but focus on how they support the pipeline.

- **`source_content`**
  - Where material comes from.
  - Fields (conceptual):
    - `id`, `organization_id`, `created_by_user_id`.
    - `source_type` (`"youtube" | "raw_text" | "google_doc" | ...`).
    - `external_id` (e.g. YouTube video ID).
    - `title`.
    - `source_text` (full transcript / body the LLM reads).
    - `metadata` JSON (provider‑specific).
    - `ingest_status` (`pending | ingested | failed`).

- **`chunk`** (required v1)
  - Transcript segments used for RAG.
  - Per‑chunk: `id`, `organization_id`, `source_content_id`, `chunk_index`, `start_char`, `end_char`, `text_preview`, timestamps, etc.
  - Embeddings stored in vector store keyed by `organization_id + source_content_id + chunk_index`.

- **`content`**
  - The logical article/post.
  - Fields: `id`, `organization_id`, `source_content_id`, `slug`, `title`, `status`, `content_type`, `primary_keyword`, `target_locale`, `current_version_id`, timestamps.

  - **`content_version`**
  - Immutable snapshot of a draft or edit.
  - Fields: `id`, `content_id`, `version`, `created_by_user_id`, timestamps.
    - `version: number` — monotonically incrementing integer starting at 1 (e.g. 1, 2, 3…).
  - Content fields:
    - `frontmatter` JSON (SEO+metadata).
    - `body_mdx` (full MDX).
    - `body_html` (rendered for preview/publish).
    - `sections` JSON (see section 4).
    - `assets` JSON (including `{ generator: { source, model } }`).
    - `seo_snapshot` JSON (optional v1).

- **`publication`**
  - Links `content_version` → external systems via `integration`.
  - Used later for WordPress / Docs publishing.

All new tables are **org‑scoped** and follow existing Nuxt SaaS conventions.

---

## 3. End‑to‑End Pipeline Stages

For a YouTube video, the **target** pipeline is:

1. **Ingest + transcript + chunks**
2. **Plan / outline (content plan)**
3. **Frontmatter generation**
4. **Section generation (per‑section writing, RAG‑aware)**
5. **Assemble full version from sections**
6. **SEO analysis**
7. **Section patching (chat‑driven editing)**

Each stage has a conceptual API and a brief note on **what exists today vs what to build**.

### 3.0 Current implementation (baseline)

Today, `POST /api/content/generate` calls `generateContentDraft`, which:

- Resolves `inputText` from either `text` or `sourceContent.sourceText`.
- Calls `composeBlogFromText(inputText, options)` once via AI Gateway to get:
  - Full `markdown` body.
  - `meta` (engine/model/SEO-ish info).
- Parses headings from `markdown` to build a `sections[]` array (with `id`, `index`, `type`, `level`, `title`, `startOffset`, `endOffset`, `anchor`, `wordCount`, `meta`).
- Creates a `content` row (or updates an existing one) and a single `content_version` with:
  - `frontmatter` (title, slug, status, contentType, sourceContentId).
  - `bodyMdx` = full markdown.
  - `sections` = parsed heading blocks.
  - `assets.generator` + `seoSnapshot`.

This is our **monolithic baseline**. The stages below describe how we evolve this into a reusable, section‑driven pipeline without breaking the existing `/api/content/generate` entrypoint.

---

## 3.1 Ingest + Transcript + Chunks

**Conceptual endpoint**

- `POST /api/source-content/youtube`

- **Request**
  - `youtubeUrl: string`
  - `titleHint?: string`

- **Response**
  - `sourceContentId: string`
  - `status: "transcribing" | "ready"`
  - `metadata: { videoId, durationSeconds?, channel?, thumbnailUrl? }`

**Behaviour**

- Parse YouTube URL → video ID.
- Upsert `source_content` for the org.
- Fetch transcript → normalize to `source_text`.
- Update `ingest_status = 'ingested'`.
- Chunk `source_text` into overlapping segments and write `chunk` rows.
- Compute embeddings and index them in vector store.

**Existing building blocks**

- In the current backend, ingest logic already fetches transcripts, creates chunk rows, and indexes embeddings.

**What to implement**

- Port this ingest + chunking behaviour into Nuxt, wiring it to `source_content` and `chunk` tables and your chosen vector store.

---

## 3.2 Plan / Outline (Content Plan)

**Conceptual endpoint**

- `POST /api/content/{contentId}/plan`

- **Request**
  - `instructions?: string` (brand voice, audience, constraints).
  - `targetKeywords?: string[]`.
  - `schemaHint?: string` (e.g. `"recipe" | "course" | "how_to"`).

- **Response**
  - `planId: string`.
  - `outline: Array<{ id: string; index: number; title: string; type: string; notes?: string }>`.
  - `seo: { title: string; description: string; keywords: string[]; schemaType: string; slugSuggestion: string }`.

**Behaviour**

- LLM reads:
  - Summarised transcript and/or key chunks.
  - Org SEO profile.
  - `instructions`, `targetKeywords`, `schemaHint`.
- Produces a structured outline + initial SEO plan but **no full article yet**.

**Existing building blocks**

- Existing logic can already derive headings/sections from finished MDX.

**What to implement**

- Add a dedicated "plan first" LLM call that works from transcript summaries and org SEO config before any full article exists.

---

## 3.3 Frontmatter Generation

**Conceptual endpoint**

- `POST /api/content/{contentId}/frontmatter`

- **Request**
  - `planId: string`.
  - `overrides?: { title?: string; description?: string; slug?: string; tags?: string[] }`.

- **Response**
  - `frontmatter: { title, description, slug, tags?, hero_image?, schema_type?, canonical_url?, locale? }`.

**Behaviour**

- Takes outline + SEO hints from plan.
- Applies org‑level branding (tone, persona, etc.).
- Emits a stable `frontmatter` object persisted on `content_version`.

**Existing building blocks**

- Current generation flow already produces reasonable titles/descriptions and later runs an SEO analyser.

**What to implement**

- Factor out frontmatter generation as a discrete step using the plan output, so frontmatter is stable before section writing.

---

## 3.4 Section Generation (Per‑Section, RAG‑Aware)

**Conceptual endpoint**

- `POST /api/content/{contentId}/sections/generate`

- **Request**
  - `planId: string`.
  - `mode: "all" | "missing"` (generate all sections, or only those without content yet).

- **Response**
  - `sections: Section[]` (see section 4 for shape; includes `body_mdx`).
  - `status: "in_progress" | "completed"`.

**Behaviour**

For each planned section:

- Build a retrieval query based on section title/type/notes.
- Query chunk embeddings for most relevant transcript `chunk` previews (RAG), similar to `_gather_transcript_context`.
- LLM call for **only that section**:
  - System: "You are writing ONE section of a blog post…".
  - User: section description + RAG snippets + global instructions.
- Produce `body_mdx` for that section.
- Save/update corresponding section entry.

**Existing building blocks**

- Transcript chunking + embeddings are already in place, and there is a section‑level editor that uses RAG for patching.

**What to implement**

- Reuse the same RAG + section prompts for **initial** section writing, iterating over the outline instead of calling a single monolithic "compose blog from text" helper.

---

## 3.5 Assemble Full Version From Sections

**Conceptual endpoint**

- `POST /api/content/{contentId}/assemble`

- **Request**
  - `frontmatter: object`.
  - `sections: Section[]`.

- **Response**
  - `versionId: string`.
  - `body_mdx: string`.
  - `body_html: string`.
  - `sections: Section[]` (canonical form saved on `content_version`).
  - `assets: { generator: { source: string; model?: string } }`.

**Behaviour**

- Build `body_mdx` as:
  - `# {frontmatter.title}`.
  - For each section `s` in order:
    - `## {s.title}\n\n{s.body_mdx}\n` (or level 3+ as needed).
- Render MDX → HTML for previews/publishing.
- Persist new `content_version` row and update `content.current_version_id`.

**Existing building blocks**

- There is already logic that can rebuild `body_mdx` from an updated list of sections and write a new version.

**What to implement**

- Generalise that into an `assembleFromSections` helper and use it for both initial assembly and subsequent edits.

---

## 3.6 SEO Analysis

**Conceptual endpoint**

- `POST /api/content/{contentId}/versions/{versionId}/seo`

- **Request**
  - (optional) `focusKeyword?: string`.

- **Response**
  - SEO payload: `{ seo, scores, suggestions, structured_content, schema_type, word_count, reading_time_seconds, schema_validation }`.

**Behaviour**

- Use `frontmatter`, `body_mdx`, `sections`, optional `assets` to:
  - Compute readability, keyword focus, heading structure, metadata quality, schema health.
  - Attach `json_ld` if missing but derivable from content type / sections.
  - Return suggestions (like the current Python SEO analyzer).

**Existing building blocks**

- A full SEO analyser already exists that understands frontmatter, sections, and schema‑aware content.

**What to implement**

- Either port the analyser to Nuxt or call the existing service, then store its output in `seo_snapshot` for each version.

---

## 3.7 Section Patching (Chat‑Driven Edits)

**Conceptual endpoint**

- `POST /api/content/{contentId}/sections/{sectionId}/patch`

- **Request**
  - `instructions: string`.

- **Response**
  - `versionId: string` (new version).
  - `section: { sectionId, index, title, body_mdx }`.

**Behaviour**

- Load latest `content_version` for `contentId`.
- Find target section by `sectionId`.
- Build `current_text` from that section.
- Use embeddings to gather relevant transcript `chunk` previews (RAG), similar to `_gather_transcript_context`.
- Build prompts and call AI Gateway to rewrite only that section.
- Replace that section’s body, rebuild `body_mdx` via `assembleFromSections`, and write a new `content_version`.

**Existing building blocks**

- A complete section‑patch flow exists: RAG over transcript chunks, section‑specific prompts, AI Gateway call, and reassembly into a new version.

**What to implement**

- Mirror that behaviour in Nuxt, scoped by `organization_id`, using the `content_version.sections` shape defined here.

---

## 4. Sections JSON Shape (On `content_version.sections`)

Sections are the structured index over `body_mdx` used for:

- Rendering a TOC.
- Section‑level generation and patching.
- SEO and schema‑aware enrichment.

**Canonical shape** (conceptual):

- Each section object:
  - `section_id: string` — stable id (UUID or deterministic).
  - `index: number` — 0‑based order.
  - `type: string` — e.g. `"intro" | "body" | "faq" | "cta" | "recipe_step"`.
  - `level?: number` — heading level (2 for H2, 3 for H3), if applicable.
  - `title?: string` — heading text.
  - `anchor?: string` — slug/anchor for deep links.
  - `startOffset?: number` — optional char index into `body_mdx`.
  - `endOffset?: number` — optional char index into `body_mdx`.
  - `wordCount: number` — per‑section word count.
  - `summary?: string` — optional summary.
  - `body_mdx?: string` — body for this section (used heavily in patch flow).
  - `meta?: Record<string, any>` — arbitrary hints (importance, SEO flags, todos, etc.).

**Notes**

- Existing section extraction utilities already work with a very similar shape; Nuxt should align field names where practical (e.g. `section_id`, `index`, `title`, `body_mdx`, `summary`).

---

## 5. Chat‑First UX and Pipeline Triggers

The pipeline is usually triggered from a chat UI rather than hard‑coded buttons.

- **`POST /api/chat`**
  - Detect URLs.
  - Upsert `source_content` for YouTube.
  - Ask for confirmation: e.g. "I found a YouTube link – generate an SEO blog from it?".
  - On user "yes", call the pipeline stages internally:
    1. Ingest + chunks (if needed).
    2. Plan.
    3. Frontmatter.
    4. Generate sections.
    5. Assemble version.
    6. Run SEO analysis.
  - Return progress updates + final `contentId`/`versionId`.

This keeps conversation natural while still using the reusable pipeline.

---

## 6. Implementation Notes (Nuxt)

- **Database schema**
  - `server/database/schema/sourceContent.ts`, `content.ts`, `chunk.ts` (and exports in `index.ts`).
  - Migrations create `source_content`, `chunk`, `content`, `content_version`, `publication`.

- **AI Gateway helper**
  - `server/utils/aiGateway.ts`:
    - `callChatCompletions` (wraps CF AI Gateway `/chat/completions`).
    - Higher‑level helpers for section‑level writing/editing.

- **Reuse from existing backend**
  - Ingest, chunking, embeddings: behaviour and prompt patterns.
  - Section patching prompts and context assembly.
  - SEO analyser logic, either ported or called remotely.

This plan replaces the previous monolithic‑first description with a **pipeline‑first** view that aligns with what your Python backend already supports and what the Nuxt backend should expose.
