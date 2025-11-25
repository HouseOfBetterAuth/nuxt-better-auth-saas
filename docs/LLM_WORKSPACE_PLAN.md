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

For a YouTube video, the pipeline is:

1. **Ingest + transcript + chunks**
2. **Plan / outline (content plan)**
3. **Frontmatter generation**
4. **Section generation (per‑section writing, RAG‑aware)**
5. **Assemble full version from sections**
6. **SEO analysis**
7. **Section patching (chat‑driven editing)**

Each stage has a conceptual API and a note on current **Python parity**.

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

**Python parity**: **YES**

- Python already ingests transcripts, creates chunk rows, and indexes embeddings.
- Python uses these chunks for section patching via `_gather_transcript_context`.

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

**Python parity**: **PARTIAL**

- Python currently derives heading structure after full article generation (`extract_sections_from_version`).
- No explicit standalone "plan first" step; this is **new work** for Nuxt.

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

**Python parity**: **PARTIAL**

- Python fills frontmatter and SEO hints as part of `compose_blog_from_text` + `analyze_seo_document`.
- There is no separated frontmatter‑only step; this is a **refactor/port**.

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

**Python parity**: **PARTIAL**

- You already:
  - Chunk + embed transcripts.
  - Use `_gather_transcript_context` + `_call_ai_gateway_for_section` for **patching** existing sections.
- New in this plan:
  - Drive **initial** article creation via section‑by‑section generation instead of a monolithic `compose_blog_from_text` call.

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

**Python parity**: **YES (building block)**

- Nuxt should implement a general `assembleFromSections` helper, and call it for both initial generation and patching.

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

**Python parity**: **YES**

- Python already has `analyze_seo_document(...)` doing this work.
- Nuxt can either:
  - Port this logic, or
  - Call the Python service until parity is achieved.

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

**Python parity**: **YES**

- Implemented today as `patch_project_blog_section` with:
  - `_gather_transcript_context` (RAG).
  - `_build_section_patch_prompts`.
  - `_call_ai_gateway_for_section`.
  - `_rebuild_body_with_patched_section` + new version write.

Nuxt’s implementation should mirror this behaviour, scoped by `organization_id`.

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

**Python parity**: **YES (conceptually)**

- Python’s `extract_sections_from_version` already yields a similar structure and is used for patching and SEO.
- Nuxt should match field names where practical (e.g. `section_id`, `index`, `title`, `body_mdx`, `summary`).

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
    - Higher‑level helpers:
      - `composeBlogFromText` (optional transitional helper ported from Python).
      - `callAiGatewayForSection` (section‑level writer/editor).

- **Reuse from Python**
  - Ingest, chunking, embeddings: behaviour and prompts.
  - Section patching prompts and context assembly.
  - SEO analyser logic, either ported or called remotely.

This plan replaces the previous monolithic‑first description with a **pipeline‑first** view that aligns with what your Python backend already supports and what the Nuxt backend should expose.
